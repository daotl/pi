import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deleteKittyImage, isImageLine } from "./terminal-image.ts";
import { CURSOR_MARKER, type TUI, TuiBase, type TuiStopOptions } from "./tui.ts";
import {
	extractAnsiCode,
	getGraphemeSegmenter,
	shouldWrapLinesToWidth,
	sliceByColumn,
	terminalLinePhysicalRows,
	terminalLineRows,
	visibleWidth,
} from "./utils.ts";

const KITTY_SEQUENCE_PREFIX = "\x1b_G";
const MAX_RENDER_WRITE_CHARS = 1024 * 1024;

/**
 * Streams terminal output in 1 MiB chunks so a full render never forms one string large enough to exceed V8's limit.
 *
 * `append()` fills the current chunk and flushes it when full. Oversized input is split at chunk boundaries, preserving
 * surrogate pairs so each write remains valid UTF-16. Callers append synchronized-output begin/end sequences themselves;
 * the final `flush()` writes any remainder, including the end sequence.
 */
class BoundedTerminalWriter {
	private buffer = "";
	private writtenChars = 0;
	private readonly write: (data: string) => void;

	constructor(write: (data: string) => void) {
		this.write = write;
	}

	/**
	 * Append terminal data, flushing full chunks as needed. Callers must call `flush()` after the final append.
	 * @param value Terminal data to write in order; oversized values are split without splitting surrogate pairs.
	 */
	append(value: string): void {
		let offset = 0;
		while (offset < value.length) {
			const capacity = MAX_RENDER_WRITE_CHARS - this.buffer.length;
			if (capacity === 0) {
				this.flush();
				continue;
			}

			let end = Math.min(value.length, offset + capacity);
			if (
				end < value.length &&
				value.charCodeAt(end - 1) >= 0xd800 &&
				value.charCodeAt(end - 1) <= 0xdbff &&
				value.charCodeAt(end) >= 0xdc00 &&
				value.charCodeAt(end) <= 0xdfff
			) {
				end--;
			}
			if (end === offset) {
				this.flush();
				continue;
			}

			this.buffer += value.slice(offset, end);
			offset = end;
			if (this.buffer.length === MAX_RENDER_WRITE_CHARS) {
				this.flush();
			}
		}
	}

	/** Write the current chunk, if any, and retain only its character count for debug output. */
	flush(): void {
		if (!this.buffer) return;
		this.write(this.buffer);
		this.writtenChars += this.buffer.length;
		this.buffer = "";
	}

	get length(): number {
		return this.writtenChars + this.buffer.length;
	}
}

interface KittyImageHeader {
	ids: number[];
	rows: number;
	column: number;
	columns?: number;
}

function parseKittyImageHeader(line: string): KittyImageHeader | undefined {
	const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
	if (sequenceStart === -1) return undefined;
	const paramsStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
	const paramsEnd = line.indexOf(";", paramsStart);
	if (paramsEnd === -1) return undefined;

	const ids: number[] = [];
	let rows = 1;
	let columns: number | undefined;
	for (const param of line.slice(paramsStart, paramsEnd).split(",")) {
		const [key, value] = param.split("=", 2);
		if (value === undefined) continue;
		const numberValue = Number(value);
		if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > 0xffffffff) continue;
		if (key === "i") ids.push(numberValue);
		else if (key === "r") rows = numberValue;
		else if (key === "c") columns = numberValue;
	}
	return { ids, rows, column: visibleWidth(line.slice(0, sequenceStart)), columns };
}

function extractKittyImageIds(line: string): number[] {
	return parseKittyImageHeader(line)?.ids ?? [];
}

function extractKittyImageRows(line: string): number {
	return parseKittyImageHeader(line)?.rows ?? 1;
}

function isTermuxSession(): boolean {
	return Boolean(process.env.TERMUX_VERSION);
}

const EXTENDS_PREVIOUS_GRAPHEME = /^(?:\p{M}|\u200c|\u200d|\ufe0e|\ufe0f)/u;

interface LineTailRewrite {
	index: number;
	row: number;
	col: number;
	stylePrefix: string;
}

/** Resume only after unchanged whitespace or a complete unchanged grapheme at the same physical boundary. */
function planLineTailRewrite(oldLine: string, newLine: string, width: number): LineTailRewrite | null {
	for (const line of [oldLine, newLine]) {
		for (let position = 0; position < line.length; position++) {
			const code = line.charCodeAt(position);
			if (code === 0x1b) {
				const ansi = extractAnsiCode(line, position);
				if (!ansi) return null;
				const isStyle = /^\x1b\[[0-9;:]*m$/.test(ansi.code) || ansi.code.startsWith("\x1b]8;");
				if (!isStyle && !/^\x1b\]133;[ABC](?:\x07|\x1b\\)$/.test(ansi.code)) return null;
				position += ansi.length - 1;
			} else if (
				code < 0x20 &&
				code !== 0x09 &&
				code !== 0x0a &&
				!(code === 0x0d && line.charCodeAt(position + 1) === 0x0a)
			) {
				return null;
			}
		}
	}
	const limit = Math.min(oldLine.length, newLine.length);
	let common = 0;
	while (common < limit && oldLine.charCodeAt(common) === newLine.charCodeAt(common)) common++;
	let physicalIndex = 0;
	let physicalRow = 0;
	const oldBoundaries = [0];
	terminalLineRows(oldLine, width, undefined, (boundary) => oldBoundaries.push(boundary));
	const oldGraphemes = getGraphemeSegmenter().segment(oldLine);
	const newGraphemes = getGraphemeSegmenter().segment(newLine);
	let row = 0;
	terminalLineRows(newLine, width, undefined, (boundary) => {
		row++;
		if (boundary >= common || oldBoundaries[row] !== boundary) return;
		const oldGrapheme = oldGraphemes.containing(boundary);
		const newGrapheme = newGraphemes.containing(boundary);
		if (
			oldGrapheme?.index === boundary &&
			newGrapheme?.index === boundary &&
			boundary + oldGrapheme.segment.length <= common &&
			boundary + newGrapheme.segment.length <= common
		) {
			physicalIndex = boundary;
			physicalRow = row;
		}
	});
	let index = 0;
	let stylePrefix = "";
	let styles = "";
	let i = 0;
	while (i < common) {
		if (i === physicalIndex && i > index) {
			index = i;
			stylePrefix = styles;
		}
		const ansi = extractAnsiCode(newLine, i);
		if (ansi) {
			if (i + ansi.length > common) break;
			const isStyle = (ansi.code.startsWith("\x1b[") && ansi.code.endsWith("m")) || ansi.code.startsWith("\x1b]8;");
			const isPromptMarker = /^\x1b\]133;[ABC](?:\x07|\x1b\\)$/.test(ansi.code);
			if (!isStyle && !isPromptMarker) return null;
			if (isStyle) styles += ansi.code;
			i += ansi.length;
			continue;
		}
		const code = newLine.charCodeAt(i);
		i++;
		if (code === 0x20 || code === 0x0a) {
			index = i;
			stylePrefix = styles;
		}
	}
	if (index === 0) return null;
	for (const line of [oldLine, newLine]) {
		let next = index;
		let ansi = extractAnsiCode(line, next);
		while (ansi) {
			next += ansi.length;
			ansi = extractAnsiCode(line, next);
		}
		if (EXTENDS_PREVIOUS_GRAPHEME.test(line.slice(next, next + 2))) return null;
	}
	if (index === physicalIndex) return { index, row: physicalRow, col: 0, stylePrefix };
	const cursor = { index, row: 0, col: 0 };
	terminalLineRows(`${newLine.slice(0, index)}\x1b[m `, width, cursor);
	// A space at exact fill leaves a pending wrap whose row depends on the changed tail.
	if (cursor.col === 0 && cursor.row > 0 && newLine.charCodeAt(index - 1) !== 0x0a) return null;
	return { index, row: cursor.row, col: cursor.col, stylePrefix };
}

export interface TuiMainScreenRenderState {
	previousLines: string[];
	previousWidth: number;
	previousHeight: number;
	cursorRow: number;
	hardwareCursorRow: number;
	maxLinesRendered: number;
	previousViewportTop: number;
}

/** TUI implementation that renders into the terminal's main screen and scrollback. */
export class TuiMainScreen extends TuiBase implements TUI {
	readonly mode = "regular" as const;
	private previousLines: string[] = [];
	private previousKittyImageIds = new Set<number>();
	private previousWidth = 0;
	private previousHeight = 0;
	private previousLayout: { offsets: number[]; totalRows: number } | null = null;
	private cursorRow = 0;
	private hardwareCursorRow = 0;
	private maxLinesRendered = 0;
	private previousViewportTop = 0;
	private overlaidRows: number[] = [];
	private hiddenKittyImages = new Set<number>();
	private baseCursor: { row: number; col: number; wrappedRow: number } | null = null;

	captureRenderState(): TuiMainScreenRenderState {
		return {
			previousLines: [...this.previousLines],
			previousWidth: this.previousWidth,
			previousHeight: this.previousHeight,
			cursorRow: this.cursorRow,
			hardwareCursorRow: this.hardwareCursorRow,
			maxLinesRendered: this.maxLinesRendered,
			previousViewportTop: this.previousViewportTop,
		};
	}

	restoreRenderState(state: TuiMainScreenRenderState): void {
		this.previousLines = state.previousLines.map((line) => (isImageLine(line) ? "" : line));
		this.previousKittyImageIds = new Set();
		this.previousWidth = state.previousWidth;
		this.previousHeight = state.previousHeight;
		this.cursorRow = state.cursorRow;
		this.hardwareCursorRow = state.hardwareCursorRow;
		this.maxLinesRendered = state.maxLinesRendered;
		this.previousViewportTop = state.previousViewportTop;
		this.previousLayout = this.previousWidth > 0 ? this.rowLayout(this.previousLines, this.previousWidth) : null;
	}

	protected override resetRenderState(): void {
		this.previousLines = [];
		this.previousWidth = -1;
		this.previousHeight = -1;
		this.cursorRow = 0;
		this.hardwareCursorRow = 0;
		this.maxLinesRendered = 0;
		this.previousViewportTop = 0;
		this.previousLayout = null;
		this.overlaidRows = [];
		this.hiddenKittyImages.clear();
		this.baseCursor = null;
	}

	protected override beforeTerminalStop(options: TuiStopOptions): void {
		if (options.preserveScreen || (this.previousLines.length === 0 && this.overlaidRows.length === 0)) return;
		this.terminal.write(this.overlaidRows.length > 0 ? "\r" : " ");
		const transcriptEnd = this.previousLayout?.totalRows ?? this.previousLines.length;
		const overlayEnd =
			this.overlaidRows.length > 0 ? this.previousViewportTop + Math.max(...this.overlaidRows) + 1 : 0;
		const targetRow = Math.max(transcriptEnd, overlayEnd);
		const lineDiff = targetRow - this.hardwareCursorRow;
		if (lineDiff > 0) this.terminal.write(`\x1b[${lineDiff}B`);
		else if (lineDiff < 0) this.terminal.write(`\x1b[${-lineDiff}A`);
		this.terminal.write("\r\n");
	}

	private collectKittyImageIds(lines: string[]): Set<number> {
		const ids = new Set<number>();
		for (const line of lines) {
			for (const id of extractKittyImageIds(line)) {
				ids.add(id);
			}
		}
		return ids;
	}

	private deleteKittyImages(ids: Iterable<number>): string {
		let buffer = "";
		for (const id of ids) {
			buffer += deleteKittyImage(id);
		}
		return buffer;
	}

	private getKittyImageReservedRows(lines: string[], index: number, maxIndex = lines.length - 1): number {
		const rows = extractKittyImageRows(lines[index] ?? "");
		if (rows <= 1) return 1;

		const maxRows = Math.min(rows, maxIndex - index + 1, lines.length - index);
		let reservedRows = 1;
		while (reservedRows < maxRows) {
			const line = lines[index + reservedRows] ?? "";
			if (isImageLine(line) || visibleWidth(line) > 0) break;
			reservedRows++;
		}
		return reservedRows;
	}

	private expandChangedRangeForKittyImages(
		firstChanged: number,
		lastChanged: number,
		newLines: string[],
	): { firstChanged: number; lastChanged: number } {
		let expandedFirstChanged = firstChanged;
		let expandedLastChanged = lastChanged;
		const expandForLines = (lines: string[]): void => {
			for (let i = 0; i < lines.length; i++) {
				if (extractKittyImageIds(lines[i]).length === 0) continue;
				const blockEnd = i + this.getKittyImageReservedRows(lines, i) - 1;
				if (i >= firstChanged || (i <= lastChanged && blockEnd >= firstChanged)) {
					expandedFirstChanged = Math.min(expandedFirstChanged, i);
					expandedLastChanged = Math.max(expandedLastChanged, blockEnd);
				}
			}
		};

		expandForLines(this.previousLines);
		expandForLines(newLines);
		return { firstChanged: expandedFirstChanged, lastChanged: expandedLastChanged };
	}

	private deleteChangedKittyImages(firstChanged: number, lastChanged: number): string {
		if (firstChanged < 0 || lastChanged < firstChanged) return "";

		const ids = new Set<number>();
		const maxLine = Math.min(lastChanged, this.previousLines.length - 1);
		for (let i = firstChanged; i <= maxLine; i++) {
			for (const id of extractKittyImageIds(this.previousLines[i] ?? "")) {
				ids.add(id);
			}
		}

		return this.deleteKittyImages(ids);
	}

	/**
	 * Start row (terminal) and total rows for a rendered line array. With line wrapping
	 * disabled (the default), wide lines reflow in the terminal, so each logical line
	 * maps to one or more terminal rows. Image lines occupy their reserved rows (see
	 * getKittyImageReservedRows) and their blank placeholder lines do not add rows.
	 */
	private computeRowsFrom(lines: string[], width: number, from: number, totalRows: number, offsets: number[]): number {
		let i = from;
		while (i < lines.length) {
			offsets[i] = totalRows;
			if (isImageLine(lines[i])) {
				const reservedRows = this.getKittyImageReservedRows(lines, i);
				totalRows += reservedRows;
				for (let k = 1; k < reservedRows && i + k < lines.length; k++) {
					offsets[i + k] = totalRows;
				}
				i += reservedRows;
			} else {
				totalRows += terminalLineRows(lines[i], width);
				i += 1;
			}
		}
		return totalRows;
	}

	/**
	 * Start row (terminal) and total rows for a rendered line array. With line wrapping
	 * disabled (the default), wide lines reflow in the terminal, so each logical line
	 * maps to one or more terminal rows. Image lines occupy their reserved rows (see
	 * getKittyImageReservedRows) and their blank placeholder lines do not add rows.
	 */
	private rowLayout(lines: string[], width: number): { offsets: number[]; totalRows: number } {
		const offsets = new Array<number>(lines.length);
		const totalRows = this.computeRowsFrom(lines, width, 0, 0, offsets);
		return { offsets, totalRows };
	}

	/**
	 * Build the terminal-row layout for `lines`, reusing `prevLayout` for the identical
	 * prefix before `firstChanged`. Only lines at or after `firstChanged` are measured
	 * with visibleWidth, so typing or appending to a long log stays O(changed lines)
	 * instead of O(total log). Returns prevLayout itself when nothing changed.
	 */
	private buildLayout(
		lines: string[],
		width: number,
		firstChanged: number,
		prevLayout: { offsets: number[]; totalRows: number } | null,
	): { offsets: number[]; totalRows: number } {
		if (firstChanged === -1 && prevLayout) return prevLayout;
		if (prevLayout && firstChanged > 0 && firstChanged <= prevLayout.offsets.length) {
			const offsets = new Array<number>(lines.length);
			for (let i = 0; i < firstChanged; i++) {
				offsets[i] = prevLayout.offsets[i];
			}
			const prefixTotal =
				firstChanged >= prevLayout.offsets.length ? prevLayout.totalRows : prevLayout.offsets[firstChanged];
			const totalRows = this.computeRowsFrom(lines, width, firstChanged, prefixTotal, offsets);
			return { offsets, totalRows };
		}
		return this.rowLayout(lines, width);
	}

	/**
	 * Whether the terminal offset of any line in the common prefix differs between the
	 * two renderings. A shift means the previous differential position bookkeeping is
	 * invalid, so a full re-render is required. Appends and end-deletions leave the
	 * common prefix offsets unchanged and stay on the differential path.
	 */
	private rowLayoutChanged(newOffsets: number[], prevOffsets: number[], firstChanged: number): boolean {
		const from = Math.max(0, firstChanged);
		const min = Math.min(newOffsets.length, prevOffsets.length);
		for (let i = from; i < min; i++) {
			if (newOffsets[i] !== prevOffsets[i]) return true;
		}
		return false;
	}

	protected override extractCursorPosition(
		lines: string[],
		height: number,
	): { row: number; col: number; wrappedRow: number } | null {
		const viewportTop = Math.max(0, lines.length - height);
		const width = this.terminal.columns;
		for (let row = lines.length - 1; row >= viewportTop; row--) {
			const line = lines[row];
			const markerIndex = line.indexOf(CURSOR_MARKER);
			if (markerIndex === -1) continue;
			const cursor = { index: markerIndex, row: 0, col: 0 };
			terminalLineRows(line, width, cursor);
			lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
			return { row, col: cursor.col % width, wrappedRow: cursor.row + Math.floor(cursor.col / width) };
		}
		return null;
	}

	protected override doRender(): void {
		if (this.stopped) return;
		const width = this.terminal.columns;
		const height = this.terminal.rows;
		// Restore old overlay cells before transcript writes can scroll them into history.
		if (
			this.overlaidRows.length > 0 &&
			this.previousLayout &&
			this.previousWidth === width &&
			(this.previousHeight === height || isTermuxSession())
		) {
			const previousTop = this.previousViewportTop;
			const resizedTop =
				this.previousHeight === height ? previousTop : Math.max(0, previousTop + this.previousHeight - height);
			const rows = this.overlaidRows
				.map((row) => previousTop + row - resizedTop)
				.filter((row) => row >= 0 && row < height);
			this.previousViewportTop = resizedTop;
			this.paintViewportRows(
				this.physicalViewport(this.previousLines, this.previousLayout, width, height),
				rows,
				true,
			);
			this.previousViewportTop = previousTop;
		}
		this.overlaidRows = [];
		this.renderTranscript();
		if (!this.previousLayout || !this.hasOverlayEntries) return;
		const viewport = this.physicalViewport(this.previousLines, this.previousLayout, width, height);
		const markedViewport = [...viewport];
		if (this.baseCursor) {
			const row =
				this.previousLayout.offsets[this.baseCursor.row] + this.baseCursor.wrappedRow - this.previousViewportTop;
			if (row >= 0 && row < height) {
				const col = this.baseCursor.col;
				markedViewport[row] =
					sliceByColumn(viewport[row], 0, col, true) +
					CURSOR_MARKER +
					sliceByColumn(viewport[row], col, width - col, true);
			}
		}
		const composed = this.compositeOverlays(markedViewport, width, height);
		const overlayCursor = this.extractCursorPosition(composed, height);
		for (let row = 0; row < height; row++) {
			if (composed[row] !== viewport[row]) this.overlaidRows.push(row);
		}
		const reset = this.applyLineResets(composed);
		const imageCoverage = this.kittyViewportCoverage();
		for (const image of imageCoverage) {
			if (image.row < this.previousViewportTop || image.row + image.rows > this.previousViewportTop + height)
				continue;
			if (
				!this.renderedOverlayLayouts.some(
					(overlay) =>
						overlay.col < image.column + image.columns &&
						overlay.col + overlay.width > image.column &&
						this.previousViewportTop + overlay.row < image.row + image.rows &&
						this.previousViewportTop + overlay.row + overlay.height > image.row,
				)
			)
				continue;
			// Lowercase i deletes placements only, retaining data for a=p on restore.
			this.terminal.write(`\x1b_Ga=d,d=i,i=${image.id},q=2\x1b\\`);
			this.hiddenKittyImages.add(image.id);
		}
		this.paintViewportRows(reset, this.overlaidRows, false, imageCoverage);
		if (overlayCursor) {
			this.positionHardwareCursor(overlayCursor, {
				offsets: Array.from({ length: height }, (_, row) => this.previousViewportTop + row),
				totalRows: this.previousViewportTop + height,
			});
		} else {
			this.positionHardwareCursor(this.isOverlayFocused() ? null : this.baseCursor, this.previousLayout);
		}
	}

	private kittyViewportCoverage(): Array<{ id: number; row: number; rows: number; column: number; columns: number }> {
		const images: Array<{ id: number; row: number; rows: number; column: number; columns: number }> = [];
		if (!this.previousLayout) return images;
		for (let index = 0; index < this.previousLines.length; index++) {
			const header = parseKittyImageHeader(this.previousLines[index]);
			const id = header?.ids[0];
			if (id === undefined || !header) continue;
			const row = this.previousLayout.offsets[index];
			if (row + header.rows <= this.previousViewportTop || row >= this.previousViewportTop + this.terminal.rows)
				continue;
			images.push({
				id,
				row,
				rows: header.rows,
				column: header.column,
				columns: header.columns ?? this.terminal.columns,
			});
		}
		return images;
	}

	private physicalViewport(
		lines: string[],
		layout: { offsets: number[]; totalRows: number },
		width: number,
		height: number,
	): string[] {
		const result = Array<string>(height).fill("");
		const top = this.previousViewportTop;
		for (let i = lines.length - 1; i >= 0; i--) {
			const start = layout.offsets[i];
			const end = layout.offsets[i + 1] ?? layout.totalRows;
			if (end <= top) break;
			if (end <= start) continue;
			if (start >= top + height) continue;
			if (isImageLine(lines[i])) {
				// Kitty graphics occupy cells independently of the text layer. Keep other
				// image protocols opaque, since they cannot restore a retained placement.
				if (!parseKittyImageHeader(lines[i])?.ids.length) {
					for (let row = Math.max(top, start); row < Math.min(top + height, end); row++)
						result[row - top] = lines[i];
				}
				continue;
			}
			const first = Math.max(0, top - start);
			const rows = terminalLinePhysicalRows(lines[i], width, first, top + height - start);
			for (let row = 0; row < rows.length; row++) result[start + first + row - top] = rows[row];
		}
		return this.applyLineResets(result);
	}

	private paintViewportRows(
		lines: string[],
		rows: number[],
		restoring = false,
		images = this.kittyViewportCoverage(),
	): void {
		if (rows.length === 0) return;
		const output = new BoundedTerminalWriter((data) => this.terminal.write(data));
		output.append("\x1b[?2026h");
		const lastRow = this.previousViewportTop + Math.max(...rows);
		const reservedRows = this.maxLinesRendered;
		if (lastRow >= reservedRows) {
			const lastReservedRow = Math.max(0, reservedRows - 1);
			const rowDelta = lastReservedRow - this.hardwareCursorRow;
			if (rowDelta > 0) output.append(`\x1b[${rowDelta}B`);
			else if (rowDelta < 0) output.append(`\x1b[${-rowDelta}A`);
			// Line feeds create addressable rows and scroll shell history when necessary;
			// cursor-down alone clamps at the physical screen bottom.
			for (let row = lastReservedRow; row < lastRow; row++) output.append("\r\n");
			this.hardwareCursorRow = lastRow;
			// Overlay padding is not transcript growth. Replaying these feeds after
			// reservation stays within addressable rows; keep shrink accounting unchanged.
		}
		for (const row of rows) {
			if (isImageLine(lines[row])) continue;
			// The transcript may start below shell output, so its screen origin is unknown.
			const targetRow = this.previousViewportTop + row;
			const rowDelta = targetRow - this.hardwareCursorRow;
			if (rowDelta > 0) output.append(`\x1b[${rowDelta}B`);
			else if (rowDelta < 0) output.append(`\x1b[${-rowDelta}A`);
			const coverage = images.find((image) => targetRow >= image.row && targetRow < image.row + image.rows);
			if (coverage) {
				// Never erase a graphics cell merely to paint text beside its placement.
				const hidden = this.hiddenKittyImages.has(coverage.id);
				const leftCount = hidden ? 0 : Math.min(coverage.column, this.terminal.columns);
				if (leftCount > 0)
					output.append(`\x1b[1G\x1b[${leftCount}X${sliceByColumn(lines[row], 0, leftCount, true)}`);
				const startCol = hidden ? 0 : coverage.column + coverage.columns;
				const count = this.terminal.columns - startCol;
				if (count > 0)
					output.append(`\x1b[${startCol + 1}G\x1b[${count}X${sliceByColumn(lines[row], startCol, count, true)}`);
			} else output.append(`\r\x1b[2K${lines[row]}`);
			this.hardwareCursorRow = targetRow;
		}
		if (restoring) {
			for (const image of images) {
				if (!this.hiddenKittyImages.has(image.id)) continue;
				const delta = image.row - this.hardwareCursorRow;
				if (delta > 0) output.append(`\x1b[${delta}B`);
				else if (delta < 0) output.append(`\x1b[${-delta}A`);
				output.append(
					`\x1b[${image.column + 1}G\x1b_Ga=p,i=${image.id},c=${image.columns},r=${image.rows},C=1,q=2\x1b\\`,
				);
				this.hardwareCursorRow = image.row;
			}
			this.hiddenKittyImages.clear();
		}
		output.append("\x1b[?2026l");
		output.flush();
	}

	private renderTranscript(): void {
		if (this.stopped) return;
		const width = this.terminal.columns;
		const height = this.terminal.rows;
		const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
		const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
		const previousBufferLength = this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
		let prevViewportTop = heightChanged ? Math.max(0, previousBufferLength - height) : this.previousViewportTop;
		let viewportTop = prevViewportTop;
		let hardwareCursorRow = this.hardwareCursorRow;
		const computeLineDiff = (targetRow: number): number => {
			const currentScreenRow = hardwareCursorRow - prevViewportTop;
			const targetScreenRow = targetRow - viewportTop;
			return targetScreenRow - currentScreenRow;
		};

		// Render all components to get new lines
		let newLines = this.resolveFocusedCursor(this.render(width));

		// Extract cursor position before applying line resets (marker must be found first)
		const cursorPos = this.extractCursorPosition(newLines, height);
		this.baseCursor = cursorPos;

		newLines = this.applyLineResets(newLines);

		// Find first and last changed lines
		let firstChanged = -1;
		let lastChanged = -1;
		const maxLines = Math.max(newLines.length, this.previousLines.length);
		for (let i = 0; i < maxLines; i++) {
			const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
			const newLine = i < newLines.length ? newLines[i] : "";

			if (oldLine !== newLine) {
				if (firstChanged === -1) {
					firstChanged = i;
				}
				lastChanged = i;
			}
		}
		const appendedLines = newLines.length > this.previousLines.length;
		if (appendedLines) {
			if (firstChanged === -1) {
				firstChanged = this.previousLines.length;
			}
			lastChanged = newLines.length - 1;
		}
		if (firstChanged !== -1) {
			const expandedRange = this.expandChangedRangeForKittyImages(firstChanged, lastChanged, newLines);
			firstChanged = expandedRange.firstChanged;
			lastChanged = expandedRange.lastChanged;
		}
		const appendStart = appendedLines && firstChanged === this.previousLines.length && firstChanged > 0;

		// Terminal-row layout. With line wrapping disabled (the default), wide lines reflow
		// in the terminal into multiple rows. The identical prefix before firstChanged is
		// reused from the previous layout, so measuring visibleWidth stays proportional to
		// the changed lines rather than the whole log (a long log makes typing sluggish
		// otherwise). A width change forces a full re-measure because wrapping changes.
		const newLayout =
			widthChanged || this.previousLayout === null
				? this.rowLayout(newLines, width)
				: this.buildLayout(newLines, width, firstChanged, this.previousLayout);
		const prevLayout = this.previousLayout ?? this.rowLayout(this.previousLines, width);

		// Helper to clear scrollback and viewport and render all new lines
		const fullRender = (clear: boolean): void => {
			this.fullRedrawCount += 1;
			const output = new BoundedTerminalWriter((data) => this.terminal.write(data));
			output.append("\x1b[?2026h"); // Begin synchronized output
			if (clear) {
				output.append(this.deleteKittyImages(this.previousKittyImageIds));
				output.append("\x1b[2J\x1b[H\x1b[3J"); // Clear screen, home, then clear scrollback
			}
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) output.append("\r\n");
				const line = newLines[i];
				const isImage = isImageLine(line);
				const imageReservedRows = isImage ? this.getKittyImageReservedRows(newLines, i) : 1;
				if (imageReservedRows > 1 && imageReservedRows <= height) {
					for (let row = 1; row < imageReservedRows; row++) {
						output.append("\r\n");
					}
					output.append(`\x1b[${imageReservedRows - 1}A`);
					output.append(line);
					output.append(`\x1b[${imageReservedRows - 1}B`);
					i += imageReservedRows - 1;
					continue;
				}
				output.append(line);
			}
			output.append("\x1b[?2026l"); // End synchronized output
			output.flush();
			this.cursorRow = Math.max(0, newLayout.totalRows - 1);
			this.hardwareCursorRow = this.cursorRow;
			// Reset max lines when clearing, otherwise track growth
			if (clear) {
				this.maxLinesRendered = newLayout.totalRows;
			} else {
				this.maxLinesRendered = Math.max(this.maxLinesRendered, newLayout.totalRows);
			}
			const bufferLength = Math.max(height, newLayout.totalRows);
			this.previousViewportTop = Math.max(0, bufferLength - height);
			this.positionHardwareCursor(cursorPos, newLayout);
			this.previousLines = newLines;
			this.previousKittyImageIds = this.collectKittyImageIds(newLines);
			this.previousWidth = width;
			this.previousHeight = height;
			this.previousLayout = newLayout;
		};

		const redrawLogDirectory = process.env.PI_TUI_DEBUG_REDRAW === "1" ? this.logDirectory : undefined;
		const logRedraw = (reason: string): void => {
			if (redrawLogDirectory === undefined) return;
			const logPath = path.join(redrawLogDirectory, "pi-tui-debug.log");
			const msg = `[${new Date().toISOString()}] fullRender: ${reason} (prev=${this.previousLines.length}, new=${newLines.length}, height=${height})\n`;
			fs.appendFileSync(logPath, msg);
		};

		// A rendered empty transcript still owns cursor state.
		if (this.previousWidth === 0 && this.previousHeight === 0 && !widthChanged && !heightChanged) {
			logRedraw("first render");
			fullRender(false);
			return;
		}

		// Width changes always need a full re-render because wrapping changes.
		if (widthChanged) {
			logRedraw(`terminal width changed (${this.previousWidth} -> ${width})`);
			fullRender(true);
			return;
		}

		// Height changes normally need a full re-render to keep the visible viewport aligned,
		// but Termux changes height when the software keyboard shows or hides.
		// In that environment, a full redraw causes the entire history to replay on every toggle.
		if (heightChanged && !isTermuxSession()) {
			logRedraw(`terminal height changed (${this.previousHeight} -> ${height})`);
			fullRender(true);
			return;
		}

		// Content shrunk below the working area and no overlays - re-render to clear empty rows
		// (overlays need the padding, so only do this when no overlays are active)
		// Configurable via setClearOnShrink()
		if (this.getClearOnShrink() && newLayout.totalRows < this.maxLinesRendered && !this.hasOverlayEntries) {
			logRedraw(`clearOnShrink (maxLinesRendered=${this.maxLinesRendered})`);
			fullRender(true);
			return;
		}

		// When line wrapping is disabled (default), wide lines reflow in the terminal
		// into multiple rows. If any line's row count changed, the previous differential
		// position bookkeeping is invalid (lines have shifted). A line's terminal row
		// count changed (it crossed a wrap boundary). The terminal has
		// NOT reflowed the content: a growing wrapped line simply overwrites the next row
		// (soft wrap is a linefeed, not an insertion), so every line below the changed line
		// is still at its old position. A full re-render here would emit \x1b[3J (clear
		// scrollback), which resets Kitty's scroll position to the bottom and yanks the
		// user out of scrolled-up history mid-stream on every wrap. Instead fall through to
		// the differential renderer and rewrite the whole tail (changed line through the
		// end): the shifted-but-unchanged lines below must be rewritten at their new rows
		// because the terminal did not move them.
		const layoutChanged = this.rowLayoutChanged(newLayout.offsets, prevLayout.offsets, firstChanged);
		if (layoutChanged) {
			logRedraw("line wrapping layout changed; rewriting tail");
		}

		// No changes - but still need to update hardware cursor position if it moved
		if (firstChanged === -1) {
			this.positionHardwareCursor(cursorPos, newLayout);
			this.previousViewportTop = prevViewportTop;
			this.previousHeight = height;
			return;
		}

		// All changes are in deleted lines (nothing to render, just clear)
		if (firstChanged >= newLines.length) {
			if (prevLayout.totalRows > newLayout.totalRows) {
				const output = new BoundedTerminalWriter((data) => this.terminal.write(data));
				output.append("\x1b[?2026h");
				output.append(this.deleteChangedKittyImages(firstChanged, lastChanged));
				// Move to end of new content (clamp to 0 for empty content)
				const targetRow = Math.max(0, newLayout.totalRows - 1);
				if (targetRow < prevViewportTop) {
					logRedraw(`deleted lines moved viewport up (${targetRow} < ${prevViewportTop})`);
					fullRender(true);
					return;
				}
				const lineDiff = computeLineDiff(targetRow);
				if (lineDiff > 0) output.append(`\x1b[${lineDiff}B`);
				else if (lineDiff < 0) output.append(`\x1b[${-lineDiff}A`);
				output.append("\r");
				// Clear extra rows without scrolling
				const extraRows = prevLayout.totalRows - newLayout.totalRows;
				if (extraRows > height) {
					logRedraw(`extraRows > height (${extraRows} > ${height})`);
					fullRender(true);
					return;
				}
				const clearStartOffset = newLayout.totalRows === 0 ? 0 : 1;
				if (extraRows > 0 && clearStartOffset > 0) {
					output.append(`\x1b[${clearStartOffset}B`);
				}
				for (let i = 0; i < extraRows; i++) {
					output.append("\r\x1b[2K");
					if (i < extraRows - 1) output.append("\x1b[1B");
				}
				const moveBack = Math.max(0, extraRows - 1 + clearStartOffset);
				if (moveBack > 0) {
					output.append(`\x1b[${moveBack}A`);
				}
				output.append("\x1b[?2026l");
				output.flush();
				this.cursorRow = targetRow;
				this.hardwareCursorRow = targetRow;
			}
			this.positionHardwareCursor(cursorPos, newLayout);
			this.previousLines = newLines;
			this.previousKittyImageIds = this.collectKittyImageIds(newLines);
			this.previousWidth = width;
			this.previousHeight = height;
			this.previousViewportTop = prevViewportTop;
			this.previousLayout = newLayout;
			return;
		}

		// A logical line may start in scrollback while its unchanged prefix reaches the viewport.
		const firstChangedRow = newLayout.offsets[firstChanged];
		let tailRewrite: LineTailRewrite | null = null;
		if (firstChangedRow < prevViewportTop) {
			const oldLine = this.previousLines[firstChanged];
			const newLine = newLines[firstChanged];
			if (oldLine !== undefined && !isImageLine(oldLine) && !isImageLine(newLine)) {
				tailRewrite = planLineTailRewrite(oldLine, newLine, width);
			}
			if (tailRewrite === null || firstChangedRow + tailRewrite.row < prevViewportTop) {
				logRedraw(`firstChanged < viewportTop (${firstChangedRow} < ${prevViewportTop})`);
				fullRender(true);
				return;
			}
		}

		// Render from first changed line to end
		// Keep updates wrapped in synchronized output while writing bounded chunks.
		const output = new BoundedTerminalWriter((data) => this.terminal.write(data));
		output.append("\x1b[?2026h"); // Begin synchronized output
		output.append(this.deleteChangedKittyImages(firstChanged, lastChanged));
		const prevViewportBottom = prevViewportTop + height - 1;
		// Terminal row where the first changed logical line starts (appendStart targets
		// the last previous row so the \r\n below advances onto the new content).
		const moveTargetRow =
			appendStart && !layoutChanged
				? prevLayout.totalRows - 1
				: newLayout.offsets[firstChanged] + (tailRewrite?.row ?? 0);
		if (moveTargetRow > prevViewportBottom) {
			const currentScreenRow = Math.max(0, Math.min(height - 1, hardwareCursorRow - prevViewportTop));
			const moveToBottom = height - 1 - currentScreenRow;
			if (moveToBottom > 0) {
				output.append(`\x1b[${moveToBottom}B`);
			}
			const scroll = moveTargetRow - prevViewportBottom;
			output.append("\r\n".repeat(scroll));
			prevViewportTop += scroll;
			viewportTop += scroll;
			hardwareCursorRow = moveTargetRow;
		}

		// Move cursor to first changed line (use hardwareCursorRow for actual position)
		const lineDiff = computeLineDiff(moveTargetRow);
		if (lineDiff > 0) {
			output.append(`\x1b[${lineDiff}B`); // Move down
		} else if (lineDiff < 0) {
			output.append(`\x1b[${-lineDiff}A`); // Move up
		}

		output.append(appendStart ? "\r\n" : "\r"); // Move to column 0

		// Only render changed lines (firstChanged to lastChanged), not all lines to end
		// This reduces flicker when only a single line changes (e.g., spinner animation)
		// On a layout change the unchanged lines below the changed line sit at stale rows
		// (the terminal did not shift them), so the render range must extend to the end of
		// content instead of stopping at the last textually-changed line.
		const renderEnd = layoutChanged ? newLines.length - 1 : Math.min(lastChanged, newLines.length - 1);
		for (let i = firstChanged; i <= renderEnd; i++) {
			if (i > firstChanged) output.append("\r\n");
			const line = newLines[i];
			const isImage = isImageLine(line);
			const imageReservedRows = isImage ? this.getKittyImageReservedRows(newLines, i, renderEnd) : 1;
			if (imageReservedRows > 1) {
				const imageStartScreenRow = newLayout.offsets[i] - viewportTop;
				if (imageStartScreenRow < 0 || imageStartScreenRow + imageReservedRows > height) {
					logRedraw(
						`kitty image pre-clear would scroll (${imageStartScreenRow} + ${imageReservedRows} > ${height})`,
					);
					fullRender(true);
					return;
				}

				output.append("\x1b[2K");
				for (let row = 1; row < imageReservedRows; row++) {
					output.append("\r\n\x1b[2K");
				}
				output.append(`\x1b[${imageReservedRows - 1}A`);
				output.append(line);
				output.append(`\x1b[${imageReservedRows - 1}B`);
				i += imageReservedRows - 1;
				continue;
			}

			// Clear every terminal row the NEW version of this line will occupy, so no
			// stale columns survive on wrapped rows (the previous content at those rows
			// may be a different line entirely after mid-array edits, and a wrapped row
			// is only overwritten up to the columns the new content covers). Clearing is
			// capped at the bottom screen row: rows beyond it do not exist on screen yet
			// (the content write below creates them by scrolling, pushing real content
			// into the scrollback), and emitting extra "\r\n" pairs past the bottom row
			// would scroll a freshly-cleared blank row into the scrollback instead,
			// permanently misaligning it by one row.
			const tail = i === firstChanged ? tailRewrite : null;
			const columnMove = tail && tail.col > 0 ? `\x1b[${tail.col + 1}G` : "";
			const startRow = newLayout.offsets[i] + (tail?.row ?? 0);
			const lineEndRow = isImage ? startRow + 1 : (newLayout.offsets[i + 1] ?? newLayout.totalRows);
			const clearRows = Math.max(1, Math.min(lineEndRow - startRow, viewportTop + height - startRow));
			output.append(tail ? `${columnMove}\x1b[K` : "\x1b[2K");
			for (let r = 1; r < clearRows; r++) {
				output.append("\r\n\x1b[2K");
			}
			if (clearRows > 1) output.append(`\x1b[${clearRows - 1}A${columnMove}`);
			// When line wrapping is disabled, message content is written unwrapped so the
			// terminal itself may reflow long lines - allow lines wider than the terminal.
			if (!isImage && visibleWidth(line) > width && shouldWrapLinesToWidth()) {
				// Log all lines to crash file for debugging
				const crashLogPath = path.join(this.logDirectory ?? os.tmpdir(), "pi-tui-crash.log");
				const crashData = [
					`Crash at ${new Date().toISOString()}`,
					`Terminal width: ${width}`,
					`Line ${i} visible width: ${visibleWidth(line)}`,
					"",
					"=== All rendered lines ===",
					...newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
					"",
				].join("\n");
				fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
				fs.writeFileSync(crashLogPath, crashData);

				// Clean up terminal state before throwing
				this.stop();

				const errorMsg = [
					`Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}).`,
					"",
					"This is likely caused by a custom TUI component not truncating its output.",
					"Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
					"",
					`Debug log written to: ${crashLogPath}`,
				].join("\n");
				throw new Error(errorMsg);
			}
			output.append(tail ? tail.stylePrefix + line.slice(tail.index) : line);
		}

		// Track where cursor ended up after rendering. In the stable-layout differential
		// path the cursor ends on the last terminal row of the last changed line: the row
		// just before the start of the next line (or the content end if it is the last).
		let finalCursorRow =
			renderEnd + 1 < newLayout.offsets.length ? newLayout.offsets[renderEnd + 1] - 1 : newLayout.totalRows - 1;

		// If the previous content spanned more terminal rows, clear the extra rows.
		if (prevLayout.totalRows > newLayout.totalRows) {
			// Move to end of new content first if we stopped before it
			if (renderEnd < newLines.length - 1) {
				const moveDown = newLayout.totalRows - 1 - finalCursorRow;
				if (moveDown > 0) output.append(`\x1b[${moveDown}B`);
				finalCursorRow = newLayout.totalRows - 1;
			}
			const extraRows = prevLayout.totalRows - newLayout.totalRows;
			for (let i = 0; i < extraRows; i++) {
				output.append("\r\n\x1b[2K");
			}
			// Move cursor back to end of new content
			output.append(`\x1b[${extraRows}A`);
		}

		output.append("\x1b[?2026l"); // End synchronized output

		if (process.env.PI_TUI_DEBUG === "1") {
			const debugDir = "/tmp/tui";
			fs.mkdirSync(debugDir, { recursive: true });
			const debugPath = path.join(debugDir, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
			const debugData = [
				`firstChanged: ${firstChanged}`,
				`viewportTop: ${viewportTop}`,
				`cursorRow: ${this.cursorRow}`,
				`height: ${height}`,
				`lineDiff: ${lineDiff}`,
				`hardwareCursorRow: ${hardwareCursorRow}`,
				`renderEnd: ${renderEnd}`,
				`finalCursorRow: ${finalCursorRow}`,
				`cursorPos: ${JSON.stringify(cursorPos)}`,
				`newLines.length: ${newLines.length}`,
				`previousLines.length: ${this.previousLines.length}`,
				"",
				"=== newLines ===",
				JSON.stringify(newLines, null, 2),
				"",
				"=== previousLines ===",
				JSON.stringify(this.previousLines, null, 2),
				"",
				"=== buffer ===",
				`[${output.length} chars written in bounded chunks]`,
			].join("\n");
			fs.writeFileSync(debugPath, debugData);
		}

		output.flush();

		// Track cursor position for next render
		// cursorRow tracks end of content (for viewport calculation)
		// hardwareCursorRow tracks actual terminal cursor position (for movement)
		this.cursorRow = Math.max(0, newLayout.totalRows - 1);
		this.hardwareCursorRow = finalCursorRow;
		// Track terminal's working area (grows but doesn't shrink unless cleared)
		this.maxLinesRendered = Math.max(this.maxLinesRendered, newLayout.totalRows);
		this.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);

		// Position hardware cursor for IME
		this.positionHardwareCursor(cursorPos, newLayout);

		this.previousLines = newLines;
		this.previousKittyImageIds = this.collectKittyImageIds(newLines);
		this.previousWidth = width;
		this.previousHeight = height;
		this.previousLayout = newLayout;
	}

	/**
	 * Position the hardware cursor for IME candidate window.
	 * @param cursorPos The cursor position extracted from rendered output, or null
	 * @param layout Terminal-row layout of the rendered lines
	 */
	private positionHardwareCursor(
		cursorPos: { row: number; col: number; wrappedRow: number } | null,
		layout: { offsets: number[]; totalRows: number },
	): void {
		if (!cursorPos || layout.totalRows <= 0) {
			this.terminal.hideCursor();
			return;
		}

		// The marker supplies the physical offset, including wide glyphs that wrap early.
		const logicalRow = Math.max(0, Math.min(cursorPos.row, layout.offsets.length - 1));
		const targetRow = Math.max(0, Math.min(layout.offsets[logicalRow] + cursorPos.wrappedRow, layout.totalRows - 1));
		const targetCol = Math.max(0, cursorPos.col);

		// Move cursor from current position to target
		const rowDelta = targetRow - this.hardwareCursorRow;
		let buffer = "";
		if (rowDelta > 0) {
			buffer += `\x1b[${rowDelta}B`; // Move down
		} else if (rowDelta < 0) {
			buffer += `\x1b[${-rowDelta}A`; // Move up
		}
		// Move to absolute column (1-indexed)
		buffer += `\x1b[${targetCol + 1}G`;

		if (buffer) {
			this.terminal.write(buffer);
		}

		this.hardwareCursorRow = targetRow;
		if (this.getShowHardwareCursor()) {
			this.terminal.showCursor();
		} else {
			this.terminal.hideCursor();
		}
	}
}
