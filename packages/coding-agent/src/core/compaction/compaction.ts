/**
 * Context compaction for long sessions.
 *
 * Pure functions for compaction logic. The session manager handles I/O,
 * and after compaction the session is reloaded.
 */

import type { Agent, AgentMessage, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	contentText,
	getCurrentSystemMessage,
	normalizeContext,
	type RetryCallbacks,
	type RetryPolicy,
	retryAssistantCall,
	toToolDeclaration,
	uuidv7,
} from "@earendil-works/pi-ai";
import { clampMaxTokensToInput, isContextClampingApi } from "@earendil-works/pi-ai/api/simple-options";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import type {
	Api,
	AssistantMessage,
	Message,
	Model,
	ProviderHeaders,
	SimpleStreamOptions,
	SystemMessage,
	TranscriptContext,
	Usage,
} from "@earendil-works/pi-ai/compat";
import { completeSimple, isKnownApiProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { convertToLlm } from "../messages.ts";
import {
	buildSessionProjection,
	type CompactionEntry,
	DEFAULT_SUMMARY_BLOCK_MAX_TOKENS,
	type ProjectedSessionEntry,
	type SessionEntry,
	type SessionProjection,
	sessionEntryToContextMessages,
} from "../session-manager.ts";
import {
	canAttributeRequestHistory,
	computeFileLists,
	createFileOps,
	extractFileOpsFromMessage,
	type FileOperations,
	formatFileOperations,
	type RequestHistoryPolicy,
	SUMMARIZATION_SYSTEM_PROMPT,
	serializeConversation,
} from "./utils.ts";

// ============================================================================
// File Operation Tracking
// ============================================================================

/** Details stored in CompactionEntry.details for file tracking */
export interface CompactionDetails {
	readFiles: string[];
	modifiedFiles: string[];
}

/**
 * Extract file operations from messages and previous compaction entries.
 */
function extractFileOperations(
	messages: AgentMessage[],
	entries: SessionEntry[],
	prevCompactionIndex: number,
): FileOperations {
	const fileOps = createFileOps();

	// Collect from previous compaction's details (if pi-generated)
	if (prevCompactionIndex >= 0) {
		const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
		if (!prevCompaction.fromHook && prevCompaction.details) {
			// fromHook field kept for session file compatibility
			const details = prevCompaction.details as CompactionDetails;
			if (Array.isArray(details.readFiles)) {
				for (const f of details.readFiles) fileOps.read.add(f);
			}
			if (Array.isArray(details.modifiedFiles)) {
				for (const f of details.modifiedFiles) fileOps.edited.add(f);
			}
		}
	}

	// Extract from tool calls in messages
	for (const msg of messages) {
		extractFileOpsFromMessage(msg, fileOps);
	}

	return fileOps;
}

/** Result from compact() - SessionManager adds uuid/parentUuid when saving */
export interface CompactionResult<T = unknown> {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	estimatedTokensAfter?: number;
	/** Usage from the LLM call(s) that generated this summary, if available */
	usage?: Usage;
	/** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
	details?: T;
}

// ============================================================================
// Types
// ============================================================================

export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
	/** Max total tokens for the summaries block in the prefix; 0 keeps only the
	 * most recent summary (pre-feature behavior). */
	summaryBlockMaxTokens?: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
	summaryBlockMaxTokens: DEFAULT_SUMMARY_BLOCK_MAX_TOKENS,
};

// ============================================================================
// Token calculation
// ============================================================================

/**
 * Calculate total context tokens from usage.
 * Uses the native totalTokens field when available, falls back to computing from components.
 */
export function calculateContextTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/**
 * Get usage from an assistant message if available.
 * Skips aborted, error, and all-zero usage messages as they don't have valid usage data.
 */
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
	if (msg.role === "assistant" && "usage" in msg) {
		const assistantMsg = msg as AssistantMessage;
		if (
			assistantMsg.stopReason !== "aborted" &&
			assistantMsg.stopReason !== "error" &&
			assistantMsg.usage &&
			calculateContextTokens(assistantMsg.usage) > 0
		) {
			return assistantMsg.usage;
		}
	}
	return undefined;
}

/**
 * Find the last valid assistant message usage from session entries.
 */
export function getLastAssistantUsage(entries: SessionEntry[]): Usage | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message") {
			const usage = getAssistantUsage(entry.message);
			if (usage) return usage;
		}
	}
	return undefined;
}

export interface ContextUsageEstimate {
	tokens: number;
	usageTokens: number;
	trailingTokens: number;
	lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(messages: AgentMessage[]): { usage: Usage; index: number } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const usage = getAssistantUsage(messages[i]);
		if (usage) return { usage, index: i };
	}
	return undefined;
}

/**
 * Estimate context tokens from messages, using the last assistant usage when available.
 * If there are messages after the last usage, estimate their tokens with estimateTokens.
 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
	const usageInfo = getLastAssistantUsageInfo(messages);

	if (!usageInfo) {
		let estimated = 0;
		for (const message of messages) {
			estimated += estimateTokens(message);
		}
		return {
			tokens: estimated,
			usageTokens: 0,
			trailingTokens: estimated,
			lastUsageIndex: null,
		};
	}

	const usageTokens = calculateContextTokens(usageInfo.usage);
	let trailingTokens = 0;
	for (let i = usageInfo.index + 1; i < messages.length; i++) {
		trailingTokens += estimateTokens(messages[i]);
	}

	return {
		tokens: usageTokens + trailingTokens,
		usageTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
	};
}

/** Estimate projected context without trusting replayed usage or usage captured before a later edit or compaction. */
export function estimateProjectedContextTokens(
	projection: SessionProjection,
	branchEntries: SessionEntry[],
): ContextUsageEstimate {
	const estimate = estimateContextTokens(projection.messages);
	if (estimate.lastUsageIndex !== null) {
		let projectedMessageIndex = 0;
		let usageEntryId: string | undefined;
		for (const entry of projection.entries) {
			const nextMessageIndex = projectedMessageIndex + entry.messages.length;
			if (estimate.lastUsageIndex < nextMessageIndex) {
				const sourceEntry = entry.sourceEntry;
				if (sourceEntry.usageSourceId === undefined || sourceEntry.usageSourceId === sourceEntry.id) {
					usageEntryId = sourceEntry.id;
				}
				break;
			}
			projectedMessageIndex = nextMessageIndex;
		}

		const usageEntryIndex = usageEntryId ? branchEntries.findIndex((entry) => entry.id === usageEntryId) : -1;
		let latestInvalidatingEntryIndex = -1;
		for (let i = branchEntries.length - 1; i >= 0; i--) {
			const entry = branchEntries[i];
			if (entry.type === "context_edit" || entry.type === "compaction") {
				latestInvalidatingEntryIndex = i;
				break;
			}
		}
		if (usageEntryIndex > latestInvalidatingEntryIndex) return estimate;
	}

	const currentSystem = getCurrentSystemMessage(projection.messages);
	let tokens = currentSystem ? estimateTokens(currentSystem) : 0;
	for (const message of projection.messages) {
		if (message.role !== "system") tokens += estimateTokens(message);
	}
	return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// Cut point detection
// ============================================================================

export const ESTIMATED_IMAGE_CHARS = 4800;

/** Counts entry tokens; the optional signal cancels unneeded speculative batch work. */
export type TokenCounter = (messages: AgentMessage[], signal?: AbortSignal) => Promise<number>;

function estimateTextAndImageContentChars(content: string | Array<{ type: string; text?: string }>): number {
	if (typeof content === "string") {
		return content.length;
	}

	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) {
			chars += block.text.length;
		} else if (block.type === "image") {
			chars += ESTIMATED_IMAGE_CHARS;
		}
	}
	return chars;
}

/**
 * Estimate token count for a message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 */
export function estimateTokens(message: AgentMessage): number {
	let chars = 0;

	switch (message.role) {
		case "system": {
			const system = message as SystemMessage;
			chars = estimateTextAndImageContentChars(system.content);
			if (system.sections) {
				for (const section of Object.values(system.sections)) {
					if (section) chars += section.length;
				}
			}
			if (system.toolsAdded) chars += JSON.stringify(system.toolsAdded).length;
			return Math.ceil(chars / 4);
		}
		case "user": {
			chars = estimateTextAndImageContentChars(
				(message as { content: string | Array<{ type: string; text?: string }> }).content,
			);
			return Math.ceil(chars / 4);
		}
		case "assistant": {
			const assistant = message as AssistantMessage;
			for (const block of assistant.content) {
				if (block.type === "text") {
					chars += block.text.length;
				} else if (block.type === "thinking") {
					chars += block.thinking.length;
				} else if (block.type === "toolCall") {
					chars += block.name.length + JSON.stringify(block.arguments).length;
				}
			}
			return Math.ceil(chars / 4);
		}
		case "custom":
		case "toolResult": {
			chars = estimateTextAndImageContentChars(message.content);
			return Math.ceil(chars / 4);
		}
		case "bashExecution": {
			chars = message.command.length + message.output.length;
			return Math.ceil(chars / 4);
		}
		case "branchSummary":
		case "compactionSummary": {
			chars = message.summary.length;
			return Math.ceil(chars / 4);
		}
	}

	return 0;
}

function isCutPointMessage(message: AgentMessage): boolean {
	switch (message.role) {
		case "user":
		case "assistant":
		case "bashExecution":
		case "custom":
		case "branchSummary":
		case "compactionSummary":
			return true;
		case "toolResult":
			return false;
	}
	return false;
}

function isTurnStartMessage(message: AgentMessage): boolean {
	switch (message.role) {
		case "user":
		case "bashExecution":
		case "custom":
		case "branchSummary":
		case "compactionSummary":
			return true;
		case "assistant":
		case "toolResult":
			return false;
	}
	return false;
}

function isTurnStartEntry(entry: SessionEntry): boolean {
	if (entry.type === "compaction") {
		return false;
	}
	return sessionEntryToContextMessages(entry).some(isTurnStartMessage);
}

/**
 * Find valid cut points: indices of context-visible user-like or assistant messages.
 * Never cut at tool results (they must follow their tool call).
 * When we cut at an assistant message with tool calls, its tool results follow it
 * and will be kept.
 */
function findValidCutPoints(entries: SessionEntry[], startIndex: number, endIndex: number): number[] {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.type === "compaction") {
			continue;
		}
		if (sessionEntryToContextMessages(entry).some(isCutPointMessage)) {
			cutPoints.push(i);
		}
	}
	return cutPoints;
}

/**
 * Find the context-visible user-role message that starts the turn containing the given entry index.
 * Returns -1 if no turn start found before the index.
 */
export function findTurnStartIndex(entries: SessionEntry[], entryIndex: number, startIndex: number): number {
	for (let i = entryIndex; i >= startIndex; i--) {
		if (isTurnStartEntry(entries[i])) {
			return i;
		}
	}
	return -1;
}

export interface CutPointResult {
	/** Index of first entry to keep */
	firstKeptEntryIndex: number;
	/** Index of user message that starts the turn being split, or -1 if not splitting */
	turnStartIndex: number;
	/** Whether this cut splits a turn (cut point is not a user message) */
	isSplitTurn: boolean;
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 *
 * Algorithm: Walk backwards from newest, accumulating estimated message sizes.
 * Stop when we've accumulated >= keepRecentTokens. Cut at that point.
 *
 * Can cut at user OR assistant messages (never tool results). When cutting at an
 * assistant message with tool calls, its tool results come after and will be kept.
 *
 * Returns CutPointResult with:
 * - firstKeptEntryIndex: the entry index to start keeping from
 * - turnStartIndex: if cutting mid-turn, the user message that started that turn
 * - isSplitTurn: whether we're cutting in the middle of a turn
 *
 * Only considers entries between `startIndex` and `endIndex` (exclusive).
 */
export async function findCutPoint(
	entries: SessionEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens?: number,
	keepRecentMessages?: number,
	tokenCounter?: TokenCounter,
): Promise<CutPointResult> {
	const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

	if (cutPoints.length === 0) {
		return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
	}

	// Default: keep from the first valid cut point (keeps the most history).
	const keepAllIndex = cutPoints[0];
	const candidates: number[] = [];
	let countCut = startIndex;

	// Message-count budget: keep the last N context-visible entries.
	if (keepRecentMessages === 0) {
		countCut = cutPoints[cutPoints.length - 1];
		candidates.push(countCut);
	} else if (keepRecentMessages !== undefined && keepRecentMessages > 0) {
		let keptCount = 0;
		countCut = keepAllIndex;
		for (let i = endIndex - 1; i >= startIndex; i--) {
			const entry = entries[i];
			if (
				entry.type === "compaction" ||
				!sessionEntryToContextMessages(entry).some((message) => message.role !== "system")
			)
				continue;
			keptCount++;
			if (keptCount >= keepRecentMessages) {
				// Find the closest valid cut point at or before this entry.
				for (let c = cutPoints.length - 1; c >= 0; c--) {
					if (cutPoints[c] <= i) {
						countCut = cutPoints[c];
						break;
					}
				}
				break;
			}
		}
		candidates.push(countCut);
	}

	// Token budget: keep as much recent context as fits within keepRecentTokens.
	if (keepRecentTokens !== undefined) {
		let accumulatedTokens = 0;
		let tokenCut = keepRecentTokens === 0 ? cutPoints[cutPoints.length - 1] : keepAllIndex;
		let exceededBudget = false;
		const batchSize = tokenCounter ? 4 : 1;
		let nextIndex = endIndex - 1;
		// Never speculate beyond the stricter known message-count boundary.
		while (nextIndex >= countCut && !exceededBudget) {
			const batch: { index: number; messages: AgentMessage[] }[] = [];
			while (nextIndex >= countCut && batch.length < batchSize) {
				const index = nextIndex--;
				const entry = entries[index];
				if (entry.type === "compaction") continue;
				const messages = sessionEntryToContextMessages(entry).filter((message) => message.role !== "system");
				if (messages.length > 0) batch.push({ index, messages });
			}
			const controller = new AbortController();
			const counts = tokenCounter
				? batch.map((entry) =>
						Promise.resolve()
							.then(() => tokenCounter(entry.messages, controller.signal))
							.then(
								(tokens) => ({ ok: true as const, tokens }),
								(error: unknown) => ({ ok: false as const, error }),
							),
					)
				: batch.map((entry) => ({
						ok: true as const,
						tokens: entry.messages.reduce((sum, message) => sum + estimateTokens(message), 0),
					}));
			try {
				for (let index = 0; index < batch.length; index++) {
					const count = await counts[index];
					if (!count.ok) throw count.error;
					if (count.tokens === 0) continue;
					if (accumulatedTokens + count.tokens > keepRecentTokens) {
						exceededBudget = true;
						tokenCut =
							cutPoints.find((candidate) => candidate > batch[index].index) ?? cutPoints[cutPoints.length - 1];
						break;
					}
					accumulatedTokens += count.tokens;
				}
			} finally {
				controller.abort();
			}
		}
		candidates.push(tokenCut);
	}

	// When both budgets are given, the one that keeps fewer messages wins
	// ("shortest wins"), i.e. the larger firstKeptEntryIndex (more discarded).
	let cutIndex = candidates.length > 0 ? Math.max(...candidates) : keepAllIndex;

	// Scan backwards from cutIndex to include adjacent metadata entries that do not affect context.
	while (cutIndex > startIndex) {
		const prevEntry = entries[cutIndex - 1];
		// Stop at compaction boundaries or context-visible entries.
		if (prevEntry.type === "compaction" || sessionEntryToContextMessages(prevEntry).length > 0) {
			break;
		}
		cutIndex--;
	}

	// Determine if this is a split turn
	const cutEntry = entries[cutIndex];
	const startsTurn = isTurnStartEntry(cutEntry);
	const turnStartIndex = startsTurn ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

	return {
		firstKeptEntryIndex: cutIndex,
		turnStartIndex,
		isSplitTurn: !startsTurn && turnStartIndex !== -1,
	};
}

// ============================================================================
// Summarization
// ============================================================================

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/**
 * Returns an error message when a summarization response cannot safely be persisted.
 * A length stop contains partial text and must not become a session checkpoint.
 */
export function getSummarizationFailure(response: AssistantMessage, label: string): string | undefined {
	if (response.stopReason === "error") {
		return `${label} failed: ${response.errorMessage || "Unknown error"}`;
	}
	if (response.stopReason === "length") {
		return `${label} failed: generation hit the token cap and the summary is incomplete`;
	}
	return undefined;
}

/** Build one complete summary transcript before applying the normal context pipeline. */
async function buildAgentSummarizationContext(
	agent: Agent | undefined,
	messages: AgentMessage[],
	signal: AbortSignal | undefined,
	fallbackSystemPrompt: string | undefined,
): Promise<Message[]> {
	const baseline = agent && messages[0]?.role !== "system" ? getCurrentSystemMessage(agent.state.messages) : undefined;
	const source = structuredClone(baseline ? [baseline, ...messages] : messages);
	if (source[0]?.role !== "system") {
		source.unshift({ role: "system", content: fallbackSystemPrompt ?? SUMMARIZATION_SYSTEM_PROMPT, timestamp: 0 });
	}
	if (agent && source[0]?.role === "system" && source[0].toolsAdded === undefined) {
		source[0] = { ...source[0], toolsAdded: agent.state.tools.map(toToolDeclaration) };
	}
	const transformed = agent?.transformContext ? await agent.transformContext(source, signal) : source;
	// Policy sees the complete default checkpoint and may remove any part; do not restore it afterward.
	return agent ? await agent.convertForRequest(transformed) : convertToLlm(transformed);
}

function createSummarizationOptions(
	model: Model<any>,
	maxTokens: number,
	apiKey: string | undefined,
	headers: ProviderHeaders | undefined,
	env: Record<string, string> | undefined,
	signal: AbortSignal | undefined,
	thinkingLevel: ThinkingLevel | undefined,
	sessionId: string | undefined,
	agent?: Agent,
): SimpleStreamOptions {
	const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers, env, sessionId };
	if (agent) {
		options.transport = agent.transport;
		options.thinkingBudgets = agent.thinkingBudgets;
		options.maxRetryDelayMs = agent.maxRetryDelayMs;
		options.onPayload = agent.onPayload;
		options.onResponse = agent.onResponse;
	}
	if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
		options.reasoning = thinkingLevel;
	}
	return options;
}

/** Budget the converted request, never usage recorded against a different history. */
function getSummarizationMaxTokens(model: Model<Api>, inputTokens: number, maxTokens: number): number | undefined {
	const contextWindow = model.contextWindow > 0 ? model.contextWindow : 262144;
	const outputTokens = Math.min(
		Math.max(1, maxTokens),
		model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
		contextWindow - inputTokens,
	);
	return outputTokens >= 1 ? outputTokens : undefined;
}

/**
 * Shared choke point for every compaction/branch-summary summarization call. Wraps the
 * single LLM call in {@link retryAssistantCall} so transient stream drops (e.g.
 * `terminated`, socket close) honor the configured retry policy instead of failing
 * the whole compaction on the first attempt. Deterministic errors and aborts return
 * immediately (see {@link retryAssistantCall}).
 */
export async function completeSummarization(
	model: Model<any>,
	context: TranscriptContext | ((options: SimpleStreamOptions) => TranscriptContext | Promise<TranscriptContext>),
	options: SimpleStreamOptions,
	streamFn?: StreamFn,
	retry?: RetryPolicy,
	callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
	// Avoid cache writes for one-off summaries. Reuse caller-supplied routing when available;
	// callers without a session ID, including branch summaries, receive a fresh routing ID.
	const requestOptions: SimpleStreamOptions = {
		...options,
		cacheRetention: "none",
		sessionId: options.sessionId ?? uuidv7(),
	};
	const produce = async (): Promise<AssistantMessage> => {
		const attemptOptions = { ...requestOptions };
		const attemptContext = typeof context === "function" ? await context(attemptOptions) : structuredClone(context);
		// Historical usage cannot size a newly converted summary request. Copy only
		// assistant records here so builder-owned messages and canonical charges survive.
		const requestContext = attemptContext.messages.some((message) => message.role === "assistant")
			? {
					...attemptContext,
					messages: attemptContext.messages.map((message) =>
						message.role === "assistant"
							? {
									...message,
									usage: {
										input: 0,
										output: 0,
										cacheRead: 0,
										cacheWrite: 0,
										totalTokens: 0,
										cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
									},
								}
							: message,
					),
				}
			: attemptContext;
		return streamFn
			? (await streamFn(model, requestContext, attemptOptions)).result()
			: completeSimple(model, requestContext, attemptOptions);
	};
	return retryAssistantCall(produce, retry, requestOptions.signal, callbacks);
}

/** Generate a summary; earlier checkpoints belong in the ordered message prefix. */
export async function generateSummary(
	currentMessages: AgentMessage[],
	model: Model<any>,
	reserveTokens: number,
	apiKey: string | undefined,
	headers?: ProviderHeaders,
	signal?: AbortSignal,
	customInstructions?: string,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
	env?: Record<string, string>,
	retry?: RetryPolicy,
	callbacks?: RetryCallbacks,
	sessionId?: string,
	systemPrompt?: string,
	agent?: Agent,
): Promise<string> {
	return (
		await generateSummaryWithUsage(
			currentMessages,
			model,
			reserveTokens,
			apiKey,
			headers,
			signal,
			customInstructions,
			thinkingLevel,
			streamFn,
			env,
			retry,
			callbacks,
			sessionId,
			systemPrompt,
			agent,
		)
	).text;
}

/** Generate a checkpoint and return provider usage plus attributable file operations. */
export async function generateSummaryWithUsage(
	currentMessages: AgentMessage[],
	model: Model<any>,
	reserveTokens: number,
	apiKey: string | undefined,
	headers?: ProviderHeaders,
	signal?: AbortSignal,
	customInstructions?: string,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
	env?: Record<string, string>,
	retry?: RetryPolicy,
	callbacks?: RetryCallbacks,
	sessionId?: string,
	systemPrompt?: string,
	agent?: Agent,
	requestHistoryPolicy?: RequestHistoryPolicy,
	/** Native dispatch capability, independent of history attribution and upload permission. */
	usesAdapterOutputClamp: (model: Model<Api>) => boolean = (requestModel) =>
		(!streamFn || streamFn === streamSimple) &&
		isContextClampingApi(requestModel.api) &&
		isKnownApiProvider(requestModel.api),
): Promise<{ text: string; usage: Usage; fileOps: FileOperations }> {
	const maxTokens = Math.min(
		Math.floor(0.8 * reserveTokens),
		model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
	);

	// Previous checkpoints remain context messages, not a target to fold into this summary.
	let basePrompt = SUMMARIZATION_PROMPT;
	if (customInstructions) {
		basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
	}

	// Reuse the same context pipeline as a normal turn so provider prompt caches
	// stay valid. When an agent is provided, apply its transformContext and
	// convertToLlm exactly as a normal request would. The summarization
	// instruction is appended as a final user message so nothing is inserted
	// before the existing prefix.
	const sourceMessages = structuredClone(currentMessages);

	const instructionText = `Do not continue the conversation above. Output only the structured summary requested below.\n\n${basePrompt}`;
	let fileOps = createFileOps();
	let attributable = false;

	const buildContext = async (attemptOptions: SimpleStreamOptions): Promise<TranscriptContext> => {
		const llmMessages = await buildAgentSummarizationContext(agent, sourceMessages, signal, systemPrompt);
		const instruction: Message = {
			role: "user",
			content: [{ type: "text", text: instructionText }],
			timestamp: Date.now(),
		};
		let context = normalizeContext({ messages: [...llmMessages, instruction] });
		const hasToolHistory = llmMessages.some((message) => message.role === "toolResult");
		const inputTokens = hasToolHistory
			? context.messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
			: 0;
		let outputTokens = hasToolHistory ? getSummarizationMaxTokens(model, inputTokens, maxTokens) : undefined;
		// Preserve tiny-window and intentional one-token controls; otherwise avoid
		// admitting a request that leaves only the native adapter's emergency floor.
		const hasAdapterHeadroom =
			hasToolHistory &&
			usesAdapterOutputClamp(model) &&
			(!agent || !streamFn || streamFn === agent.streamFunction) &&
			clampMaxTokensToInput(model, 0, maxTokens) > 1;
		const exhaustedHeadroom =
			hasAdapterHeadroom &&
			outputTokens !== undefined &&
			clampMaxTokensToInput(model, inputTokens, outputTokens) === 1;
		if (hasToolHistory && (outputTokens === undefined || exhaustedHeadroom)) {
			// Bound only converted, replay-eligible history; never restore raw data or
			// move the committed retention boundary to accommodate a smaller model.
			const baseline = getCurrentSystemMessage(llmMessages);
			context = normalizeContext({
				messages: [
					...(baseline ? [baseline] : []),
					{
						role: "user",
						content: serializeConversation(transformMessages(llmMessages, model)),
						timestamp: Date.now(),
					},
					instruction,
				],
			});
			const boundedInputTokens = context.messages.reduce(
				(total, message) => total + estimateMessageTokens(message),
				0,
			);
			outputTokens = getSummarizationMaxTokens(model, boundedInputTokens, maxTokens);
			if (hasAdapterHeadroom && outputTokens !== undefined) {
				outputTokens = clampMaxTokensToInput(model, boundedInputTokens, outputTokens);
			}
			if (outputTokens === undefined || (hasAdapterHeadroom && outputTokens <= 1)) {
				throw new Error("Summarization failed: converted history exceeds the token budget");
			}
		}
		if (hasToolHistory) attemptOptions.maxTokens = outputTokens;
		fileOps = createFileOps();
		attributable = canAttributeRequestHistory(model, agent, streamFn, requestHistoryPolicy);
		if (attributable) {
			for (const message of llmMessages) {
				if (message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted")
					extractFileOpsFromMessage(message, fileOps);
			}
		}
		// Context/converter work can replace the policy while awaiting; read it immediately before dispatch.
		if (agent) attemptOptions.onPayload = agent.onPayload;
		return context;
	};

	const completionOptions = createSummarizationOptions(
		model,
		maxTokens,
		apiKey,
		headers,
		env,
		signal,
		thinkingLevel,
		sessionId,
		agent,
	);

	const response = await completeSummarization(model, buildContext, completionOptions, streamFn, retry, callbacks);

	const failure = getSummarizationFailure(response, "Summarization");
	if (failure) {
		throw new Error(failure);
	}
	if (response.content.some((block) => block.type === "toolCall")) {
		throw new Error("Summarization attempted to call a tool");
	}

	const textContent = contentText(response.content);

	return {
		text: textContent,
		usage: response.usage,
		fileOps:
			attributable && canAttributeRequestHistory(model, agent, streamFn, requestHistoryPolicy)
				? fileOps
				: createFileOps(),
	};
}

// ============================================================================
// Compaction Preparation (for extensions)
// ============================================================================

export interface CompactionPreparation {
	/** UUID of first entry to keep */
	firstKeptEntryId: string;
	/** Messages that will be summarized and discarded */
	messagesToSummarize: AgentMessage[];
	/** Messages that will be turned into turn prefix summary (if splitting) */
	turnPrefixMessages: AgentMessage[];
	/** Whether this is a split turn (cut point in middle of turn) */
	isSplitTurn: boolean;
	tokensBefore: number;
	/** Summary from previous compaction, for iterative update */
	previousSummary?: string;
	/** File operations extracted from messagesToSummarize */
	fileOps: FileOperations;
	/** Compaction settions from settings.jsonl	*/
	settings: CompactionSettings;
}

export interface CompactionOverrides {
	keepRecentTokens?: number;
	keepRecentMessages?: number;
}

function isProjectedTurnStart(entry: ProjectedSessionEntry): boolean {
	if (entry.sourceEntry.type === "compaction") return false;
	return entry.messages.some(isTurnStartMessage);
}

function findProjectedTurnStartIndex(entries: ProjectedSessionEntry[], entryIndex: number, startIndex: number): number {
	for (let i = entryIndex; i >= startIndex; i--) {
		if (isProjectedTurnStart(entries[i])) return i;
	}
	return -1;
}

async function findProjectedCutPoint(
	entries: ProjectedSessionEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens: number | undefined,
	keepRecentMessages: number | undefined,
	tokenCounter?: TokenCounter,
): Promise<CutPointResult> {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.sourceEntry.type !== "compaction" && entry.messages.some(isCutPointMessage)) cutPoints.push(i);
	}
	if (cutPoints.length === 0) {
		return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
	}

	// Default: keep from the first valid cut point (keeps the most history).
	const keepAllIndex = cutPoints[0];
	const candidates: number[] = [];
	let countCut = startIndex;

	// Message-count budget: keep the last N context-visible entries.
	if (keepRecentMessages === 0) {
		countCut = cutPoints[cutPoints.length - 1];
		candidates.push(countCut);
	} else if (keepRecentMessages !== undefined && keepRecentMessages > 0) {
		let keptCount = 0;
		countCut = keepAllIndex;
		for (let i = endIndex - 1; i >= startIndex; i--) {
			if (
				entries[i].sourceEntry.type === "compaction" ||
				!entries[i].messages.some((message) => message.role !== "system")
			)
				continue;
			keptCount++;
			if (keptCount >= keepRecentMessages) {
				for (let c = cutPoints.length - 1; c >= 0; c--) {
					if (cutPoints[c] <= i) {
						countCut = cutPoints[c];
						break;
					}
				}
				break;
			}
		}
		candidates.push(countCut);
	}

	// Token budget: keep as much recent context as fits within keepRecentTokens.
	let exceededBudget = false;
	if (keepRecentTokens !== undefined) {
		let accumulatedTokens = 0;
		let tokenCut = keepRecentTokens === 0 ? cutPoints[cutPoints.length - 1] : keepAllIndex;
		const batchSize = tokenCounter ? 4 : 1;
		let nextIndex = endIndex - 1;
		while (nextIndex >= countCut && !exceededBudget) {
			const batch: { index: number; messages: AgentMessage[] }[] = [];
			while (nextIndex >= countCut && batch.length < batchSize) {
				const index = nextIndex--;
				if (entries[index].sourceEntry.type === "compaction") continue;
				const messages = entries[index].messages.filter((message) => message.role !== "system");
				if (messages.length > 0) batch.push({ index, messages });
			}
			const controller = new AbortController();
			// Observe every rejection immediately, even when an earlier count establishes the cutoff.
			const counts = tokenCounter
				? batch.map((entry) =>
						Promise.resolve()
							.then(() => tokenCounter(entry.messages, controller.signal))
							.then(
								(tokens) => ({ ok: true as const, tokens }),
								(error: unknown) => ({ ok: false as const, error }),
							),
					)
				: batch.map((entry) => ({
						ok: true as const,
						tokens: entry.messages.reduce((sum, message) => sum + estimateTokens(message), 0),
					}));
			try {
				for (let index = 0; index < batch.length; index++) {
					const count = await counts[index];
					if (!count.ok) throw count.error;
					if (count.tokens === 0) continue;
					if (accumulatedTokens + count.tokens > keepRecentTokens) {
						exceededBudget = true;
						tokenCut =
							cutPoints.find((candidate) => candidate > batch[index].index) ?? cutPoints[cutPoints.length - 1];
						break;
					}
					accumulatedTokens += count.tokens;
				}
			} finally {
				controller.abort();
			}
		}
		candidates.push(tokenCut);
	}

	// When both budgets are given, the one that keeps fewer messages wins
	// ("shortest wins"), i.e. the larger firstKeptEntryIndex (more discarded).
	let cutIndex = candidates.length > 0 ? Math.max(...candidates) : keepAllIndex;

	// A recovery attempt and its omission edits are context-invisible after the last
	// visible input. Advance only for a closed suffix containing an omitted assistant
	// attempt; arbitrary metadata must not move the cut past unsent input.
	const suffix = entries.slice(cutIndex + 1, endIndex);
	const isIntrinsicallyVisible = (entry: ProjectedSessionEntry): boolean =>
		entry.sourceEntry.type !== "context_edit" && sessionEntryToContextMessages(entry.sourceEntry).length > 0;
	const isOmitted = (entry: ProjectedSessionEntry): boolean =>
		isIntrinsicallyVisible(entry) && entry.messages.length === 0;
	const omittedSuffixIds = new Set(suffix.filter(isOmitted).map((entry) => entry.sourceEntry.id));
	const hasExternalReplacement = suffix.some(
		(entry) =>
			entry.sourceEntry.type === "context_edit" &&
			entry.sourceEntry.replacement !== null &&
			!omittedSuffixIds.has(entry.sourceEntry.targetId),
	);
	const isRecoveryOmissionSuffix =
		exceededBudget &&
		!hasExternalReplacement &&
		suffix.some(
			(entry) =>
				entry.sourceEntry.type === "message" && entry.sourceEntry.message.role === "assistant" && isOmitted(entry),
		) &&
		suffix.every(
			(entry) => entry.sourceEntry.type !== "compaction" && (!isIntrinsicallyVisible(entry) || isOmitted(entry)),
		);
	if (isRecoveryOmissionSuffix) cutIndex++;

	while (cutIndex > startIndex) {
		const previous = entries[cutIndex - 1];
		if (previous.sourceEntry.type === "compaction" || previous.messages.length > 0) break;
		cutIndex--;
	}
	const startsTurn = isProjectedTurnStart(entries[cutIndex]);
	const turnStartIndex = startsTurn ? -1 : findProjectedTurnStartIndex(entries, cutIndex, startIndex);
	return {
		firstKeptEntryIndex: cutIndex,
		turnStartIndex,
		isSplitTurn: !startsTurn && turnStartIndex !== -1,
	};
}

export async function prepareCompaction(
	pathEntries: SessionEntry[],
	settings: CompactionSettings,
	overrides?: CompactionOverrides,
	tokenCounter?: TokenCounter,
): Promise<CompactionPreparation | undefined> {
	if (pathEntries.length > 0 && pathEntries[pathEntries.length - 1].type === "compaction") {
		return undefined;
	}

	const projection = buildSessionProjection(pathEntries, undefined, undefined, {
		summaryBlockMaxTokens: settings.summaryBlockMaxTokens,
	});
	const projectedEntries = projection.entries;
	const sourceEntries = projectedEntries.map((entry) => entry.sourceEntry);
	// Summaries occupy the prefix oldest-first; new history starts after the newest.
	const prevCompactionIndex = projectedEntries.findLastIndex(
		(entry) => entry.sourceEntry.type === "compaction" && entry.messages.length > 0,
	);

	let previousSummary: string | undefined;
	let boundaryStart = 0;
	if (prevCompactionIndex >= 0) {
		previousSummary = (projectedEntries[prevCompactionIndex].sourceEntry as CompactionEntry).summary;
		// The canonical projection has already selected the previous compaction's retained tail.
		boundaryStart = prevCompactionIndex + 1;
	}
	const boundaryEnd = projectedEntries.length;
	const tokensBefore = estimateProjectedContextTokens(projection, pathEntries).tokens;

	// Apply only the budgets the caller explicitly set. When neither is given,
	// fall back to the configured token budget. This lets `/compact 10` keep 10
	// messages without also being clamped by the default token budget.
	const keepRecentMessages = overrides?.keepRecentMessages;
	const keepRecentTokens =
		overrides?.keepRecentTokens ??
		(overrides?.keepRecentMessages === undefined ? settings.keepRecentTokens : undefined);
	const cutPoint = await findProjectedCutPoint(
		projectedEntries,
		boundaryStart,
		boundaryEnd,
		keepRecentTokens,
		keepRecentMessages,
		tokenCounter,
	);

	const firstKeptEntry = projectedEntries[cutPoint.firstKeptEntryIndex]?.sourceEntry;
	if (!firstKeptEntry?.id) return undefined;
	const firstKeptEntryId = firstKeptEntry.id;
	const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

	const messagesToSummarize = projectedEntries
		.slice(boundaryStart, historyEnd)
		.flatMap((entry) => (entry.sourceEntry.type === "compaction" ? [] : entry.messages));
	const turnPrefixMessages = cutPoint.isSplitTurn
		? projectedEntries
				.slice(cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
				.flatMap((entry) => (entry.sourceEntry.type === "compaction" ? [] : entry.messages))
		: [];

	if (
		!messagesToSummarize.some((message) => message.role !== "system") &&
		!turnPrefixMessages.some((message) => message.role !== "system")
	)
		return undefined;

	// Reuse the visible checkpoint, summaries and later prompt/tool deltas.
	// compact() appends the split-turn remainder before its instruction.
	messagesToSummarize.unshift(...projectedEntries.slice(0, boundaryStart).flatMap((entry) => entry.messages));

	// Extract file operations from edited model-visible messages and the previous compaction.
	const fileOps = extractFileOperations(messagesToSummarize, sourceEntries, prevCompactionIndex);

	// Also extract file ops from turn prefix if splitting
	if (cutPoint.isSplitTurn) {
		for (const msg of turnPrefixMessages) {
			extractFileOpsFromMessage(msg, fileOps);
		}
	}

	return {
		firstKeptEntryId,
		messagesToSummarize,
		turnPrefixMessages,
		isSplitTurn: cutPoint.isSplitTurn,
		tokensBefore,
		previousSummary,
		fileOps,
		settings,
	};
}

// ============================================================================
// Main compaction function
// ============================================================================

/**
 * Generate summaries for compaction using prepared data.
 * Returns CompactionResult - SessionManager adds uuid/parentUuid when saving.
 *
 * @param preparation - Pre-calculated preparation from prepareCompaction()
 * @param customInstructions - Optional custom focus for the summary
 * @param sessionId - Optional routing session ID forwarded without enabling prompt caching
 */
export async function compact(
	preparation: CompactionPreparation,
	model: Model<any>,
	apiKey: string | undefined,
	headers?: ProviderHeaders,
	customInstructions?: string,
	signal?: AbortSignal,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
	env?: Record<string, string>,
	retry?: RetryPolicy,
	callbacks?: RetryCallbacks,
	sessionId?: string,
	systemPrompt?: string,
	agent?: Agent,
	requestHistoryPolicy?: RequestHistoryPolicy,
	usesAdapterOutputClamp?: (model: Model<Api>) => boolean,
): Promise<CompactionResult> {
	const { firstKeptEntryId, messagesToSummarize, turnPrefixMessages, isSplitTurn, tokensBefore, settings } =
		preparation;

	// Summarize exactly the chat messages being replaced (previous summaries + history + turn
	// prefix) in a single call. The request is byte-identical to a normal chat request up to the
	// cut point (only the summarization instruction is appended at the end), so the provider KV
	// cache is reused. A split turn is NOT split into separate history/turn-prefix calls: the
	// turn prefix must stay in the same request as the history, otherwise the request head
	// diverges from the chat and the cache drops everything after the divergence.
	const allMessages =
		isSplitTurn && turnPrefixMessages.length > 0
			? [...messagesToSummarize, ...turnPrefixMessages]
			: messagesToSummarize;
	const result = await generateSummaryWithUsage(
		allMessages,
		model,
		settings.reserveTokens,
		apiKey,
		headers,
		signal,
		customInstructions,
		thinkingLevel,
		streamFn,
		env,
		retry,
		callbacks,
		sessionId,
		systemPrompt,
		agent,
		requestHistoryPolicy,
		usesAdapterOutputClamp,
	);
	let summary = result.text;
	const summaryUsage = result.usage;

	// Compute file lists and append to summary
	const { readFiles, modifiedFiles } = computeFileLists(result.fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);

	if (!firstKeptEntryId) {
		throw new Error("First kept entry has no UUID - session may need migration");
	}

	return {
		summary,
		firstKeptEntryId,
		tokensBefore,
		usage: summaryUsage,
		details: { readFiles, modifiedFiles } as CompactionDetails,
	};
}
