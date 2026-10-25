/**
 * Branch summarization for tree navigation.
 *
 * When navigating to a different point in the session tree, this generates
 * a summary of the branch being left so context isn't lost.
 */

import type { Agent, AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import type { ProviderHeaders, RetryCallbacks, RetryPolicy } from "@earendil-works/pi-ai";
import { contentText, getCurrentSystemMessage, normalizeContext, toToolDeclaration } from "@earendil-works/pi-ai";
import { clampMaxTokensToInput, isContextClampingApi } from "@earendil-works/pi-ai/api/simple-options";
import type { Api, Message, Model, SimpleStreamOptions, Usage } from "@earendil-works/pi-ai/compat";
import { isKnownApiProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { convertToLlm } from "../messages.ts";
import {
	buildSessionProjection,
	type ReadonlySessionManager,
	type SessionEntry,
	type SessionProjection,
} from "../session-manager.ts";
import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.ts";
import {
	canAttributeRequestHistory,
	computeFileLists,
	createFileOps,
	extractFileOpsFromMessage,
	type FileOperations,
	formatFileOperations,
	type RequestHistoryPolicy,
	SUMMARIZATION_SYSTEM_PROMPT,
} from "./utils.ts";

// ============================================================================
// Types
// ============================================================================

export interface BranchSummaryResult {
	summary?: string;
	usage?: Usage;
	readFiles?: string[];
	modifiedFiles?: string[];
	aborted?: boolean;
	error?: string;
}

/** Details stored in BranchSummaryEntry.details for file tracking */
export interface BranchSummaryDetails {
	readFiles: string[];
	modifiedFiles: string[];
}

export type { FileOperations } from "./utils.ts";

export interface BranchPreparation {
	/** Messages extracted for summarization, in chronological order */
	messages: AgentMessage[];
	/** File operations extracted from tool calls */
	fileOps: FileOperations;
	/** Total estimated tokens in messages */
	totalTokens: number;
	/** Whether the next complete history group exceeded the selection budget. */
	budgetExceeded: boolean;
}

export interface CollectEntriesResult {
	/** Entries to summarize, in chronological order */
	entries: SessionEntry[];
	/** Common ancestor between old and new position, if any */
	commonAncestorId: string | null;
}

export interface GenerateBranchSummaryOptions {
	/** Model to use for summarization */
	model: Model<any>;
	/** API key for the model */
	apiKey?: string;
	/** Request headers for the model */
	headers?: ProviderHeaders;
	/** Provider-scoped environment values for the model */
	env?: Record<string, string>;
	/** Abort signal for cancellation */
	signal: AbortSignal;
	/** Optional custom instructions for summarization */
	customInstructions?: string;
	/** If true, customInstructions replaces the default prompt instead of being appended */
	replaceInstructions?: boolean;
	/** Tokens reserved when selecting branch history (default 16384) */
	reserveTokens?: number;
	/** Optional session stream function. Used to preserve SDK request behavior without mutating agent state. */
	streamFn?: StreamFn;
	/** Retry policy for transient summarization errors. Reuses coding-agent's `settings.retry`. */
	retry?: RetryPolicy;
	/** Optional callbacks for retry reporting (e.g. TUI retry indicators). */
	callbacks?: RetryCallbacks;
	/**
	 * Original system prompt from the active session. When provided, the summarization
	 * request reuses it so provider prompt caches stay valid; otherwise a generic
	 * summarization system prompt is used.
	 */
	systemPrompt?: string;
	/**
	 * Agent whose context pipeline (transformContext, convertToLlm, tools,
	 * sessionId, transport, etc.) should be mirrored for cache reuse.
	 */
	agent?: Agent;
	/** Live session authorization for reconstructing pre-payload history. */
	requestHistoryPolicy?: RequestHistoryPolicy;
	/** Native adapter output ceiling, independent of final payload attribution. */
	usesAdapterOutputClamp?: (model: Model<Api>) => boolean;
	/** Canonical old-branch projection used to recover policy preceding the retained range. */
	contextProjection?: SessionProjection;
}

// ============================================================================
// Entry Collection
// ============================================================================

/**
 * Collect entries that should be summarized when navigating from one position to another.
 *
 * Walks from oldLeafId back to the common ancestor with targetId, collecting entries
 * along the way. Does NOT stop at compaction boundaries - those are included and their
 * summaries become context.
 *
 * @param session - Session manager (read-only access)
 * @param oldLeafId - Current position (where we're navigating from)
 * @param targetId - Target position (where we're navigating to)
 * @returns Entries to summarize and the common ancestor
 */
export function collectEntriesForBranchSummary(
	session: ReadonlySessionManager,
	oldLeafId: string | null,
	targetId: string,
): CollectEntriesResult {
	// If no old position, nothing to summarize
	if (!oldLeafId) {
		return { entries: [], commonAncestorId: null };
	}

	// Find common ancestor (deepest node that's on both paths)
	const oldPath = new Set(session.getBranch(oldLeafId).map((e) => e.id));
	const targetPath = session.getBranch(targetId);

	// targetPath is root-first, so iterate backwards to find deepest common ancestor
	let commonAncestorId: string | null = null;
	for (let i = targetPath.length - 1; i >= 0; i--) {
		if (oldPath.has(targetPath[i].id)) {
			commonAncestorId = targetPath[i].id;
			break;
		}
	}

	// Collect entries from old leaf back to common ancestor
	const entries: SessionEntry[] = [];
	let current: string | null = oldLeafId;

	while (current && current !== commonAncestorId) {
		const entry = session.getEntry(current);
		if (!entry) break;
		entries.push(entry);
		current = entry.parentId;
	}

	// Reverse to get chronological order
	entries.reverse();

	return { entries, commonAncestorId };
}

// ============================================================================
// Entry to Message Conversion
// ============================================================================

/** Public callers supply an ordered slice, not necessarily a connected session tree. */
function projectBranchSlice(entries: SessionEntry[]): SessionProjection {
	return buildSessionProjection(
		entries.map((entry, index) => ({
			...entry,
			parentId: index > 0 ? entries[index - 1].id : null,
		})),
	);
}

/**
 * Prepare entries for summarization with token budget.
 *
 * Walks entries from NEWEST to OLDEST, adding messages until we hit the token budget.
 * This ensures we keep the most recent context when the branch is too long.
 *
 * Also collects file operations from:
 * - Tool calls in assistant messages
 * - Existing branch_summary entries' details (for cumulative tracking)
 *
 * @param entries - Entries in chronological order
 * @param tokenBudget - Maximum tokens to include (0 = no limit)
 */
export function prepareBranchEntries(
	entries: SessionEntry[],
	tokenBudget: number = 0,
	contextProjection: SessionProjection = projectBranchSlice(entries),
): BranchPreparation {
	return selectBranchEntries(entries, tokenBudget, contextProjection, true);
}

function selectBranchEntries(
	entries: SessionEntry[],
	tokenBudget: number,
	contextProjection: SessionProjection,
	allowSummaryOverflow: boolean,
	budgetSystemMessages: boolean = true,
): BranchPreparation {
	const sourceIds = new Set(entries.map((entry) => entry.id));
	const projected = contextProjection.entries.filter((entry) => sourceIds.has(entry.sourceEntry.id));
	const messages: AgentMessage[] = [];
	const fileOps = createFileOps();
	let totalTokens = 0;
	let budgetExceeded = false;

	// First pass: collect file ops from ALL entries (even if they don't fit in token budget)
	// This ensures we capture cumulative file tracking from nested branch summaries
	// Only extract from pi-generated summaries (fromHook !== true), not extension-generated ones
	for (const { sourceEntry: entry, messages: projectedMessages } of projected) {
		if (projectedMessages.length > 0 && entry.type === "branch_summary" && !entry.fromHook && entry.details) {
			const details = entry.details as BranchSummaryDetails;
			if (Array.isArray(details.readFiles)) {
				for (const f of details.readFiles) fileOps.read.add(f);
			}
			if (Array.isArray(details.modifiedFiles)) {
				// Modified files go into both edited and written for proper deduplication
				for (const f of details.modifiedFiles) {
					fileOps.edited.add(f);
				}
			}
		}
	}

	// Second pass: walk from newest to oldest, adding messages until token budget.
	// Defer results and intervening system updates until their conversational boundary.
	// Systems are transparent to provider tool accounting; keep their original chronology
	// with the call/results so truncation cannot create a failed replay. Public preparation
	// budgets the whole group; generation defers authority sizing until policy conversion.
	// User/custom and assistant boundaries still stop association, including reused call IDs.
	const firstContribution = projected.findIndex((entry) => entry.messages.length > 0);
	const pendingContributions: AgentMessage[][] = [];
	for (let i = projected.length - 1; i >= 0; i--) {
		const { sourceEntry: entry, messages: contribution } = projected[i];
		if (contribution.length === 0) continue;
		// Request-local policy reconciliation can share a contribution with its result.
		// Defer the entire ordered contribution so the patch cannot split call/result ownership.
		if (
			contribution.some((message) => message.role === "toolResult") &&
			contribution.every((message) => message.role === "toolResult" || message.role === "system")
		) {
			pendingContributions.push(contribution);
			continue;
		}
		if (
			i !== firstContribution &&
			contribution.every((message) => message.role === "system") &&
			pendingContributions.length > 0
		) {
			pendingContributions.push(contribution);
			continue;
		}
		const callIds = new Set(
			contribution.flatMap((message) =>
				message.role === "assistant"
					? message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []))
					: [],
			),
		);
		const group = [...contribution];
		for (let index = pendingContributions.length - 1; index >= 0; index--) {
			for (const message of pendingContributions[index]) {
				if (message.role === "system" || (message.role === "toolResult" && callIds.has(message.toolCallId))) {
					group.push(message);
				}
			}
		}
		pendingContributions.length = 0;
		// Generation retains authority for its single policy transform, but only
		// conversational groups consume the source-history selection budget.
		if (!budgetSystemMessages && group.every((message) => message.role === "system")) {
			messages.unshift(...group);
			continue;
		}
		let tokens = 0;
		for (const message of group) {
			extractFileOpsFromMessage(message, fileOps);
			if (budgetSystemMessages || message.role !== "system") tokens += estimateTokens(message);
		}

		if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
			budgetExceeded = true;
			if (
				allowSummaryOverflow &&
				(entry.type === "compaction" || entry.type === "branch_summary") &&
				totalTokens < tokenBudget * 0.9
			) {
				messages.unshift(...group);
				totalTokens += tokens;
			} else if (!budgetSystemMessages) {
				messages.unshift(...group.filter((message) => message.role === "system"));
			}
			break;
		}
		messages.unshift(...group);
		totalTokens += tokens;
	}

	return { messages, fileOps, totalTokens, budgetExceeded };
}

// ============================================================================
// Summary Generation
// ============================================================================

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/**
 * Generate a summary of abandoned branch entries.
 *
 * @param entries - Session entries to summarize (chronological order)
 * @param options - Generation options
 */
export async function generateBranchSummary(
	entries: SessionEntry[],
	options: GenerateBranchSummaryOptions,
): Promise<BranchSummaryResult> {
	const {
		model,
		apiKey,
		headers,
		env,
		signal,
		customInstructions,
		replaceInstructions,
		reserveTokens = 16384,
		streamFn,
		retry,
		callbacks,
		systemPrompt,
		agent,
		contextProjection,
	} = options;

	const contextWindow = model.contextWindow || 262144;
	const maxTokens = Math.min(4096, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);
	const usesAdapterOutputClamp =
		options.usesAdapterOutputClamp ??
		((requestModel: Model<Api>) =>
			(!streamFn || streamFn === streamSimple) &&
			isContextClampingApi(requestModel.api) &&
			isKnownApiProvider(requestModel.api));
	const nativeHeadroom = (): boolean =>
		usesAdapterOutputClamp(model) &&
		(!agent || !streamFn || streamFn === agent.streamFunction) &&
		clampMaxTokensToInput(model, 0, maxTokens) > 1;
	let tokenBudget = contextWindow - reserveTokens;
	const budgetFailure = (): BranchSummaryResult => ({
		error: `Branch summarization failed: newest message group exceeds the token budget (${tokenBudget} tokens)`,
	});
	const projection = contextProjection ?? projectBranchSlice(entries);
	const projectedSourceIds = new Set(projection.entries.map((entry) => entry.sourceEntry.id));
	if (
		contextProjection &&
		entries.some((entry) => entry.deletedAt === undefined) &&
		!entries.some((entry) => projectedSourceIds.has(entry.id))
	) {
		return { error: "Branch summarization context projection does not contain the retained entry" };
	}
	let preparation = selectBranchEntries(entries, tokenBudget, projection, true, false);
	if (
		preparation.messages.length === 0 ||
		(preparation.budgetExceeded && preparation.messages.every((message) => message.role === "system"))
	) {
		return preparation.budgetExceeded ? budgetFailure() : { summary: "No content to summarize" };
	}

	// Build prompt
	let instructions: string;
	if (replaceInstructions && customInstructions) {
		instructions = customInstructions;
	} else if (customInstructions) {
		instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`;
	} else {
		instructions = BRANCH_SUMMARY_PROMPT;
	}
	const instructionText = `Do not continue the conversation above. Output only the structured summary requested below.\n\n${instructions}`;
	const instruction: Message = {
		role: "user",
		content: [{ type: "text", text: instructionText }],
		timestamp: Date.now(),
	};
	const promptBudget = contextWindow - maxTokens;
	// Keep at least two output tokens rather than admitting the adapter's emergency floor.
	const nativePromptBudget = clampMaxTokensToInput(model, 0, Number.POSITIVE_INFINITY) - 2;
	let contextMessages: AgentMessage[];
	while (true) {
		const { messages } = preparation;
		const firstMessageIndex = projection.messages.indexOf(messages[0]);
		// Restore only preceding system state, never shared conversation. A standalone
		// SDK slice can start with a patch; explicit projections/checkpoints stay authoritative.
		const baseline = getCurrentSystemMessage(projection.messages.slice(0, Math.max(0, firstMessageIndex)));
		const agentBaseline =
			!baseline && !contextProjection && !projection.entries.some((entry) => entry.sourceEntry.type === "compaction")
				? agent && getCurrentSystemMessage(agent.state.messages)
				: undefined;
		contextMessages = baseline
			? [baseline, ...messages]
			: agentBaseline
				? [agentBaseline, ...messages.filter((message) => message.role !== "system")]
				: messages;
		const useNativeBudget = nativeHeadroom();
		let requestTokens: number;
		if (useNativeBudget) {
			const requestMessages = convertToLlm([...contextMessages, instruction]);
			if (requestMessages[0]?.role !== "system") {
				requestMessages.unshift({
					role: "system",
					content: systemPrompt ?? SUMMARIZATION_SYSTEM_PROMPT,
					timestamp: 0,
				});
			}
			requestTokens = requestMessages.reduce((total, message) => total + estimateMessageTokens(message), 0);
		} else {
			requestTokens =
				contextMessages.reduce((total, message) => total + estimateTokens(message), 0) +
				estimateTokens(instruction) +
				(contextMessages[0]?.role === "system"
					? 0
					: estimateTokens({
							role: "system",
							content: systemPrompt ?? SUMMARIZATION_SYSTEM_PROMPT,
							timestamp: 0,
						}));
		}
		const availablePromptBudget = useNativeBudget ? nativePromptBudget : promptBudget;
		if (requestTokens <= availablePromptBudget) break;
		// Re-select whole atomic groups before invoking arbitrary context hooks. Moving
		// the cut can change the restored baseline, so size that new prefix again.
		// A baseline that leaves no history budget may be removed by request policy;
		// defer rejection until the single converted-request check below.
		tokenBudget = preparation.totalTokens - (requestTokens - availablePromptBudget);
		if (tokenBudget <= 0) break; // prepareBranchEntries(0) means unlimited.
		const trimmed = selectBranchEntries(entries, tokenBudget, projection, false, false);
		if (
			!trimmed.messages.some((message) => message.role !== "system") ||
			trimmed.messages.length >= messages.length
		) {
			break;
		}
		preparation = trimmed;
	}
	const source = structuredClone(contextMessages);
	if (source[0]?.role !== "system" || (!agent && !contextProjection && systemPrompt !== undefined)) {
		source.unshift({ role: "system", content: systemPrompt ?? SUMMARIZATION_SYSTEM_PROMPT, timestamp: 0 });
	}
	const budgetError = new Error(budgetFailure().error);
	let fileOps = createFileOps();
	let attributable = false;

	const buildContext = async (attemptOptions: SimpleStreamOptions) => {
		const input = structuredClone(source);
		if (agent && input[0]?.role === "system" && input[0].toolsAdded === undefined) {
			input[0] = { ...input[0], toolsAdded: agent.state.tools.map(toToolDeclaration) };
		}
		const llmMessages = agent
			? await agent.convertForRequest(agent.transformContext ? await agent.transformContext(input, signal) : input)
			: convertToLlm(input);
		const context = normalizeContext({ messages: [...llmMessages, instruction] });
		const useNativeBudget = nativeHeadroom();
		const inputTokens = context.messages.reduce(
			(total, message) => total + (useNativeBudget ? estimateMessageTokens(message) : estimateTokens(message)),
			0,
		);
		const outputTokens = useNativeBudget ? clampMaxTokensToInput(model, inputTokens, maxTokens) : maxTokens;
		if (useNativeBudget ? outputTokens <= 1 : inputTokens > promptBudget) throw budgetError;
		attemptOptions.maxTokens = outputTokens;
		fileOps = createFileOps();
		attributable = canAttributeRequestHistory(model, agent, streamFn, options.requestHistoryPolicy);
		if (attributable) {
			for (const message of llmMessages) {
				if (message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted")
					extractFileOpsFromMessage(message, fileOps);
			}
		}
		if (agent) attemptOptions.onPayload = agent.onPayload;
		return context;
	};

	// Call LLM for summarization. Prefer the session stream function so SDK
	// request behavior (timeouts, retries, attribution headers) stays consistent
	// without running through agent state/events. Retried via completeSummarization
	// so transient stream drops reuse the configured retry policy.
	const requestOptions: SimpleStreamOptions = { apiKey, headers, env, signal, maxTokens };
	if (agent) {
		requestOptions.sessionId = agent.sessionId;
		requestOptions.transport = agent.transport;
		requestOptions.thinkingBudgets = agent.thinkingBudgets;
		requestOptions.maxRetryDelayMs = agent.maxRetryDelayMs;
		requestOptions.onPayload = agent.onPayload;
		requestOptions.onResponse = agent.onResponse;
	}
	const response = await completeSummarization(model, buildContext, requestOptions, streamFn, retry, callbacks).catch(
		(error: unknown) => {
			if (error === budgetError) return undefined;
			throw error;
		},
	);
	if (!response) return budgetFailure();

	// Check if aborted or errored
	if (response.stopReason === "aborted") {
		return { aborted: true };
	}
	const failure = getSummarizationFailure(response, "Branch summarization");
	if (failure) {
		return { error: failure };
	}
	if (response.content.some((block) => block.type === "toolCall")) {
		return { error: "Branch summarization attempted to call a tool" };
	}

	let summary = contentText(response.content);

	// Prepend preamble to provide context about the branch summary
	summary = BRANCH_SUMMARY_PREAMBLE + summary;

	// Compute file lists and append to summary
	const { readFiles, modifiedFiles } = computeFileLists(
		attributable && canAttributeRequestHistory(model, agent, streamFn, options.requestHistoryPolicy)
			? fileOps
			: createFileOps(),
	);
	summary += formatFileOperations(readFiles, modifiedFiles);

	return {
		summary: summary || "No summary generated",
		usage: response.usage,
		readFiles,
		modifiedFiles,
	};
}
