/**
 * Message edit XML format for the `/edit` command.
 *
 * Edit messages start with `<pi_edit>` and contain one or more blocks like
 * `<pi_edit id="N" role="assistant">...</pi_edit>` or
 * `<pi_edit id="N" role="user">...</pi_edit>`. Positive ids replace existing
 * messages counting from the latest message (0 = latest). Negative ids add new
 * messages, sorted by id in descending order.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	AssistantMessage,
	ImageContent,
	JsonObject,
	Message,
	TextContent,
	ThinkingContent,
	ToolCall,
	UserMessage,
} from "@earendil-works/pi-ai/compat";

export interface ParsedEditBlock {
	id: number;
	role: "user" | "assistant";
	content: (TextContent | ThinkingContent | ToolCall | ImageContent)[];
}

/**
 * A `<pi_swipe timestamp="..." role="...">` block: an in-place edit of one
 * existing swipe version. The timestamp identifies the version (its entry
 * timestamp); applying the block never creates a new version and never
 * changes the version's position.
 */
export interface ParsedSwipeBlock {
	timestamp: string;
	role: "user" | "assistant";
	content: (TextContent | ThinkingContent | ToolCall | ImageContent)[];
}

interface TagMatch {
	name: string;
	attributes: Record<string, string>;
	start: number;
	end: number;
	isClosing: boolean;
}

function escapeXmlAttr(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const XML_ATTR_ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">" };

function parseTag(tagText: string): { name: string; attributes: Record<string, string>; isClosing: boolean } {
	const isClosing = tagText.startsWith("</");
	const inner = tagText.slice(isClosing ? 2 : 1, -1).trim();
	const nameMatch = inner.match(/^[\w:-]+/);
	const name = nameMatch?.[0] ?? "";
	const attrString = inner.slice(name.length).trim();
	const attributes: Record<string, string> = {};
	const attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
	let match: RegExpExecArray | null = attrRegex.exec(attrString);
	while (match !== null) {
		const attrName = match[1];
		const attrValue = match[2] ?? match[3] ?? "";
		attributes[attrName] = attrValue.replace(/&(?:amp|quot|lt|gt);/g, (entity) => XML_ATTR_ENTITIES[entity]);
		match = attrRegex.exec(attrString);
	}
	return { name, attributes, isClosing };
}

const FORMAT_TAG_START = /<\/?(?:pi_edit|pi_swipe|pi_content|pi_tool_call|pi_image|pi_reasoning_content)(?=[\s/>])/g;

function findNextTag(text: string, pos: number): TagMatch | undefined {
	FORMAT_TAG_START.lastIndex = pos;
	for (let match = FORMAT_TAG_START.exec(text); match !== null; match = FORMAT_TAG_START.exec(text)) {
		const start = match.index;
		let i = start + match[0].length;
		let inQuote: string | undefined;
		while (i < text.length) {
			const ch = text[i];
			// Formatter escapes attribute angles; a nested '<' denotes literal prose.
			if (ch === "<") break;
			if (inQuote) {
				if (ch === inQuote) inQuote = undefined;
			} else if (ch === '"' || ch === "'") inQuote = ch;
			else if (ch === ">") {
				const parsed = parseTag(text.slice(start, i + 1));
				return { ...parsed, start, end: i + 1 };
			}
			i++;
		}
		FORMAT_TAG_START.lastIndex = start + 1;
	}
	return undefined;
}

function findBlockClose(text: string, startPos: number, tagName: string): { start: number; end: number } | undefined {
	let pos = startPos;
	while (pos < text.length) {
		const tag = findNextTag(text, pos);
		if (!tag) return undefined;
		if (tag.name === tagName && tag.isClosing) {
			let after = tag.end;
			while (after < text.length && /\s/.test(text[after])) after++;
			if (
				after >= text.length ||
				text.slice(after, after + 8) === "<pi_edit" ||
				text.slice(after, after + 9) === "<pi_swipe"
			) {
				return { start: tag.start, end: tag.end };
			}
		}
		pos = tag.end;
	}
	return undefined;
}

function findFirstOpeningTag(
	text: string,
	pos: number,
	tagName: string,
): { start: number; end: number; attributes: Record<string, string> } | undefined {
	let p = pos;
	while (p < text.length) {
		const tag = findNextTag(text, p);
		if (!tag) return undefined;
		if (tag.name === tagName && !tag.isClosing) {
			return { start: tag.start, end: tag.end, attributes: tag.attributes };
		}
		p = tag.end;
	}
	return undefined;
}

function findFirstClosingTag(text: string, pos: number, tagName: string): { start: number; end: number } | undefined {
	let p = pos;
	while (p < text.length) {
		const tag = findNextTag(text, p);
		if (!tag) return undefined;
		if (tag.name === tagName && tag.isClosing) return { start: tag.start, end: tag.end };
		p = tag.end;
	}
	return undefined;
}

/**
 * Find the last closing tag of `tagName` located at or after `fromPos` but
 * strictly before `beforePos`. Returns undefined if none exists.
 */
function findLastClosingTagBefore(
	text: string,
	fromPos: number,
	beforePos: number,
	tagName: string,
): { start: number; end: number } | undefined {
	let last: { start: number; end: number } | undefined;
	let p = fromPos;
	while (p < beforePos && p < text.length) {
		const tag = findNextTag(text, p);
		if (!tag || tag.start >= beforePos) break;
		if (tag.name === tagName && tag.isClosing) last = { start: tag.start, end: tag.end };
		p = tag.end;
	}
	return last;
}

/**
 * Start of the first `tagName` opening that directly follows (after optional
 * whitespace) a `</closeName>` at or after `fromPos`. Sections are formatted
 * back to back, so only an adjacent opening starts the next section; a stray
 * opening elsewhere inside raw text does not.
 */
function findAdjacentOpeningTag(text: string, fromPos: number, closeName: string, tagName: string): number | undefined {
	let close = findFirstClosingTag(text, fromPos, closeName);
	while (close) {
		let next = close.end;
		while (next < text.length && /\s/.test(text[next])) next++;
		const tag = findNextTag(text, next);
		if (tag?.start === next && tag.name === tagName && !tag.isClosing) return next;
		close = findFirstClosingTag(text, close.end, closeName);
	}
	return undefined;
}

/**
 * Closing tag of a section whose first closing is `firstClose`: the furthest
 * closing still before the next section, so stray closing tags inside the raw
 * body do not end it early. The next section starts at the first opening of a
 * `boundaryTags` tag after `firstClose`, or at an `adjacentTags` opening that
 * directly follows one of this section's closings.
 */
function findSectionClose(
	text: string,
	openEnd: number,
	firstClose: { start: number; end: number },
	sectionName: string,
	boundaryTags: readonly string[],
	adjacentTags: readonly string[],
): { start: number; end: number } {
	let boundary = text.length;
	for (const tagName of boundaryTags) {
		const open = findFirstOpeningTag(text, firstClose.end, tagName);
		if (open && open.start < boundary) boundary = open.start;
	}
	for (const tagName of adjacentTags) {
		const start = findAdjacentOpeningTag(text, firstClose.start, sectionName, tagName);
		if (start !== undefined && start < boundary) boundary = start;
	}
	return findLastClosingTagBefore(text, openEnd, boundary, sectionName) ?? firstClose;
}

function reasoningBlock(thinking: string, attributes: Record<string, string>): ThinkingContent {
	const block: ThinkingContent = { type: "thinking", thinking };
	if (attributes.signature) block.thinkingSignature = attributes.signature;
	if (attributes.redacted === "true") block.redacted = true;
	return block;
}

function findToolCallClose(
	text: string,
	openEnd: number,
): { close: { start: number; end: number }; args: JsonObject } | undefined {
	let close = findFirstClosingTag(text, openEnd, "pi_tool_call");
	while (close) {
		const args = parseToolCallArguments(text.slice(openEnd, close.start));
		if (args !== undefined) return { close, args };
		close = findFirstClosingTag(text, close.end, "pi_tool_call");
	}
	return undefined;
}

/**
 * Returns true if the given text starts with a `<pi_edit>` or `<pi_swipe>`
 * tag (after optional leading whitespace). Messages that contain one later in
 * the text are treated as normal messages, not edit commands.
 */
export function isMessageEdit(text: string): boolean {
	return /^<pi_(edit|swipe)[>\s/]/.test(text.trimStart());
}

/**
 * Parse all `<pi_edit>` and `<pi_swipe>` blocks from the start of the text.
 * Returns empty blocks if parsing fails or no valid blocks are found; any
 * invalid block or trailing content invalidates the whole text.
 */
export function parseMessageEditsAndSwipes(text: string): { edits: ParsedEditBlock[]; swipes: ParsedSwipeBlock[] } {
	const empty: { edits: ParsedEditBlock[]; swipes: ParsedSwipeBlock[] } = { edits: [], swipes: [] };
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("<pi_edit") && !trimmed.startsWith("<pi_swipe")) return empty;

	const result = { edits: [] as ParsedEditBlock[], swipes: [] as ParsedSwipeBlock[] };
	let pos = 0;

	while (pos < trimmed.length) {
		const openTag = findNextTag(trimmed, pos);
		if (!openTag || openTag.isClosing || (openTag.name !== "pi_edit" && openTag.name !== "pi_swipe")) return empty;

		const role = openTag.attributes.role;
		if (role !== "user" && role !== "assistant") return empty;

		const close = findBlockClose(trimmed, openTag.end, openTag.name);
		if (!close) return empty;

		const content = trimmed.slice(openTag.end, close.start);
		const parsedContent = parseInnerContent(content, role);
		if (openTag.name === "pi_edit") {
			const id = Number.parseInt(openTag.attributes.id ?? "", 10);
			if (Number.isNaN(id)) return empty;
			result.edits.push({ id, role, content: parsedContent });
		} else {
			const timestamp = openTag.attributes.timestamp ?? "";
			if (timestamp === "") return empty;
			result.swipes.push({ timestamp, role, content: parsedContent });
		}

		pos = close.end;
		while (pos < trimmed.length && /\s/.test(trimmed[pos])) pos++;
	}

	return result;
}

/**
 * Parse all `<pi_edit>` blocks from the start of the text. Returns an empty
 * array if parsing fails or no valid blocks are found.
 */
export function parseMessageEdits(text: string): ParsedEditBlock[] {
	return parseMessageEditsAndSwipes(text).edits;
}

function parseInnerContent(
	content: string,
	role: "user" | "assistant",
): (TextContent | ThinkingContent | ToolCall | ImageContent)[] {
	const blocks: (TextContent | ThinkingContent | ToolCall | ImageContent)[] = [];
	let rest = content;

	if (role === "assistant") {
		// Leading reasoning sections, one per thinking block. The formatted tag
		// may carry attributes (`signature="..."` and/or `redacted="true"`), so
		// match the opening tag with optional attributes.
		while (true) {
			const leadingWhitespace = rest.match(/^\s*/)?.[0] ?? "";
			const reasoningOpenMatch = rest.slice(leadingWhitespace.length).match(/^<pi_reasoning_content(\s[^>]*)?>/);
			if (!reasoningOpenMatch) break;
			const openStart = leadingWhitespace.length;
			const openEnd = openStart + reasoningOpenMatch[0].length;
			// The first closing is found without treating any other tag as a
			// boundary: until it is found, `<pi_content>` / `<pi_tool_call>` tags
			// inside the reasoning text are stray content being discussed.
			const firstClose = findFirstClosingTag(rest, openEnd, "pi_reasoning_content");
			if (!firstClose) break;
			// With the reasoning block confirmed, later sections become valid
			// boundaries, so stray reasoning tags inside the reasoning text do not
			// split it and stray tags in later sections are excluded.
			const reasoningClose = findSectionClose(
				rest,
				openEnd,
				firstClose,
				"pi_reasoning_content",
				["pi_content", "pi_tool_call"],
				["pi_reasoning_content"],
			);
			blocks.push(
				reasoningBlock(rest.slice(openEnd, reasoningClose.start), findNextTag(rest, openStart)?.attributes ?? {}),
			);
			rest = rest.slice(reasoningClose.end);
		}
	}

	const specialTagName = role === "assistant" ? "pi_tool_call" : "pi_image";

	// Main content section. Current format wraps it in `<pi_content>...</pi_content>`;
	// older messages used bare text followed by trailing special blocks, which is
	// still supported below as a fallback.
	const leadingWs = rest.match(/^\s*/)?.[0] ?? "";
	const contentOpenMatch = rest.slice(leadingWs.length).match(/^<pi_content(\s[^>]*)?>/);
	const firstTag = findNextTag(rest, leadingWs.length);
	let hasLeadingToolSections = false;
	if (role === "assistant" && firstTag?.start === leadingWs.length && !firstTag.isClosing) {
		let tag: TagMatch | undefined = firstTag;
		while (tag?.name === "pi_tool_call" && !tag.isClosing) {
			const tool = findToolCallClose(rest, tag.end);
			if (!tool) break;
			let nextPos = tool.close.end;
			while (nextPos < rest.length && /\s/.test(rest[nextPos])) nextPos++;
			tag = findNextTag(rest, nextPos);
			if (!tag || tag.start !== nextPos || tag.isClosing) break;
			if (tag.name === "pi_content" || tag.name === "pi_reasoning_content") {
				hasLeadingToolSections = true;
				break;
			}
		}
	}
	if (
		role === "assistant" &&
		firstTag?.start === leadingWs.length &&
		!firstTag.isClosing &&
		(firstTag.name === "pi_content" || hasLeadingToolSections)
	) {
		blocks.push(...parseSpecialBlocksForward(rest, specialTagName, role));
	} else if (contentOpenMatch) {
		const openStart = leadingWs.length;
		const openEnd = openStart + contentOpenMatch[0].length;
		const firstClose = findFirstClosingTag(rest, openEnd, "pi_content");
		if (firstClose) {
			const specialOpen = findFirstOpeningTag(rest, firstClose.end, specialTagName);
			const boundary = specialOpen?.start ?? rest.length;
			const contentClose = findLastClosingTagBefore(rest, openEnd, boundary, "pi_content") ?? firstClose;
			const text = rest.slice(openEnd, contentClose.start);
			if (text.trim().length > 0) blocks.push({ type: "text", text });
			blocks.push(...parseSpecialBlocksForward(rest.slice(contentClose.end), specialTagName, role));
		} else {
			// No closing `<pi_content>`: treat everything as raw text.
			const text = rest.slice(openEnd);
			if (text.trim().length > 0) blocks.push({ type: "text", text });
		}
	} else {
		// Legacy bare-text format: text runs up to the trailing special blocks.
		const { specialBlocks, textEnd } = parseTrailingSpecialBlocks(rest, specialTagName, role);
		const text = rest.slice(0, textEnd);
		if (text.trim().length > 0) blocks.push({ type: "text", text });
		blocks.push(...specialBlocks);
	}

	return blocks;
}

function parseToolCallArguments(text: string): JsonObject | undefined {
	let args: unknown;
	try {
		args = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (args === null || typeof args !== "object" || Array.isArray(args)) {
		throw new Error("Tool-call arguments must be a JSON object.");
	}
	return args as JsonObject;
}

/**
 * Parse formatted sections in order: assistant text/reasoning/tool calls or user
 * images. Each block's closing tag is the furthest closing still before the next
 * section opening, so stray closing tags inside raw bodies are ignored.
 */
function parseSpecialBlocksForward(
	region: string,
	tagName: string,
	role: "user" | "assistant",
): (TextContent | ThinkingContent | ToolCall | ImageContent)[] {
	const blocks: (TextContent | ThinkingContent | ToolCall | ImageContent)[] = [];
	const sectionNames = role === "assistant" ? [tagName, "pi_content", "pi_reasoning_content"] : [tagName];
	const adjacentTags = role === "assistant" ? ["pi_reasoning_content"] : [];
	let pos = 0;
	while (pos < region.length) {
		let open: { start: number; end: number; attributes: Record<string, string> } | undefined;
		let sectionName = tagName;
		for (const name of sectionNames) {
			const candidate = findFirstOpeningTag(region, pos, name);
			if (candidate && (!open || candidate.start < open.start)) {
				open = candidate;
				sectionName = name;
			}
		}
		if (!open) break;
		const firstClose = findFirstClosingTag(region, open.end, sectionName);
		if (!firstClose) {
			if (sectionName === "pi_content") {
				const text = region.slice(open.end);
				if (text.trim().length > 0) blocks.push({ type: "text", text });
			}
			break;
		}
		const boundaryTags = sectionName === "pi_reasoning_content" ? ["pi_content", tagName] : [tagName];
		let close = findSectionClose(region, open.end, firstClose, sectionName, boundaryTags, adjacentTags);
		const inner = region.slice(open.end, close.start);

		if (sectionName === "pi_content") {
			if (inner.trim().length > 0) blocks.push({ type: "text", text: inner });
		} else if (sectionName === "pi_reasoning_content") {
			blocks.push(reasoningBlock(inner, open.attributes));
		} else if (role === "assistant") {
			const tool = findToolCallClose(region, open.end);
			const args = tool?.args ?? {};
			// Invalid JSON retains the legacy furthest close before the next section.
			if (tool) close = tool.close;
			const toolCall: ToolCall = {
				type: "toolCall",
				id: open.attributes.id ?? "",
				name: open.attributes.name ?? "",
				arguments: args,
			};
			if (open.attributes.thoughtSignature) toolCall.thoughtSignature = open.attributes.thoughtSignature;
			blocks.push(toolCall);
		} else {
			const mimeType = open.attributes.mimeType || open.attributes.mime_type || "image/png";
			blocks.push({ type: "image", data: inner, mimeType });
		}
		pos = close.end;
	}
	return blocks;
}

function parseTrailingSpecialBlocks(
	content: string,
	tagName: string,
	role: "user" | "assistant",
): { specialBlocks: (ToolCall | ImageContent)[]; textEnd: number } {
	const specialBlocks: (ToolCall | ImageContent)[] = [];
	let end = content.length;

	while (true) {
		// Ignore separator whitespace only when locating a trailing special block.
		let tagEnd = end;
		while (tagEnd > 0 && /\s/.test(content[tagEnd - 1])) tagEnd--;
		const closeText = `</${tagName}>`;
		if (tagEnd < closeText.length || content.slice(tagEnd - closeText.length, tagEnd) !== closeText) break;
		const closeStart = tagEnd - closeText.length;
		const open = findPreviousOpeningTag(content, closeStart, tagName);
		if (!open) break;

		if (role === "assistant") {
			const argsText = content.slice(open.end, closeStart);
			const args = parseToolCallArguments(argsText) ?? {};
			const toolCall: ToolCall = {
				type: "toolCall",
				id: open.attributes.id ?? "",
				name: open.attributes.name ?? "",
				arguments: args,
			};
			if (open.attributes.thoughtSignature) toolCall.thoughtSignature = open.attributes.thoughtSignature;
			specialBlocks.unshift(toolCall);
		} else {
			const data = content.slice(open.end, closeStart);
			const mimeType = open.attributes.mimeType || open.attributes.mime_type || "image/png";
			specialBlocks.unshift({ type: "image", data, mimeType });
		}

		end = open.start;
	}

	return { specialBlocks, textEnd: end };
}

function findPreviousOpeningTag(
	text: string,
	beforePos: number,
	tagName: string,
): { start: number; end: number; attributes: Record<string, string> } | undefined {
	let lastOpening: { start: number; end: number; attributes: Record<string, string> } | undefined;
	let pos = 0;
	while (pos < beforePos) {
		const tag = findNextTag(text, pos);
		if (!tag || tag.start >= beforePos) break;
		if (tag.name === tagName && !tag.isClosing) {
			lastOpening = { start: tag.start, end: tag.end, attributes: tag.attributes };
		}
		pos = tag.end;
	}
	return lastOpening;
}

/**
 * Format the inner content of a message as XML (without the `<pi_edit>` wrapper).
 * Returns `null` for roles that are not directly editable (e.g. toolResult).
 */
export function formatMessageContent(message: AgentMessage): string | null {
	switch (message.role) {
		case "user":
			return formatUserMessageContent(message as UserMessage);
		case "assistant":
			return formatAssistantMessageContent(message as AssistantMessage);
		default:
			return null;
	}
}

/**
 * Format an existing message as an edit XML block with the given id.
 * Returns null for non-editable roles or content/replay metadata the format cannot preserve.
 */
export function formatMessageForEdit(id: number, message: AgentMessage): string | null {
	const content = formatMessageContent(message);
	if (content === null) return null;
	const role = message.role === "user" ? "user" : "assistant";
	const xml = `<pi_edit id="${id}" role="${role}">${content}</pi_edit>`;
	return roundTripsExactly(xml, message) ? xml : null;
}

/**
 * Format an existing message as a `<pi_swipe>` block for in-place editing of
 * one swipe version. The timestamp identifies the version on apply and keeps
 * its position stable. Returns null if content/replay metadata would be lost.
 */
export function formatMessageForSwipe(timestamp: string, message: AgentMessage): string | null {
	const content = formatMessageContent(message);
	if (content === null) return null;
	const role = message.role === "user" ? "user" : "assistant";
	const xml = `<pi_swipe timestamp="${escapeXmlAttr(timestamp)}" role="${role}">${content}</pi_swipe>`;
	return roundTripsExactly(xml, message) ? xml : null;
}

type EditableBlock = TextContent | ThinkingContent | ToolCall | ImageContent;

/** Compare representable content while retaining all provider replay fields. */
function editableContentKey(content: string | readonly EditableBlock[] | readonly { type: string }[]): string {
	const blocks: unknown[] = [];
	let text = "";
	const flush = (): void => {
		if (text.length > 0) blocks.push({ type: "text", text });
		text = "";
	};
	const items = typeof content === "string" ? [{ type: "text", text: content } as TextContent] : content;
	for (const item of items as readonly EditableBlock[]) {
		if (item.type === "text") {
			if (item.textSignature !== undefined) {
				flush();
				blocks.push({ type: "text", text: item.text, textSignature: item.textSignature });
			} else text += item.text;
			continue;
		}
		flush();
		if (item.type === "thinking") {
			blocks.push({
				type: "thinking",
				thinking: item.thinking,
				signature: item.thinkingSignature,
				redacted: item.redacted === true,
			});
		} else if (item.type === "toolCall") {
			blocks.push({
				type: "toolCall",
				id: item.id,
				name: item.name,
				arguments: item.arguments,
				thoughtSignature: item.thoughtSignature,
				namespace: item.namespace,
				raw: item.raw,
			});
		} else if (item.type === "image") blocks.push({ type: "image", data: item.data, mimeType: item.mimeType });
	}
	flush();
	return JSON.stringify(blocks);
}

function roundTripsExactly(xml: string, message: AgentMessage): boolean {
	if (message.role !== "user" && message.role !== "assistant") return false;
	try {
		const parsed = parseMessageEditsAndSwipes(xml);
		const blocks = [...parsed.edits, ...parsed.swipes];
		return blocks.length === 1 && editableContentKey(blocks[0].content) === editableContentKey(message.content);
	} catch {
		// Literal text may resemble malformed edit markup; refuse without changing it.
		return false;
	}
}

function formatUserMessageContent(message: UserMessage): string {
	const content =
		typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
	let inner = "";
	for (const block of content) {
		if (block.type === "text") {
			inner += block.text;
		} else if (block.type === "image") {
			inner += `<pi_image mimeType="${escapeXmlAttr(block.mimeType)}">${block.data}</pi_image>`;
		}
	}
	return inner;
}

function formatAssistantMessageContent(message: AssistantMessage): string {
	let inner = "";
	let textBuffer = "";
	const flushText = (): void => {
		if (textBuffer.length > 0) {
			inner += `<pi_content>${textBuffer}</pi_content>`;
			textBuffer = "";
		}
	};
	for (const block of message.content) {
		if (block.type === "thinking") {
			flushText();
			let attrs = "";
			if (block.thinkingSignature) attrs += ` signature="${escapeXmlAttr(block.thinkingSignature)}"`;
			if (block.redacted) attrs += ` redacted="true"`;
			inner += `<pi_reasoning_content${attrs}>${block.thinking}</pi_reasoning_content>`;
		} else if (block.type === "text") {
			textBuffer += block.text;
		} else if (block.type === "toolCall") {
			flushText();
			let attrs = ` id="${escapeXmlAttr(block.id)}" name="${escapeXmlAttr(block.name)}"`;
			if (block.thoughtSignature) attrs += ` thoughtSignature="${escapeXmlAttr(block.thoughtSignature)}"`;
			inner += `<pi_tool_call${attrs}>${JSON.stringify(block.arguments)}</pi_tool_call>`;
		}
	}
	flushText();
	return inner;
}

/**
 * Build a `Message` from a parsed edit block and optional base assistant fields.
 * For new assistant messages (negative ids) baseAssistant must be provided.
 */
export function editBlockToMessage(
	block: ParsedEditBlock | ParsedSwipeBlock,
	baseAssistant?: Pick<AssistantMessage, "api" | "provider" | "model" | "usage" | "timestamp"> &
		Partial<AssistantMessage>,
): Message {
	const timestamp = baseAssistant?.timestamp ?? Date.now();

	if (block.role === "user") {
		return {
			role: "user",
			content: block.content.filter((c): c is TextContent | ImageContent => c.type === "text" || c.type === "image"),
			timestamp,
		};
	}

	const assistantContent = block.content.filter(
		(c): c is TextContent | ThinkingContent | ToolCall =>
			c.type === "text" || c.type === "thinking" || c.type === "toolCall",
	);
	const hasToolCall = assistantContent.some((c) => c.type === "toolCall");
	const stopReason: AssistantMessage["stopReason"] = hasToolCall ? "toolUse" : "stop";

	if (baseAssistant) {
		const signaturePositions = new Map<string, number>();
		for (const content of assistantContent) {
			if (content.type !== "thinking" || content.thinkingSignature === undefined) continue;
			const signature = content.thinkingSignature;
			const previousPosition = signaturePositions.get(signature);
			const position = baseAssistant.content?.findIndex(
				(original, index) =>
					index >= (previousPosition ?? 0) &&
					original.type === "thinking" &&
					original.thinkingSignature === signature,
			);
			if (position === undefined || (position < 0 && previousPosition === undefined)) continue;
			const original = baseAssistant.content?.[position];
			const editableReasoningField =
				baseAssistant.api === "openai-completions" &&
				original?.type === "thinking" &&
				original.redacted !== true &&
				content.redacted !== true &&
				(signature === "reasoning_content" || signature === "reasoning" || signature === "reasoning_text");
			if (
				original?.type !== "thinking" ||
				(!editableReasoningField && original.thinking !== content.thinking) ||
				(original.redacted === true) !== (content.redacted === true)
			) {
				throw new Error("Cannot change signed reasoning while retaining its original signature.");
			}
			signaturePositions.set(signature, position + 1);
		}
		return {
			...baseAssistant,
			role: "assistant",
			content: assistantContent,
			stopReason,
		};
	}

	throw new Error("Cannot create assistant message without base assistant fields");
}
