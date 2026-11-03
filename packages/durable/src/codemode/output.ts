/**
 * A script's result as the model reads it, copied from the coding agent's code mode: a "Script completed/failed"
 * header with the wall time, the script's text items (`==> text N/M <==` when there are several), its `console` lines
 * in one `<console_output>` block, the returned value, and on failure the error with the calls already made. Text past
 * the token budget is cut to its start and end, with the complete text in a temp file; images are saved to temp files
 * too, with their path next to them, because a script has no other way to hand their bytes on.
 */
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { CodemodeOutputItem, CodemodeResult } from "@earendil-works/pi-codemode/portable";
import type { ToolDiagnostic } from "../harness/types.ts";
import { imageDimensions } from "../tools/image.ts";
import {
	DEFAULT_IMAGE_LIMITS,
	type ImageLimits,
	type ImageProcessor,
	INLINE_IMAGE_TYPES,
} from "../tools/image-processor.ts";

type Item = TextContent | ImageContent;

/** Writes a file of the result under a fixed name; its path, or why it could not be written. */
export type OutputFile = (name: string, data: string | Uint8Array) => Promise<{ path: string } | { error: string }>;

/** The tool's output limits, which the Harness enforces by cutting without a spill file: results stay inside them. */
type Limits = { readonly maxBytes: number; readonly maxLines: number };
/** Lines of the result besides the script's text: the header, markers, notes. */
const LINE_MARGIN = 100;

/** Default token budget for script output. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
/** Characters per token when estimating. */
const CHARS_PER_TOKEN = 4;

/** File extensions of the image types `image()` accepts. */
const IMAGE_EXTENSIONS: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
};

/** Like the script's `text()`: strings as is, other values as compact JSON. */
function valueText(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value) ?? String(value);
}

/**
 * Lay out the script's output so the model can tell items apart: with more than one text item, each starts with a
 * `==> text N/M <==` line; `console` lines follow all other output in one `<console_output>` block.
 */
function formatItems(output: readonly CodemodeOutputItem[]): Item[] {
	const total = output.filter((item) => item.type === "text" && !item.console).length;
	const items: Item[] = [];
	const consoleLines: string[] = [];
	let index = 0;
	for (const item of output) {
		if (item.type === "image") items.push(item);
		else if (item.console) consoleLines.push(item.text);
		else {
			index++;
			items.push({ type: "text", text: total > 1 ? `==> text ${index}/${total} <==\n${item.text}` : item.text });
		}
	}
	if (consoleLines.length > 0) {
		items.push({ type: "text", text: `<console_output>\n${consoleLines.join("\n")}\n</console_output>` });
	}
	return items;
}

/**
 * Join adjacent text items into one, each part starting on its own line. The separator check looks at the last
 * non-empty part, not the joined text: reading the end of a growing concatenation makes V8 copy it on every item, which
 * is quadratic.
 */
function joinAdjacentText(items: readonly Item[]): Item[] {
	const joined: Item[] = [];
	let parts: string[] = [];
	let lastPart = "";
	const flush = () => {
		if (parts.length > 0) joined.push({ type: "text", text: parts.join("") });
		parts = [];
		lastPart = "";
	};
	for (const item of items) {
		if (item.type !== "text") {
			flush();
			joined.push(item);
			continue;
		}
		if (lastPart !== "" && !lastPart.endsWith("\n")) {
			parts.push("\n");
			lastPart = "\n";
		}
		parts.push(item.text);
		if (item.text !== "") lastPart = item.text;
	}
	flush();
	return joined;
}

/**
 * Apply the token budget: when the combined text exceeds it, the text items become one item that keeps the start and
 * end of the text, and images follow it. The complete text is written to a temp file.
 */
async function truncate(
	items: readonly Item[],
	maxTokens: number,
	limits: Limits,
	write: OutputFile,
): Promise<{ items: Item[]; fullOutputPath?: string }> {
	const texts = items.filter((item): item is TextContent => item.type === "text").map((item) => item.text);
	const combined = texts.join("\n");
	// Within the limits too: a UTF-16 unit is at most 3 UTF-8 bytes, and the rest of the result is a few short lines.
	const budget = Math.min(maxTokens * CHARS_PER_TOKEN, Math.floor(limits.maxBytes / 4));
	const lineBudget = Math.floor((limits.maxLines - LINE_MARGIN) / 2);
	const lines = combined.split("\n").length;
	if (texts.length === 0 || (combined.length <= budget && lines <= 2 * lineBudget)) return { items: [...items] };
	const headChars = Math.floor(budget / 2);
	const tailChars = budget - headChars;
	const head = combined.slice(0, headChars).split("\n").slice(0, lineBudget).join("\n");
	const tail = tailChars > 0 ? combined.slice(-tailChars).split("\n").slice(-lineBudget).join("\n") : "";
	const removed = combined.length - head.length - tail.length;
	let text = `Warning: truncated output (original token count: ${Math.ceil(combined.length / CHARS_PER_TOKEN)})\nTotal output lines: ${combined.split("\n").length}\n\n${head}…${Math.ceil(removed / CHARS_PER_TOKEN)} tokens truncated…${tail}`;
	const spilled = await write("output.txt", combined);
	text +=
		"path" in spilled
			? `\n\n[Full output: ${spilled.path} (read with offset/limit)]`
			: `\n\n[Could not save the full output: ${spilled.error}]`;
	return {
		items: [{ type: "text", text }, ...items.filter((item) => item.type === "image")],
		...("path" in spilled ? { fullOutputPath: spilled.path } : {}),
	};
}

async function saveOriginalsAndPrepareImages(
	items: readonly Item[],
	write: OutputFile,
	processor: ImageProcessor | undefined,
	limits: ImageLimits,
	diagnostics: ToolDiagnostic[],
): Promise<Item[]> {
	const images = new Map<string, Promise<Item[]>>();
	const prepare = async ({ data, mimeType }: ImageContent, index: number): Promise<Item[]> => {
		const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
		const kind = `${mimeType}, ${bytes.length} bytes`;
		const saved = await write(`image-${index}${IMAGE_EXTENSIONS[mimeType] ?? ".bin"}`, bytes);
		const label =
			"path" in saved
				? `[Image saved to ${saved.path} (${kind})]`
				: `[Image (${kind}) could not be saved: ${saved.error}]`;
		let image: { readonly data: string; readonly mimeType: string } | undefined;
		if (processor !== undefined) image = await processor.prepare(bytes, mimeType, limits);
		else {
			const size = imageDimensions(bytes, mimeType);
			if (
				INLINE_IMAGE_TYPES.has(mimeType) &&
				data.length <= limits.maxBytes &&
				size !== undefined &&
				size.width <= limits.maxWidth &&
				size.height <= limits.maxHeight
			)
				image = { data, mimeType };
		}
		if (image === undefined) {
			const message =
				processor === undefined
					? `Image (${kind}) cannot be sent within the model's image limits; no image processor is configured.`
					: `Image (${kind}) cannot be prepared for the model.`;
			diagnostics.push({ severity: "error", code: "unsupported_image", message });
			return [{ type: "text", text: `${label}\n${message}` }];
		}
		return [
			{ type: "text", text: label },
			{ type: "image", data: image.data, mimeType: image.mimeType },
		];
	};
	const result = await Promise.all(
		items.map((item): Promise<Item[]> => {
			if (item.type !== "image") return Promise.resolve([item]);
			const key = `${item.mimeType}:${item.data}`;
			let pending = images.get(key);
			if (pending === undefined) {
				pending = prepare(item, images.size + 1);
				images.set(key, pending);
			}
			return pending;
		}),
	);
	return result.flat();
}

function formatError(
	result: Extract<CodemodeResult, { ok: false }>,
	calls: readonly { name: string; status: string }[],
) {
	const { error } = result;
	const head =
		error.kind === "script"
			? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
			: error.kind === "timeout"
				? `Script timed out: ${error.message}`
				: error.kind === "aborted"
					? `Script aborted: ${error.message}`
					: `Script sandbox failed: ${error.message}`;
	const summary =
		calls.length === 0
			? "No tool calls were made."
			: `Tool calls made before the failure (they are not undone): ${calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
	return `${head}\n\n${summary}`;
}

/** The tool result's content for a script's result, and the path of the complete text when it was cut. */
export async function formatResult(
	result: CodemodeResult,
	options: {
		/** Images `models.generateImages()` returned; when the script showed none, the result says so. */
		readonly generatedImages: number;
		readonly wallMs: number;
		readonly maxOutputTokens: number;
		readonly calls: readonly { name: string; status: string }[];
		readonly limits: Limits;
		readonly write: OutputFile;
		readonly images?: ImageProcessor;
		readonly imageLimits?: ImageLimits;
	},
): Promise<{ content: Item[]; fullOutputPath?: string; diagnostics: ToolDiagnostic[] }> {
	const output = [...result.output];
	if (result.ok && result.value !== undefined) output.push({ type: "text", text: valueText(result.value) });
	const items = formatItems(output);
	if (!result.ok) items.push({ type: "text", text: `Script error:\n${formatError(result, options.calls)}` });
	const generated = options.generatedImages;
	if (generated > 0 && !items.some((item) => item.type === "image")) {
		items.push({
			type: "text",
			text: `Note: models.generateImages() returned ${generated} image${generated === 1 ? "" : "s"} that the script did not show. Show each image block of result.output with image(block).`,
		});
	}
	const truncated = await truncate(joinAdjacentText(items), options.maxOutputTokens, options.limits, options.write);
	// After truncation, which joins the text items and moves images after them, so each path stays next to its image.
	const diagnostics: ToolDiagnostic[] = [];
	const content = joinAdjacentText(
		await saveOriginalsAndPrepareImages(
			truncated.items,
			options.write,
			options.images,
			options.imageLimits ?? DEFAULT_IMAGE_LIMITS,
			diagnostics,
		),
	);
	const header = `${result.ok ? "Script completed" : "Script failed"}\nWall time ${(options.wallMs / 1000).toFixed(1)} seconds\nOutput:\n`;
	return {
		content: [{ type: "text", text: header }, ...content],
		diagnostics,
		...(truncated.fullOutputPath === undefined ? {} : { fullOutputPath: truncated.fullOutputPath }),
	};
}
