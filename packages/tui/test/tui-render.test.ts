import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Box } from "../src/components/box.ts";
import { HStack } from "../src/components/h-stack.ts";
import { Image } from "../src/components/image.ts";
import { Input } from "../src/components/input.ts";
import { Text } from "../src/components/text.ts";
import type { Terminal } from "../src/terminal.ts";
import {
	deleteKittyImage,
	encodeKitty,
	resetCapabilitiesCache,
	setCapabilities,
	setCellDimensions,
} from "../src/terminal-image.ts";
import { type Component, CURSOR_MARKER, type TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import {
	isPadLinesToWidth,
	isWrapLinesToWidth,
	setPadLinesToWidth,
	setWrapLinesToWidth,
	sliceByColumn,
} from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class TestComponent implements Component {
	lines: string[] = [];
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

class InputComponent extends TestComponent {
	renderCount = 0;

	override render(width: number): string[] {
		this.renderCount += 1;
		return super.render(width);
	}

	handleInput(data: string): void {
		this.lines = [data];
	}
}

const MAX_RENDER_WRITE_CHARS = 1024 * 1024;

class BoundedWriteTerminal implements Terminal {
	readonly writes: string[] = [];
	columns = 80;
	rows = 24;
	readonly kittyProtocolActive = false;

	start(_onInput: (data: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	setProgress(_active: boolean): void {}
	setProgramStatus(): void {}
}

class LoggingVirtualTerminal extends VirtualTerminal {
	private writes: string[] = [];

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}

	getWrites(): string {
		return this.writes.join("");
	}

	clearWrites(): void {
		this.writes = [];
	}
}

async function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
	const previousValues = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(updates)) {
		previousValues.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}

	try {
		return await run();
	} finally {
		for (const [key, value] of previousValues) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

function getCellItalic(terminal: VirtualTerminal, row: number, col: number): number {
	const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
	const buffer = xterm.buffer.active;
	const line = buffer.getLine(buffer.viewportY + row);
	assert.ok(line, `Missing buffer line at row ${row}`);
	const cell = line.getCell(col);
	assert.ok(cell, `Missing cell at row ${row} col ${col}`);
	return cell.isItalic();
}

describe("TUI render scheduling", () => {
	it("renders keyboard input without waiting for a throttled frame", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new InputComponent();
		component.lines = ["initial"];
		tui.addChild(component);
		tui.setFocus(component);
		tui.start();
		tui.renderNow();
		const renderCountBeforeInput = component.renderCount;

		// Queue a normal throttled render first. Keyboard input should preempt it.
		component.lines = ["pending"];
		tui.requestRender();
		terminal.sendInput("first");
		terminal.sendInput("second");
		terminal.sendInput("typed");
		await new Promise<void>((resolve) => process.nextTick(resolve));

		assert.strictEqual(component.renderCount, renderCountBeforeInput + 1);
		assert.deepStrictEqual(component.lines, ["typed"]);
		tui.stop();
	});
});

describe("TUI debug logging", () => {
	it("writes redraw logs to the provided directory", async () => {
		const logDir = mkdtempSync(join(tmpdir(), "pi-tui-log-"));
		try {
			await withEnv({ PI_TUI_DEBUG_REDRAW: "1" }, async () => {
				const terminal = new VirtualTerminal(40, 10);
				const tui: TUI = new TuiMainScreen(terminal, undefined, logDir);
				const component = new TestComponent();
				tui.addChild(component);
				component.lines = ["test"];
				tui.start();
				await terminal.waitForRender();

				assert.match(readFileSync(join(logDir, "pi-tui-debug.log"), "utf-8"), /fullRender: first render/);
				tui.stop();
			});
		} finally {
			rmSync(logDir, { recursive: true, force: true });
		}
	});
});

describe("TUI bounded render output", () => {
	it("splits a large full render without changing its output", () => {
		const terminal = new BoundedWriteTerminal();
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		const kittyLine = `\x1b_Ga=T,f=100;${"A".repeat(1_200_000)}\x1b\\`;
		component.lines = [kittyLine, kittyLine];
		tui.addChild(component);

		tui.renderNow();

		assert.ok(terminal.writes.length > 2, "large output should be split across terminal writes");
		assert.ok(
			terminal.writes.every((write) => write.length <= MAX_RENDER_WRITE_CHARS),
			"each terminal write should stay below the configured limit",
		);
		assert.strictEqual(
			terminal.writes.join(""),
			`\x1b[?2026h${kittyLine}\r\n${kittyLine}\x1b[?2026l`,
			"chunking must preserve the synchronized render output",
		);
	});

	it("splits large differential updates without a full redraw", () => {
		const terminal = new BoundedWriteTerminal();
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);
		component.lines = ["before"];
		tui.renderNow();
		terminal.writes.length = 0;

		const kittyLine = `\x1b_Ga=T,f=100;${"A".repeat(1_200_000)}\x1b\\`;
		component.lines = ["before", kittyLine, kittyLine];
		tui.renderNow();

		assert.ok(terminal.writes.length > 2, "large output should be split across terminal writes");
		assert.ok(terminal.writes.every((write) => write.length <= MAX_RENDER_WRITE_CHARS));
		const output = terminal.writes.join("");
		assert.ok(output.startsWith("\x1b[?2026h"));
		assert.ok(output.endsWith("\x1b[?2026l"));
		assert.ok(!output.includes("\x1b[2J"), "the update should stay on the differential render path");
	});
});

/** Set each environment variable to `value`, returning a function that restores the previous state. */
function overrideEnv(names: readonly string[], value: string): () => void {
	const previousValues = names.map((name) => [name, process.env[name]] as const);
	for (const name of names) {
		process.env[name] = value;
	}
	return () => {
		for (const [name, previousValue] of previousValues) {
			if (previousValue === undefined) delete process.env[name];
			else process.env[name] = previousValue;
		}
	};
}

describe("TUI crash dump without configured log directory", () => {
	it("writes the crash dump to the OS temp directory instead of a home-directory default", async () => {
		// The TUI falls back to os.tmpdir() when no log directory is configured, so
		// isolate the test by pointing the temp directory at a fresh directory rather
		// than sharing the real one with concurrent test runs. os.tmpdir() reads
		// TMPDIR on POSIX and TEMP/TMP on Windows, so override all three.
		const crashDir = mkdtempSync(join(tmpdir(), "pi-tui-crash-"));
		const crashLogPath = join(crashDir, "pi-tui-crash.log");
		const restoreTmpdirEnv = overrideEnv(["TMPDIR", "TEMP", "TMP"], crashDir);
		try {
			const terminal = new VirtualTerminal(40, 10);
			const tui: TUI = new TuiMainScreen(terminal);
			const component = new TestComponent();
			tui.addChild(component);
			component.lines = ["ok"];
			tui.start();
			await terminal.waitForRender();

			// Width overflow is detected in the differential render path. The crash guard
			// only fires when wrapping is enabled (without it the terminal reflows wide
			// lines, so overflow is not an error), so enable it explicitly.
			setWrapLinesToWidth(true);
			component.lines = ["ok", "x".repeat(60)];
			assert.throws(
				() => tui.renderNow(),
				(error: unknown) => {
					assert.ok(error instanceof Error);
					assert.ok(error.message.includes(crashLogPath), `error message should reference ${crashLogPath}`);
					return true;
				},
			);
			assert.match(readFileSync(crashLogPath, "utf-8"), /Terminal width: 40/);
		} finally {
			setWrapLinesToWidth(false);
			restoreTmpdirEnv();
			rmSync(crashDir, { recursive: true, force: true });
		}
	});
});

describe("TUI Kitty image cleanup", () => {
	it("clears reserved Kitty image rows before drawing appended image placements", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setCellDimensions({ widthPx: 10, heightPx: 10 });
		try {
			const terminal = new LoggingVirtualTerminal(40, 10);
			const tui: TUI = new TuiMainScreen(terminal);
			const component = new TestComponent();
			tui.addChild(component);

			component.lines = ["before"];
			tui.start();
			await terminal.waitForRender();
			terminal.clearWrites();

			const image = new Image(
				"AAAA",
				"image/png",
				{ fallbackColor: (value) => value },
				{ maxWidthCells: 2 },
				{ widthPx: 20, heightPx: 20 },
			);
			const imageLines = image.render(40);
			const imageSequence = imageLines[0];
			component.lines = ["before", ...imageLines, "after"];
			tui.requestRender();
			await terminal.waitForRender();

			const writes = terminal.getWrites();
			assert.ok(
				writes.includes(`\x1b[2K\r\n\x1b[2K\x1b[1A${imageSequence}\x1b[1B`),
				"reserved rows should be cleared before the image placement is drawn",
			);
			assert.ok(
				!writes.includes(`${imageSequence}\r\n\x1b[2K`),
				"reserved row clears must not run after the image placement is drawn",
			);

			tui.stop();
		} finally {
			resetCapabilitiesCache();
			setCellDimensions({ widthPx: 9, heightPx: 18 });
		}
	});

	it("falls back to full redraw when Kitty image pre-clear would scroll", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setCellDimensions({ widthPx: 10, heightPx: 10 });
		try {
			const terminal = new LoggingVirtualTerminal(40, 2);
			const tui: TUI = new TuiMainScreen(terminal);
			const component = new TestComponent();
			tui.addChild(component);

			component.lines = ["before"];
			tui.start();
			await terminal.waitForRender();
			const redrawsBeforeImage = tui.fullRedraws;
			terminal.clearWrites();

			const image = new Image(
				"AAAA",
				"image/png",
				{ fallbackColor: (value) => value },
				{ maxWidthCells: 3 },
				{ widthPx: 30, heightPx: 30 },
			);
			component.lines = ["before", ...image.render(40), "after"];
			tui.requestRender();
			await terminal.waitForRender();

			assert.ok(tui.fullRedraws > redrawsBeforeImage, "unsafe image pre-clear should force a full redraw");
			assert.ok(terminal.getWrites().includes("\x1b[2J"), "fallback should clear and fully redraw");

			tui.stop();
		} finally {
			resetCapabilitiesCache();
			setCellDimensions({ widthPx: 9, heightPx: 18 });
		}
	});

	it("reserves Kitty image rows before drawing during full redraw fallbacks", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setCellDimensions({ widthPx: 10, heightPx: 10 });
		try {
			const terminal = new LoggingVirtualTerminal(40, 5);
			const tui: TUI = new TuiMainScreen(terminal);
			const component = new TestComponent();
			tui.addChild(component);

			component.lines = ["l0", "l1", "l2", "l3", "l4"];
			tui.start();
			await terminal.waitForRender();
			const redrawsBeforeImage = tui.fullRedraws;
			terminal.clearWrites();

			const image = new Image(
				"AAAA",
				"image/png",
				{ fallbackColor: (value) => value },
				{ maxWidthCells: 3 },
				{ widthPx: 30, heightPx: 30 },
			);
			const imageLines = image.render(40);
			const imageSequence = imageLines[0];
			component.lines = ["l0", "l1", "l2", "l3", "l4", ...imageLines, "after"];
			tui.requestRender();
			await terminal.waitForRender();

			const writes = terminal.getWrites();
			assert.ok(tui.fullRedraws > redrawsBeforeImage, "scrolling image append should force a full redraw");
			assert.ok(
				writes.includes(`\r\n\r\n\x1b[2A${imageSequence}\x1b[2B`),
				"full redraw should reserve visible image rows before drawing the placement",
			);
			assert.ok(
				!writes.includes(`${imageSequence}\r\n\x1b[0m`),
				"full redraw must not write reserved padding rows after drawing the placement",
			);

			tui.stop();
		} finally {
			resetCapabilitiesCache();
			setCellDimensions({ widthPx: 9, heightPx: 18 });
		}
	});

	it("does not use cursor-up placement for Kitty images taller than the viewport", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setCellDimensions({ widthPx: 10, heightPx: 10 });
		try {
			const terminal = new LoggingVirtualTerminal(40, 5);
			const tui: TUI = new TuiMainScreen(terminal);
			const component = new TestComponent();
			tui.addChild(component);

			component.lines = ["before"];
			tui.start();
			await terminal.waitForRender();
			terminal.clearWrites();

			const image = new Image(
				"AAAA",
				"image/png",
				{ fallbackColor: (value) => value },
				{ maxWidthCells: 6 },
				{ widthPx: 60, heightPx: 60 },
			);
			const imageLines = image.render(40);
			const imageSequence = imageLines[0];
			assert.ok(imageLines.length > terminal.rows, "test image should exceed the viewport height");

			component.lines = ["before", ...imageLines, "after"];
			tui.requestRender(true);
			await terminal.waitForRender();

			const writes = terminal.getWrites();
			assert.ok(writes.includes(imageSequence), "image placement should be drawn");
			assert.ok(
				!writes.includes(`\x1b[${imageLines.length - 1}A${imageSequence}`),
				"taller-than-viewport images must keep the #4461 first-row placement path",
			);

			tui.stop();
		} finally {
			resetCapabilitiesCache();
			setCellDimensions({ widthPx: 9, heightPx: 18 });
		}
	});

	it("deletes changed image ids before drawing moved placements", async () => {
		const terminal = new LoggingVirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		const oldImage = encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 42, moveCursor: false });
		component.lines = ["top", oldImage];
		tui.start();
		await terminal.waitForRender();
		terminal.clearWrites();

		const newImage = encodeKitty("BBBB", { columns: 2, rows: 1, imageId: 42, moveCursor: false });
		component.lines = [newImage, ""];
		tui.requestRender();
		await terminal.waitForRender();

		const writes = terminal.getWrites();
		const deleteIndex = writes.indexOf(deleteKittyImage(42));
		const drawIndex = writes.indexOf(newImage);
		assert.ok(deleteIndex >= 0, "changed old image should be deleted");
		assert.ok(drawIndex >= 0, "new image should be drawn");
		assert.ok(deleteIndex < drawIndex, "old image must be deleted before the new placement is drawn");

		tui.stop();
	});

	it("redraws image lines when an earlier reserved image row changes", async () => {
		const terminal = new LoggingVirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		const image = encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 88, moveCursor: false });
		component.lines = ["", image];
		tui.start();
		await terminal.waitForRender();
		terminal.clearWrites();

		component.lines = ["covered", image];
		tui.requestRender();
		await terminal.waitForRender();

		const writes = terminal.getWrites();
		const deleteIndex = writes.indexOf(deleteKittyImage(88));
		const drawIndex = writes.indexOf(image);
		assert.ok(deleteIndex >= 0, "image should be deleted when a reserved row changes");
		assert.ok(drawIndex >= 0, "unchanged image line should be redrawn after deleting the placement");
		assert.ok(deleteIndex < drawIndex, "old placement must be deleted before the image line is redrawn");
		assert.ok(!writes.includes("\x1b[2J"), "reserved row changes should not force a full redraw");

		tui.stop();
	});

	it("deletes previously rendered image ids during full redraws", async () => {
		const terminal = new LoggingVirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = [encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 77, moveCursor: false })];
		tui.start();
		await terminal.waitForRender();
		terminal.clearWrites();

		component.lines = ["plain text"];
		tui.requestRender(true);
		await terminal.waitForRender();

		const writes = terminal.getWrites();
		const deleteIndex = writes.indexOf(deleteKittyImage(77));
		const clearIndex = writes.indexOf("\x1b[2J");
		assert.ok(deleteIndex >= 0, "previous image should be deleted during full redraw");
		assert.ok(clearIndex >= 0, "full redraw should clear the screen");
		assert.ok(deleteIndex < clearIndex, "old image should be deleted before the screen is cleared");

		tui.stop();
	});
});

describe("TUI resize handling", () => {
	it("triggers full re-render when terminal height changes", async () => {
		await withEnv({ TERMUX_VERSION: undefined }, async () => {
			const terminal = new VirtualTerminal(40, 10);
			const tui: TUI = new TuiMainScreen(terminal);
			const component = new TestComponent();
			tui.addChild(component);

			component.lines = ["Line 0", "Line 1", "Line 2"];
			tui.start();
			await terminal.waitForRender();

			const initialRedraws = tui.fullRedraws;

			// Resize height
			terminal.resize(40, 15);
			await terminal.waitForRender();

			// Should have triggered a full redraw
			assert.ok(tui.fullRedraws > initialRedraws, "Height change should trigger full redraw");

			const viewport = terminal.getViewport();
			assert.ok(viewport[0]?.includes("Line 0"), "Content preserved after height change");

			tui.stop();
		});
	});

	it("skips full re-render on height changes in Termux", async () => {
		await withEnv({ TERMUX_VERSION: "1" }, async () => {
			const terminal = new LoggingVirtualTerminal(40, 10);
			const tui: TUI = new TuiMainScreen(terminal);
			const component = new TestComponent();
			tui.addChild(component);

			component.lines = Array.from({ length: 20 }, (_, i) => `Line ${i}`);
			tui.start();
			await terminal.waitForRender();
			terminal.clearWrites();

			const initialRedraws = tui.fullRedraws;
			for (const height of [15, 8, 14, 11]) {
				terminal.resize(40, height);
				await terminal.waitForRender();
			}

			assert.strictEqual(tui.fullRedraws, initialRedraws, "Height change should not trigger full redraw");
			assert.ok(!terminal.getWrites().includes("\x1b[2J"), "Height change should not clear the screen");
			assert.ok(!terminal.getWrites().includes("\x1b[3J"), "Height change should not clear scrollback");

			const viewport = terminal.getViewport();
			assert.ok(viewport.join("\n").includes("Line 19"), "Latest content remains visible after resize");

			tui.stop();
		});
	});

	it("triggers full re-render when terminal width changes", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2"];
		tui.start();
		await terminal.waitForRender();

		const initialRedraws = tui.fullRedraws;

		// Resize width
		terminal.resize(60, 10);
		await terminal.waitForRender();

		// Should have triggered a full redraw
		assert.ok(tui.fullRedraws > initialRedraws, "Width change should trigger full redraw");

		tui.stop();
	});
});

describe("TUI content shrinkage", () => {
	it("clears empty rows when content shrinks significantly", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.setClearOnShrink(true); // Explicitly enable (may be disabled via env var)
		const component = new TestComponent();
		tui.addChild(component);

		// Start with many lines
		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4", "Line 5"];
		tui.start();
		await terminal.waitForRender();

		const initialRedraws = tui.fullRedraws;

		// Shrink to fewer lines
		component.lines = ["Line 0", "Line 1"];
		tui.requestRender();
		await terminal.waitForRender();

		// Should have triggered a full redraw to clear empty rows
		assert.ok(tui.fullRedraws > initialRedraws, "Content shrinkage should trigger full redraw");

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Line 0"), "First line preserved");
		assert.ok(viewport[1]?.includes("Line 1"), "Second line preserved");
		// Lines below should be empty (cleared)
		assert.strictEqual(viewport[2]?.trim(), "", "Line 2 should be cleared");
		assert.strictEqual(viewport[3]?.trim(), "", "Line 3 should be cleared");

		tui.stop();
	});

	it("handles shrink to single line", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.setClearOnShrink(true); // Explicitly enable (may be disabled via env var)
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
		tui.start();
		await terminal.waitForRender();

		// Shrink to single line
		component.lines = ["Only line"];
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Only line"), "Single line rendered");
		assert.strictEqual(viewport[1]?.trim(), "", "Line 1 should be cleared");

		tui.stop();
	});

	it("handles shrink to empty", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		tui.setClearOnShrink(true); // Explicitly enable (may be disabled via env var)
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2"];
		tui.start();
		await terminal.waitForRender();

		// Shrink to empty
		component.lines = [];
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		// All lines should be empty
		assert.strictEqual(viewport[0]?.trim(), "", "Line 0 should be cleared");
		assert.strictEqual(viewport[1]?.trim(), "", "Line 1 should be cleared");

		tui.stop();
	});
});

describe("TUI differential rendering", () => {
	it("tracks cursor correctly when content shrinks with unchanged remaining lines", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Initial render: 5 identical lines
		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
		tui.start();
		await terminal.waitForRender();

		// Shrink to 3 lines, all identical to before (no content changes in remaining lines)
		component.lines = ["Line 0", "Line 1", "Line 2"];
		tui.requestRender();
		await terminal.waitForRender();

		// cursorRow should be 2 (last line of new content)
		// Verify by doing another render with a change on line 1
		component.lines = ["Line 0", "CHANGED", "Line 2"];
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		// Line 1 should show "CHANGED", proving cursor tracking was correct
		assert.ok(viewport[1]?.includes("CHANGED"), `Expected "CHANGED" on line 1, got: ${viewport[1]}`);

		tui.stop();
	});

	it("renders correctly when only a middle line changes (spinner case)", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Initial render
		component.lines = ["Header", "Working...", "Footer"];
		tui.start();
		await terminal.waitForRender();

		// Simulate spinner animation - only middle line changes
		const spinnerFrames = ["|", "/", "-", "\\"];
		for (const frame of spinnerFrames) {
			component.lines = ["Header", `Working ${frame}`, "Footer"];
			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			assert.ok(viewport[0]?.includes("Header"), `Header preserved: ${viewport[0]}`);
			assert.ok(viewport[1]?.includes(`Working ${frame}`), `Spinner updated: ${viewport[1]}`);
			assert.ok(viewport[2]?.includes("Footer"), `Footer preserved: ${viewport[2]}`);
		}

		tui.stop();
	});

	it("resets styles after each rendered line", async () => {
		const terminal = new VirtualTerminal(20, 6);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["\x1b[3mItalic", "Plain"];
		tui.start();
		await terminal.waitForRender();

		assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
		tui.stop();
	});

	it("renders correctly when first line changes but rest stays same", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
		tui.start();
		await terminal.waitForRender();

		// Change only first line
		component.lines = ["CHANGED", "Line 1", "Line 2", "Line 3"];
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("CHANGED"), `First line changed: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
		assert.ok(viewport[3]?.includes("Line 3"), `Line 3 preserved: ${viewport[3]}`);

		tui.stop();
	});

	it("renders correctly when last line changes but rest stays same", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
		tui.start();
		await terminal.waitForRender();

		// Change only last line
		component.lines = ["Line 0", "Line 1", "Line 2", "CHANGED"];
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
		assert.ok(viewport[3]?.includes("CHANGED"), `Last line changed: ${viewport[3]}`);

		tui.stop();
	});

	it("renders correctly when multiple non-adjacent lines change", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
		tui.start();
		await terminal.waitForRender();

		// Change lines 1 and 3, keep 0, 2, 4 the same
		component.lines = ["Line 0", "CHANGED 1", "Line 2", "CHANGED 3", "Line 4"];
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("CHANGED 1"), `Line 1 changed: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
		assert.ok(viewport[3]?.includes("CHANGED 3"), `Line 3 changed: ${viewport[3]}`);
		assert.ok(viewport[4]?.includes("Line 4"), `Line 4 preserved: ${viewport[4]}`);

		tui.stop();
	});

	it("handles transition from content to empty and back to content", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Start with content
		component.lines = ["Line 0", "Line 1", "Line 2"];
		tui.start();
		await terminal.waitForRender();

		let viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Line 0"), "Initial content rendered");

		// Clear to empty
		component.lines = [];
		tui.requestRender();
		await terminal.waitForRender();

		// Add content back - this should work correctly even after empty state
		component.lines = ["New Line 0", "New Line 1"];
		tui.requestRender();
		await terminal.waitForRender();

		viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("New Line 0"), `New content rendered: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("New Line 1"), `New content line 1: ${viewport[1]}`);

		tui.stop();
	});

	it("full re-renders when deleted lines move the viewport upward", async () => {
		const terminal = new VirtualTerminal(20, 5);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = Array.from({ length: 12 }, (_, i) => `Line ${i}`);
		tui.start();
		await terminal.waitForRender();

		const initialRedraws = tui.fullRedraws;

		component.lines = Array.from({ length: 7 }, (_, i) => `Line ${i}`);
		tui.requestRender();
		await terminal.waitForRender();

		assert.ok(tui.fullRedraws > initialRedraws, "Shrink should trigger a full redraw");
		assert.deepStrictEqual(terminal.getViewport(), ["Line 2", "Line 3", "Line 4", "Line 5", "Line 6"]);

		tui.stop();
	});

	it("appends after a shrink without another full redraw once the viewport is reset", async () => {
		const terminal = new VirtualTerminal(20, 5);
		const tui: TUI = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = Array.from({ length: 8 }, (_, i) => `Line ${i}`);
		tui.start();
		await terminal.waitForRender();

		const initialRedraws = tui.fullRedraws;

		component.lines = ["Line 0", "Line 1"];
		tui.requestRender();
		await terminal.waitForRender();

		assert.ok(tui.fullRedraws > initialRedraws, "Shrink should reset the viewport with a full redraw");
		const redrawsAfterShrink = tui.fullRedraws;

		component.lines = ["Line 0", "Line 1", "Line 2"];
		tui.requestRender();
		await terminal.waitForRender();

		assert.strictEqual(tui.fullRedraws, redrawsAfterShrink, "Append should stay on the differential path");
		assert.deepStrictEqual(terminal.getViewport(), ["Line 0", "Line 1", "Line 2", "", ""]);

		tui.stop();
	});

	it("clears stale content when maxLinesRendered was inflated by a transient component", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const chat = new TestComponent();
		const editor = new TestComponent();
		tui.addChild(chat);
		tui.addChild(editor);

		const longChat = Array.from({ length: 15 }, (_, i) => `Chat ${i}`);
		const shortChat = Array.from({ length: 12 }, (_, i) => `Chat ${i}`);
		const editorLines = ["Editor 0", "Editor 1", "Editor 2"];
		const selectorLines = Array.from({ length: 8 }, (_, i) => `Selector ${i}`);

		chat.lines = longChat;
		editor.lines = editorLines;
		tui.start();
		await terminal.waitForRender();

		editor.lines = selectorLines;
		tui.requestRender();
		await terminal.waitForRender();

		editor.lines = editorLines;
		tui.requestRender();
		await terminal.waitForRender();

		const redrawsBeforeSwitch = tui.fullRedraws;
		chat.lines = shortChat;
		tui.requestRender();
		await terminal.waitForRender();

		assert.ok(tui.fullRedraws > redrawsBeforeSwitch, "Branch switch should trigger a full redraw");

		const viewport = terminal.getViewport();
		for (let i = 0; i < 10; i++) {
			const line = viewport[i] ?? "";
			assert.ok(!line.includes("Chat 12"), `Stale "Chat 12" at viewport row ${i}`);
			assert.ok(!line.includes("Chat 13"), `Stale "Chat 13" at viewport row ${i}`);
			assert.ok(!line.includes("Chat 14"), `Stale "Chat 14" at viewport row ${i}`);
		}

		assert.deepStrictEqual(viewport, [
			"Chat 5",
			"Chat 6",
			"Chat 7",
			"Chat 8",
			"Chat 9",
			"Chat 10",
			"Chat 11",
			"Editor 0",
			"Editor 1",
			"Editor 2",
		]);

		tui.stop();
	});
});

describe("TUI overlays over native-reflow content", () => {
	for (const hiddenRows of [1, 2]) {
		it(`paints over a scrolled Kitty continuation and restores its visible crop (${hiddenRows} hidden rows)`, async () => {
			setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
			const terminal = new LoggingVirtualTerminal(20, 5);
			const tui = new TuiMainScreen(terminal);
			const base = new TestComponent();
			const imageId = 2800 + hiddenRows;
			const image = new Image(
				"AAAA",
				"image/png",
				{ fallbackColor: (text) => text },
				{ maxWidthCells: 3, maxHeightCells: 3, imageId },
				{ widthPx: 45, heightPx: 90 },
			);
			const imageLines = image.render(20);
			assert.strictEqual(imageLines.length, 3);
			base.lines = [
				`\x1b[3mab\x1b[23m\x1b[2C${imageLines[0]}`,
				...imageLines.slice(1),
				...Array.from({ length: hiddenRows + 2 }, (_, i) => `after${i}`),
			];
			tui.addChild(base);
			try {
				tui.start();
				await terminal.waitForRender();
				assert.strictEqual(tui.captureRenderState().previousViewportTop, hiddenRows);
				const before = terminal.getScrollBuffer();
				terminal.clearWrites();
				const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 0, col: 5 });
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[0].trimEnd(), "     X");
				assert.ok(terminal.getWrites().includes(`\x1b_Ga=d,d=i,i=${imageId},q=2\x1b\\`));
				terminal.clearWrites();
				overlay.hide();
				await terminal.waitForRender();
				assert.deepStrictEqual(terminal.getScrollBuffer(), before);
				const writes = terminal.getWrites();
				const placement = /\x1b_Ga=p,([^\x1b]+)\x1b\\/.exec(writes);
				assert.ok(placement, "the visible crop must be placed again");
				assert.ok(placement[1].includes(`y=${hiddenRows * 30}`));
				assert.ok(placement[1].includes(`h=${(3 - hiddenRows) * 30}`));
				assert.ok(placement[1].includes(`r=${3 - hiddenRows}`));
				assert.ok(
					writes.includes(`\x1b[5G${placement[0]}`),
					"cursor-forward prefix fixes the actual placement column",
				);
				assert.ok(!writes.includes("\x1b[3J"), "registered crops preserve scrollback");
			} finally {
				tui.stop();
				resetCapabilitiesCache();
			}
		});
	}

	it("preserves styled text beside a Kitty anchor through disjoint overlay changes", async () => {
		const terminal = new LoggingVirtualTerminal(24, 5);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = [
			`\x1b[3mleft\x1b[23m ${encodeKitty("AAAA", { columns: 3, rows: 2, imageId: 2900, moveCursor: false })}\x1b[3Cright`,
			"",
			"after",
		];
		tui.addChild(base);
		try {
			tui.start();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[0], "left    right");
			const before = terminal.getScrollBuffer();
			terminal.clearWrites();
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 0, col: 18 });
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[0].trimEnd(), "left    right     X");
			assert.notStrictEqual(getCellItalic(terminal, 0, 0), 0);
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer(), before);
			assert.notStrictEqual(getCellItalic(terminal, 0, 0), 0);
			assert.ok(!terminal.getWrites().includes("\x1b_G"), "disjoint repaint leaves graphics untouched");
		} finally {
			tui.stop();
		}
	});

	it("retains a built-in HStack label beside an Image when a disjoint overlay closes", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const terminal = new LoggingVirtualTerminal(30, 5);
		const tui = new TuiMainScreen(terminal);
		const image = new Image(
			"AAAA",
			"image/png",
			{ fallbackColor: (text) => text },
			{ maxWidthCells: 3, maxHeightCells: 2 },
			{ widthPx: 30, heightPx: 36 },
		);
		tui.addChild(
			new HStack([
				{ component: new Text("LABEL", 0, 0), basis: 8 },
				{ component: image, basis: 8 },
			]),
		);
		tui.addChild(new Text("footer", 0, 0));
		try {
			tui.start();
			await terminal.waitForRender();
			assert.ok(terminal.getViewport()[0].startsWith("LABEL"));
			const before = terminal.getScrollBuffer();
			terminal.clearWrites();
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 0, col: 25 });
			await terminal.waitForRender();
			assert.ok(terminal.getViewport()[0].startsWith("LABEL"));
			assert.strictEqual(terminal.getViewport()[0][25], "X");
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer(), before);
			assert.ok(!terminal.getWrites().includes("\x1b_G"));
		} finally {
			tui.stop();
			resetCapabilitiesCache();
		}
	});

	for (const format of ["png", "chunked-png", "rgb", "rgba"] as const) {
		it(`restores a raw partial ${format} without replaying history across repeated overlays`, async () => {
			const terminal = new LoggingVirtualTerminal(20, 5);
			const shellHistory = ["shell-history-one", "shell-history-two", "shell-history-three"];
			terminal.write(`${shellHistory.join("\r\n")}\r\n`);
			await terminal.flush();
			const tui = new TuiMainScreen(terminal);
			const base = new TestComponent();
			const transcript = Array.from({ length: 16 }, (_, i) => `transcript-${i}`);
			const imageId = 3800 + ["png", "chunked-png", "rgb", "rgba"].indexOf(format);
			// Valid 3x90 RGBA PNG: the source height determines the crop, not terminal cells.
			const png =
				"iVBORw0KGgoAAAANSUhEUgAAAAMAAABaCAYAAAB9qeyAAAAAGUlEQVR4nGP4z8DwH4YZRjmjnFHOKGcgOQB2mRoDbjkRtQAAAABJRU5ErkJggg==";
			let image: string;
			if (format === "png") {
				image = encodeKitty(png, { columns: 3, rows: 3, imageId, moveCursor: false });
			} else if (format === "chunked-png") {
				image = `\x1b_Ga=T,f=100,q=2,C=1,c=3,r=3,i=${imageId},m=1;${png.slice(0, 32)}\x1b\\\x1b_Gm=0;${png.slice(32)}\x1b\\`;
			} else {
				const data = Buffer.alloc(3 * 90 * (format === "rgb" ? 3 : 4), 255).toString("base64");
				image = `\x1b_Ga=T,f=${format === "rgb" ? 24 : 32},s=3,v=90,q=2,C=1,c=3,r=3,i=${imageId};${data}\x1b\\`;
			}
			base.lines = [...transcript, image, "", "", "one", "two", "three", "four"];
			tui.addChild(base);
			try {
				tui.start();
				await terminal.waitForRender();
				const before = terminal.getScrollBuffer();
				assert.strictEqual(tui.captureRenderState().previousViewportTop, 18);
				assert.deepStrictEqual(before.slice(0, shellHistory.length), shellHistory);
				for (let cycle = 0; cycle < 3; cycle++) {
					terminal.clearWrites();
					const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 0, col: 1 });
					await terminal.waitForRender();
					assert.strictEqual(terminal.getViewport()[0].trimEnd(), " X");
					assert.ok(terminal.getWrites().includes(`\x1b_Ga=d,d=i,i=${imageId},q=2\x1b\\`));
					terminal.clearWrites();
					overlay.hide();
					await terminal.waitForRender();
					assert.deepStrictEqual(terminal.getScrollBuffer(), before);
					const writes = terminal.getWrites();
					const placement = /\x1b_Ga=p,([^\x1b]+)\x1b\\/.exec(writes);
					assert.ok(placement, "the retained raw image must be placed again");
					assert.ok(placement[1].includes("y=60,h=30,r=1"));
					assert.ok(!writes.includes("\x1b[2J"));
					assert.ok(!writes.includes("\x1b[3J"));
					assert.ok(!writes.includes(png), "restore must not retransmit the image");
					for (const line of [...shellHistory, ...transcript]) {
						assert.strictEqual(terminal.getScrollBuffer().filter((entry) => entry === line).length, 1);
						assert.ok(!writes.includes(line), "offscreen history must not be replayed");
					}
				}
			} finally {
				tui.stop();
			}
		});
	}

	it("retains an unknown partial custom placement when no crop geometry is available", async () => {
		const terminal = new LoggingVirtualTerminal(20, 5);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = [
			...Array.from({ length: 16 }, (_, i) => `transcript-${i}`),
			"\x1b_Ga=T,f=100,t=f,c=3,r=3,i=2804;L3RtcC9jdXN0b20ucG5n\x1b\\",
			"",
			"",
			"one",
			"two",
			"three",
			"four",
		];
		tui.addChild(base);
		try {
			tui.start();
			await terminal.waitForRender();
			const before = terminal.getScrollBuffer();
			terminal.clearWrites();
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 0, col: 1 });
			await terminal.waitForRender();
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer(), before);
			assert.ok(!terminal.getWrites().includes("\x1b_Ga=d"), "unknown source dimensions cannot be restored safely");
			assert.ok(!terminal.getWrites().includes("\x1b[2J"));
			assert.ok(!terminal.getWrites().includes("transcript-"));
		} finally {
			tui.stop();
		}
	});

	it("paints disjoint overlays on Kitty anchor and continuation rows without touching the placement", async () => {
		const terminal = new LoggingVirtualTerminal(20, 5);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = [encodeKitty("AAAA", { columns: 2, rows: 3, imageId: 92, moveCursor: false }), "", "", "after"];
		tui.addChild(base);
		try {
			tui.start();
			await terminal.waitForRender();
			const before = terminal.getScrollBuffer();
			for (const row of [0, 1]) {
				terminal.clearWrites();
				const overlay = new InputComponent();
				overlay.lines = ["X"];
				const handle = tui.showOverlay(overlay, { width: 1, row, col: 10 });
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[row].trimEnd(), "          X");
				terminal.sendInput("Y");
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[row].trimEnd(), "          Y");
				handle.hide();
				await terminal.waitForRender();
				assert.deepStrictEqual(terminal.getScrollBuffer(), before);
				assert.ok(!terminal.getWrites().includes("\x1b_G"), "disjoint text must not alter graphics");
				assert.ok(!terminal.getWrites().includes("\x1b[3J"));
			}
		} finally {
			tui.stop();
		}
	});

	it("restores a retained Kitty placement after an overlapping overlay closes", async () => {
		const terminal = new LoggingVirtualTerminal(20, 5);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = [encodeKitty("AAAA", { columns: 2, rows: 3, imageId: 93, moveCursor: false }), "", "", "after"];
		tui.addChild(base);
		try {
			tui.start();
			await terminal.waitForRender();
			const before = terminal.getScrollBuffer();
			terminal.clearWrites();
			const handle = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 1, col: 1 });
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[1].trimEnd(), " X");
			assert.ok(terminal.getWrites().includes("\x1b_Ga=d,d=i,i=93,q=2\x1b\\"));
			assert.ok(!terminal.getWrites().includes(deleteKittyImage(93)), "retained image data must survive");
			terminal.clearWrites();
			handle.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer(), before);
			assert.ok(terminal.getWrites().includes("\x1b_Ga=p,i=93,c=2,r=3,C=1,q=2\x1b\\"));
			assert.ok(!terminal.getWrites().includes("\x1b[3J"));
		} finally {
			tui.stop();
		}
	});

	for (const row of [0, 1, 2]) {
		for (const col of [0, 3, 7]) {
			it(`protects an offset Kitty placement from a disjoint overlay at row ${row}, column ${col}`, async () => {
				const padLines = isPadLinesToWidth();
				setPadLinesToWidth(true);
				const terminal = new LoggingVirtualTerminal(20, 5);
				const tui = new TuiMainScreen(terminal);
				const base = new TestComponent();
				base.lines = [encodeKitty("AAAA", { columns: 3, rows: 3, imageId: 94, moveCursor: false }), "", ""];
				const box = new Box(4, 0, (text) => `\x1b[44m${text}\x1b[49m`);
				box.addChild(base);
				tui.addChild(box);
				tui.addChild(new Text("after", 0, 0));
				try {
					tui.start();
					await terminal.waitForRender();
					const before = terminal.getScrollBuffer();
					terminal.clearWrites();
					const overlay = new InputComponent();
					overlay.lines = ["X"];
					const handle = tui.showOverlay(overlay, { width: 1, row, col });
					await terminal.waitForRender();
					assert.strictEqual(terminal.getViewport()[row]?.trimEnd(), `${" ".repeat(col)}X`);
					terminal.sendInput("Y");
					await terminal.waitForRender();
					assert.strictEqual(terminal.getViewport()[row]?.trimEnd(), `${" ".repeat(col)}Y`);
					handle.hide();
					await terminal.waitForRender();
					assert.deepStrictEqual(
						terminal.getScrollBuffer().map((line) => line.trimEnd()),
						before.map((line) => line.trimEnd()),
					);
					const writes = terminal.getWrites();
					assert.ok(!writes.includes("\x1b_G"), "disjoint overlays must not hide or replay the placement");
					assert.ok(writes.includes("\x1b[1G\x1b[4X"), "left-side painting must stop before the image");
					assert.ok(writes.includes("\x1b[8G\x1b[13X"), "right-side painting must start after the image");
					assert.ok(!writes.includes("\x1b[2K"), "painting must not erase the placement's cells");
					assert.ok(!writes.includes("\x1b[3J"));
				} finally {
					tui.stop();
					setPadLinesToWidth(padLines);
				}
			});
		}

		for (const col of [4, 6]) {
			it(`restores an offset Kitty placement after an overlay at row ${row}, column ${col}`, async () => {
				const padLines = isPadLinesToWidth();
				setPadLinesToWidth(true);
				const terminal = new LoggingVirtualTerminal(20, 5);
				const tui = new TuiMainScreen(terminal);
				const base = new TestComponent();
				base.lines = [encodeKitty("AAAA", { columns: 3, rows: 3, imageId: 95, moveCursor: false }), "", ""];
				const box = new Box(4, 0, (text) => `\x1b[44m${text}\x1b[49m`);
				box.addChild(base);
				tui.addChild(box);
				tui.addChild(new Text("after", 0, 0));
				try {
					tui.start();
					await terminal.waitForRender();
					const before = terminal.getScrollBuffer();
					terminal.clearWrites();
					const handle = tui.showOverlay(new Text("X", 0, 0), { width: 1, row, col });
					await terminal.waitForRender();
					assert.strictEqual(terminal.getViewport()[row]?.trimEnd(), `${" ".repeat(col)}X`);
					assert.ok(terminal.getWrites().includes("\x1b_Ga=d,d=i,i=95,q=2\x1b\\"));
					assert.ok(!terminal.getWrites().includes(deleteKittyImage(95)), "image data must remain retained");
					terminal.clearWrites();
					handle.hide();
					await terminal.waitForRender();
					assert.deepStrictEqual(
						terminal.getScrollBuffer().map((line) => line.trimEnd()),
						before.map((line) => line.trimEnd()),
					);
					assert.ok(
						terminal.getWrites().includes("\x1b[5G\x1b_Ga=p,i=95,c=3,r=3,C=1,q=2\x1b\\"),
						"retained placement must return to its original column, excluding ANSI styling from the width",
					);
					assert.ok(!terminal.getWrites().includes("\x1b[3J"));
				} finally {
					tui.stop();
					setPadLinesToWidth(padLines);
				}
			});
		}
	}

	it("keeps content after reserved Kitty placeholders when an overlay opens and closes", async () => {
		const terminal = new LoggingVirtualTerminal(20, 5);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = [encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 91, moveCursor: false }), "", "after"];
		tui.addChild(base);
		try {
			tui.start();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[2], "after");
			terminal.clearWrites();
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 2, col: 0 });
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[2].trimEnd(), "Xfter");
			overlay.hide();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[2], "after");
			assert.ok(!terminal.getWrites().includes("\x1b[3J"));
		} finally {
			tui.stop();
		}
	});

	it("composes a screen-relative overlay on a physical continuation row without dropping text", async () => {
		const terminal = new LoggingVirtualTerminal(10, 4);
		const tui = new TuiMainScreen(terminal);
		tui.addChild(new Text("abcdefghijABCDEFGHIJ0123456789", 0, 0));
		tui.addChild(new Text("footer", 0, 0));
		try {
			tui.start();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["abcdefghij", "ABCDEFGHIJ", "0123456789", "footer"]);
			terminal.clearWrites();
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 1, col: 0 });
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["abcdefghij", "XBCDEFGHIJ", "0123456789", "footer"]);
			assert.deepStrictEqual(overlay.getBounds(), { row: 1, col: 0, width: 1, height: 1 });
			assert.strictEqual(isWrapLinesToWidth(), false, "overlay does not mutate transcript policy");
			assert.ok(!terminal.getWrites().includes("\x1b[3J"), "opening preserves scrollback");
			terminal.clearWrites();
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["abcdefghij", "ABCDEFGHIJ", "0123456789", "footer"]);
			assert.ok(!terminal.getWrites().includes("\x1b[3J"), "closing preserves scrollback");
		} finally {
			tui.stop();
		}
	});

	it("preserves offscreen history while opening, updating and hiding an overlay over wide styled rows", async () => {
		const terminal = new LoggingVirtualTerminal(10, 4);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = ["history-0", "history-1", "\x1b[3m123456789界abcdefg\x1b[23m\nnext", "footer"];
		tui.addChild(base);
		try {
			tui.start();
			await terminal.waitForRender();
			const before = terminal.getScrollBuffer();
			const history = before.slice(0, -4);
			const viewport = terminal.getViewport();
			terminal.clearWrites();
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 1, col: 4 });
			await terminal.waitForRender();
			assert.deepStrictEqual(
				terminal.getViewport().map((line) => line.trimEnd()),
				["123456789", "界abXdefg", "next", "footer"],
			);
			assert.notStrictEqual(getCellItalic(terminal, 1, 0), 0, "style from the preceding physical row is resumed");
			assert.deepStrictEqual(terminal.getScrollBuffer().slice(0, -4), history);
			assert.ok(!terminal.getWrites().includes("history-0"), "opening does not replay transcript history");
			assert.ok(!terminal.getWrites().includes("\x1b[3J"));
			terminal.clearWrites();
			base.lines[3] = "changed";
			tui.requestRender();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[3], "changed");
			assert.ok(terminal.getViewport()[1].includes("X"));
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [...viewport.slice(0, 3), "changed"]);
			assert.deepStrictEqual(terminal.getScrollBuffer().slice(0, -4), history);
			assert.ok(!terminal.getWrites().includes("history-0"));
			assert.ok(!terminal.getWrites().includes("\x1b[3J"));
		} finally {
			tui.stop();
		}
	});

	it("restores colon-form color on a native continuation after overlay hide", async () => {
		const terminal = new VirtualTerminal(10, 4);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = ["\x1b[38:2::255:0:0mabcdefghijABCDEFGHIJ"];
		tui.addChild(base);
		const foreground = () => {
			const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
			const cell = xterm.buffer.active.getLine(xterm.buffer.active.viewportY + 1)?.getCell(1);
			assert.ok(cell);
			return { mode: cell.getFgColorMode(), color: cell.getFgColor() };
		};
		try {
			tui.start();
			await terminal.waitForRender();
			const before = foreground();
			assert.strictEqual(before.color, 0xff0000);
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 1, col: 0 });
			await terminal.waitForRender();
			overlay.hide();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[1], "ABCDEFGHIJ");
			assert.deepStrictEqual(foreground(), before);
		} finally {
			tui.stop();
		}
	});

	for (const reset of ["39", "49", "0"]) {
		it(`preserves colon color reset ${reset} through overlay restoration`, async () => {
			const terminal = new VirtualTerminal(10, 4);
			const tui = new TuiMainScreen(terminal);
			const base = new TestComponent();
			base.lines = [`\x1b[38:2::255:0:0;48:2::0:0:255mabcdefghij\x1b[${reset}mABCDEFGHIJ`];
			tui.addChild(base);
			const colors = () => {
				const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
				const cell = xterm.buffer.active.getLine(xterm.buffer.active.viewportY + 1)?.getCell(1);
				assert.ok(cell);
				return { fg: cell.getFgColor(), bg: cell.getBgColor() };
			};
			try {
				tui.start();
				await terminal.waitForRender();
				const before = colors();
				assert.deepStrictEqual(before, { fg: reset === "49" ? 0xff0000 : -1, bg: reset === "39" ? 0x0000ff : -1 });
				const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 1, col: 0 });
				await terminal.waitForRender();
				overlay.hide();
				await terminal.waitForRender();
				assert.deepStrictEqual(colors(), before);
			} finally {
				tui.stop();
			}
		});
	}

	it("restores cursor-positioned text after an overlay hides", async () => {
		const terminal = new VirtualTerminal(10, 4);
		const tui = new TuiMainScreen(terminal);
		const base = new TestComponent();
		base.lines = ["a\x1b[2Cb"];
		tui.addChild(base);
		try {
			tui.start();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[0], "a  b");
			const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, row: 0, col: 0 });
			await terminal.waitForRender();
			overlay.hide();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[0].trimEnd(), "a  b");
		} finally {
			tui.stop();
		}
	});

	it("restores a moved bottom overlay footprint on Termux height growth", async () => {
		await withEnv({ TERMUX_VERSION: "1" }, async () => {
			const terminal = new LoggingVirtualTerminal(20, 10);
			const tui = new TuiMainScreen(terminal);
			const base = new TestComponent();
			base.lines = Array.from({ length: 10 }, (_, index) => `line-${index}`);
			tui.addChild(base);
			try {
				tui.start();
				await terminal.waitForRender();
				const overlay = tui.showOverlay(new Text("X", 0, 0), { width: 1, anchor: "bottom-left" });
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[9].trimEnd(), "Xine-9");
				terminal.clearWrites();
				terminal.resize(20, 15);
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[9], "line-9");
				assert.strictEqual(terminal.getViewport()[14].trimEnd(), "X");
				terminal.resize(20, 8);
				await terminal.waitForRender();
				assert.deepStrictEqual(
					terminal.getViewport().map((line) => line.trimEnd()),
					["line-7", "line-8", "line-9", "", "", "", "", "X"],
				);
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					[...base.lines, "", "", "", "", "X"],
				);
				overlay.hide();
				await terminal.waitForRender();
				assert.deepStrictEqual(
					terminal.getViewport().map((line) => line.trimEnd()),
					["line-7", "line-8", "line-9", "", "", "", "", ""],
				);
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					[...base.lines, "", "", "", "", ""],
				);
				assert.ok(!terminal.getWrites().includes("\x1b[3J"));
			} finally {
				tui.stop();
			}
		});
	});
});

describe("TUI drawn cursor", () => {
	it("shows only the hardware cursor for a focused input when enabled", async () => {
		const terminal = new LoggingVirtualTerminal(20, 5);
		const tui: TUI = new TuiMainScreen(terminal);
		const input = new Input();
		input.setValue("abc");
		tui.addChild(input);
		tui.setFocus(input);
		tui.start();
		await terminal.waitForRender();
		assert.ok(terminal.getWrites().includes("> \x1b[7ma\x1b[27mbc"));
		terminal.clearWrites();
		tui.setShowHardwareCursor(true);
		await terminal.waitForRender();
		assert.ok(!terminal.getWrites().includes("\x1b[7m"));
		assert.ok(!terminal.getWrites().includes("\x1b_pi:"));
		tui.stop();
	});

	it("keeps the drawn cursor of an unfocused input when the hardware cursor is shown", async () => {
		const terminal = new LoggingVirtualTerminal(20, 5);
		const tui: TUI = new TuiMainScreen(terminal, true);
		const input = new Input();
		input.setValue("abc");
		tui.addChild(input);
		tui.start();
		await terminal.waitForRender();
		assert.ok(terminal.getWrites().includes("> \x1b[7ma\x1b[27mbc"));
		tui.stop();
	});

	it("omits the focused drawn cursor when truncation drops its reset", async () => {
		const terminal = new LoggingVirtualTerminal(20, 5);
		const tui: TUI = new TuiMainScreen(terminal, true);
		const base = new TestComponent();
		base.lines = [sliceByColumn(`ab${CURSOR_MARKER}\x1b[7mc\x1b[27mdef`, 0, 3, true)];
		tui.addChild(base);
		tui.start();
		await terminal.waitForRender();
		assert.ok(!terminal.getWrites().includes("\x1b[7m"));
		assert.ok(terminal.getWrites().endsWith("\x1b[3G"));
		tui.stop();
	});

	it("keeps the cursor when an overlay ends directly left of it", async () => {
		for (const showHardwareCursor of [false, true]) {
			const terminal = new LoggingVirtualTerminal(20, 5);
			const tui: TUI = new TuiMainScreen(terminal, showHardwareCursor);
			const base = new TestComponent();
			base.lines = [`abc${CURSOR_MARKER}\x1b[7md\x1b[27mef`];
			tui.addChild(base);
			const overlay = new TestComponent();
			overlay.lines = ["XXX"];
			tui.showOverlay(overlay, { row: 0, col: 0, width: 3 });
			tui.start();
			await terminal.waitForRender();
			const writes = terminal.getWrites();
			assert.ok(writes.includes("XXX"));
			assert.strictEqual(writes.includes("\x1b[7md"), !showHardwareCursor);
			assert.ok(writes.endsWith("\x1b[4G"));
			tui.stop();
		}
	});
});
