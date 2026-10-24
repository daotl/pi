import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Text } from "../src/components/text.ts";
import { type Component, CURSOR_MARKER, type TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class SimpleContent implements Component {
	private lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}
	invalidate() {}
}

class SimpleOverlay implements Component {
	render(): string[] {
		return ["OVERLAY_TOP", "OVERLAY_MID", "OVERLAY_BOT"];
	}
	invalidate() {}
}

describe("TUI overlay with short content", () => {
	for (const { line, base, covered } of [
		{ line: "abc\rZ", base: "Zbc", covered: "Xbc" },
		{ line: "abc\r\x1b[CZ", base: "aZc", covered: "XZc" },
		{ line: "a界c\rZ", base: "Z界c", covered: "X界c" },
		{ line: "界bc\rZ", base: "Z bc", covered: "X bc" },
		{ line: "ábc\rZ", base: "Zbc", covered: "Xbc" },
	]) {
		it(`composes and restores column-zero overlays over ${JSON.stringify(line)}`, async () => {
			const terminal = new VirtualTerminal(20, 7);
			const tui = new TuiMainScreen(terminal);
			tui.addChild(new SimpleContent([line]));
			try {
				tui.start();
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[0], base);
				const content = new Text("X", 0, 0);
				const overlay = tui.showOverlay(content, { width: 1, row: 0, col: 0, nonCapturing: true });
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[0].trimEnd(), covered);
				content.setText("Y");
				tui.requestRender();
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[0].trimEnd(), `Y${base.slice(1)}`);
				overlay.hide();
				await terminal.waitForRender();
				assert.strictEqual(terminal.getViewport()[0], base);
			} finally {
				tui.stop();
			}
		});
	}

	it("retains overwritten and untouched cell styles through overlay updates and restoration", async () => {
		const terminal = new VirtualTerminal(20, 7);
		const tui = new TuiMainScreen(terminal);
		tui.addChild(new SimpleContent(["\x1b[31mabc\r\x1b[32mZ"]));
		// The existing terminal harness keeps its real xterm instance private.
		const terminalWithXterm = terminal as unknown as { xterm: XtermTerminalType };
		const xterm = terminalWithXterm.xterm;
		const colorAt = (column: number) => {
			const cell = xterm.buffer.active.getLine(xterm.buffer.active.viewportY)?.getCell(column);
			assert.ok(cell);
			return { mode: cell.getFgColorMode(), color: cell.getFgColor() };
		};
		try {
			tui.start();
			await terminal.waitForRender();
			const overwrittenColor = colorAt(0);
			const retainedColor = colorAt(1);
			assert.notDeepStrictEqual(overwrittenColor, retainedColor);
			const content = new Text("X", 0, 0);
			const overlay = tui.showOverlay(content, { width: 1, row: 0, col: 0, nonCapturing: true });
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[0].trimEnd(), "Xbc");
			assert.deepStrictEqual(colorAt(1), retainedColor);
			content.setText("Y");
			tui.requestRender();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[0].trimEnd(), "Ybc");
			assert.deepStrictEqual(colorAt(1), retainedColor);
			overlay.hide();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[0], "Zbc");
			assert.deepStrictEqual(colorAt(0), overwrittenColor);
			assert.deepStrictEqual(colorAt(1), retainedColor);
		} finally {
			tui.stop();
		}
	});

	for (const lines of [["base", "ready"], []]) {
		it(`places shell output below an open bottom overlay with ${lines.length} transcript rows`, async () => {
			const terminal = new VirtualTerminal(20, 7);
			terminal.write("shell\r\nprevious\r\n");
			await terminal.flush();
			const tui = new TuiMainScreen(terminal);
			tui.addChild(new SimpleContent(lines));
			try {
				tui.start();
				await terminal.waitForRender();
				tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), {
					width: 8,
					anchor: "bottom-left",
					nonCapturing: true,
				});
				await terminal.waitForRender();
				const retained = ["shell", "previous", ...lines, ...Array(5 - lines.length).fill(""), "TOP", "BOTTOM"];
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					retained,
				);
				tui.stop();
				terminal.write("shell $ ");
				await terminal.flush();
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					[...retained, "shell $"],
				);
				assert.deepStrictEqual(terminal.getCursorPosition(), { x: 8, y: 6 });
			} finally {
				tui.stop();
			}
		});
	}

	it("preserves the cursor and open bottom overlay on preserveScreen shutdown", async () => {
		const terminal = new VirtualTerminal(20, 7);
		const tui = new TuiMainScreen(terminal);
		tui.addChild(new SimpleContent([`ready${CURSOR_MARKER}`]));
		tui.setShowHardwareCursor(true);
		tui.start();
		await terminal.waitForRender();
		tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), { width: 8, anchor: "bottom-left", nonCapturing: true });
		await terminal.waitForRender();
		const retained = terminal.getScrollBuffer();
		const cursor = terminal.getCursorPosition();
		tui.stop({ preserveScreen: true });
		await terminal.flush();
		assert.deepStrictEqual(terminal.getScrollBuffer(), retained);
		assert.deepStrictEqual(terminal.getCursorPosition(), cursor);
	});

	it("reserves bottom overlay rows below shell output without clamping or losing history", async () => {
		const terminal = new VirtualTerminal(20, 7);
		terminal.write("shell $ pwd\r\n/tmp/project\r\n");
		await terminal.flush();
		const tui = new TuiMainScreen(terminal);
		const lines = ["base", `ready${CURSOR_MARKER}`];
		tui.addChild(new SimpleContent(lines));
		tui.setShowHardwareCursor(true);
		try {
			tui.start();
			await terminal.waitForRender();
			const content = new Text("TOP\nBOTTOM", 0, 0);
			const overlay = tui.showOverlay(content, { width: 8, anchor: "bottom-left", nonCapturing: true });
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer().slice(0, 4), [
				"shell $ pwd",
				"/tmp/project",
				"base",
				"ready",
			]);
			assert.strictEqual(terminal.getViewport()[5].trim(), "TOP");
			assert.strictEqual(terminal.getViewport()[6].trim(), "BOTTOM");
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
			content.setText("NEXT\nLAST");
			tui.requestRender();
			await terminal.waitForRender();
			assert.strictEqual(terminal.getViewport()[5].trim(), "NEXT");
			assert.strictEqual(terminal.getViewport()[6].trim(), "LAST");
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["base", "ready", "", "", "", "", ""]);
			lines[1] = `later${CURSOR_MARKER}`;
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer().slice(0, 4), [
				"shell $ pwd",
				"/tmp/project",
				"base",
				"later",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
		} finally {
			tui.stop();
		}
	});
	it("preserves shell output and cursor placement through overlays below a nonzero origin", async () => {
		const terminal = new VirtualTerminal(20, 7);
		terminal.write("shell $ pwd\r\n/tmp/project\r\n");
		await terminal.flush();
		assert.deepStrictEqual(terminal.getCursorPosition(), { x: 0, y: 2 });
		const tui = new TuiMainScreen(terminal);
		const lines = ["base", `ready${CURSOR_MARKER}`];
		tui.addChild(new SimpleContent(lines));
		tui.setShowHardwareCursor(true);
		const initial = ["shell $ pwd", "/tmp/project", "base", "ready", "", "", ""];
		try {
			tui.start();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), initial);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 3 });

			const content = new Text("X", 0, 0);
			const overlay = tui.showOverlay(content, { width: 1, row: 0, col: 0, nonCapturing: true });
			await terminal.waitForRender();
			assert.deepStrictEqual(
				terminal.getViewport().map((line) => line.trimEnd()),
				[...initial.slice(0, 2), "Xase", ...initial.slice(3)],
			);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 3 });

			content.setText("Y");
			lines[1] = `done${CURSOR_MARKER}`;
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(
				terminal.getViewport().map((line) => line.trimEnd()),
				["shell $ pwd", "/tmp/project", "Yase", "done", "", "", ""],
			);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 4, y: 3 });

			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["shell $ pwd", "/tmp/project", "base", "done", "", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 4, y: 3 });

			lines[0] = "next";
			lines[1] = `after${CURSOR_MARKER}`;
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["shell $ pwd", "/tmp/project", "next", "after", "", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 3 });
		} finally {
			tui.stop();
		}
	});

	it("restores native-reflow rows after a multirow overlay below shell output", async () => {
		const terminal = new VirtualTerminal(10, 7);
		terminal.write("shell\r\n");
		await terminal.flush();
		const tui = new TuiMainScreen(terminal);
		const lines = ["123456789界abcdefg", `ready${CURSOR_MARKER}`];
		tui.addChild(new SimpleContent(lines));
		tui.setShowHardwareCursor(true);
		try {
			tui.start();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["shell", "123456789", "界abcdefg", "ready", "", "", ""]);
			const overlay = tui.showOverlay(new Text("X\nY", 0, 0), {
				width: 1,
				row: 0,
				col: 4,
				nonCapturing: true,
			});
			await terminal.waitForRender();
			assert.deepStrictEqual(
				terminal.getViewport().map((line) => line.trimEnd()),
				["shell", "1234X6789", "界abYdefg", "ready", "", "", ""],
			);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 3 });

			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["shell", "123456789", "界abcdefg", "ready", "", "", ""]);
			lines[1] = `later${CURSOR_MARKER}`;
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["shell", "123456789", "界abcdefg", "later", "", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 3 });
		} finally {
			tui.stop();
		}
	});
	it("should render overlay when content is shorter than terminal height", async () => {
		// Terminal has 24 rows, but content only has 3 lines
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);

		// Only 3 lines of content
		tui.addChild(new SimpleContent(["Line 1", "Line 2", "Line 3"]));

		// Show overlay centered - should be around row 10 in a 24-row terminal
		const overlay = new SimpleOverlay();
		tui.showOverlay(overlay);

		// Trigger render
		tui.start();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		const hasOverlay = viewport.some((line) => line.includes("OVERLAY"));

		console.log("Terminal rows:", terminal.rows);
		console.log("Content lines: 3");
		console.log("Overlay visible:", hasOverlay);

		if (!hasOverlay) {
			console.log("\nViewport contents:");
			for (let i = 0; i < viewport.length; i++) {
				console.log(`  [${i}]: "${viewport[i]}"`);
			}
		}

		assert.ok(hasOverlay, "Overlay should be visible when content is shorter than terminal");

		tui.stop();
	});
});

describe("bottom overlay row reservation lifecycle", () => {
	it("keeps an empty transcript's overlay origin stable on unchanged renders", async () => {
		const terminal = new VirtualTerminal(20, 7);
		terminal.write("shell\r\nprevious\r\n");
		await terminal.flush();
		const tui = new TuiMainScreen(terminal);
		tui.addChild(new SimpleContent([]));
		try {
			tui.start();
			await terminal.waitForRender();
			const overlay = tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), {
				width: 8,
				anchor: "bottom-left",
				nonCapturing: true,
			});
			await terminal.waitForRender();
			const expected = ["shell", "previous", "", "", "", "", "", "TOP", "BOTTOM"];
			assert.deepStrictEqual(
				terminal.getScrollBuffer().map((line) => line.trimEnd()),
				expected,
			);
			for (let frame = 0; frame < 2; frame++) {
				tui.requestRender();
				await terminal.waitForRender();
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					expected,
				);
			}
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(
				terminal.getScrollBuffer().map((line) => line.trimEnd()),
				["shell", "previous", "", "", "", "", "", "", ""],
			);
		} finally {
			tui.stop();
		}
	});
	it("does not shift shell history again when reopening, hiding, or moving an overlay", async () => {
		const terminal = new VirtualTerminal(20, 7);
		const shell = ["shell $ pwd", "/tmp/project"];
		terminal.write(`${shell.join("\r\n")}\r\n`);
		await terminal.flush();
		const tui = new TuiMainScreen(terminal);
		tui.addChild(new SimpleContent(["base", `ready${CURSOR_MARKER}`]));
		tui.setShowHardwareCursor(true);
		tui.setClearOnShrink(true);
		const base = ["base", "ready", "", "", "", "", ""];
		const bottom = [...base.slice(0, 5), "TOP", "BOTTOM"];
		const check = (viewport: string[]) => {
			assert.deepStrictEqual(
				terminal.getViewport().map((line) => line.trimEnd()),
				viewport,
			);
			assert.deepStrictEqual(
				terminal.getScrollBuffer().map((line) => line.trimEnd()),
				[...shell, ...viewport],
			);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
		};
		try {
			tui.start();
			await terminal.waitForRender();
			for (let cycle = 0; cycle < 2; cycle++) {
				const overlay = tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), {
					width: 8,
					anchor: "bottom-left",
					nonCapturing: true,
				});
				await terminal.waitForRender();
				check(bottom);
				overlay.setHidden(true);
				await terminal.waitForRender();
				check(base);
				overlay.setHidden(false);
				await terminal.waitForRender();
				check(bottom);
				tui.requestRender();
				await terminal.waitForRender();
				check(bottom);
				overlay.hide();
				await terminal.waitForRender();
				check(base);
				const top = tui.showOverlay(new Text("X", 0, 0), {
					width: 1,
					anchor: "top-left",
					nonCapturing: true,
				});
				await terminal.waitForRender();
				check(["Xase", ...base.slice(1)]);
				top.hide();
				await terminal.waitForRender();
				check(base);
			}
		} finally {
			tui.stop();
		}
	});

	it("grows through reserved blank rows and into scrollback without archiving overlay cells", async () => {
		const terminal = new VirtualTerminal(20, 7);
		const shell = ["shell $ run", "previous output"];
		terminal.write(`${shell.join("\r\n")}\r\n`);
		await terminal.flush();
		const lines = ["row-0", `row-1${CURSOR_MARKER}`];
		const tui = new TuiMainScreen(terminal);
		tui.addChild(new SimpleContent(lines));
		tui.setShowHardwareCursor(true);
		try {
			tui.start();
			await terminal.waitForRender();
			const overlay = tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), {
				width: 8,
				anchor: "bottom-left",
				nonCapturing: true,
			});
			await terminal.waitForRender();
			assert.deepStrictEqual(
				terminal.getScrollBuffer().map((line) => line.trimEnd()),
				[...shell, "row-0", "row-1", "", "", "", "TOP", "BOTTOM"],
			);
			for (const count of [4, 7, 10, 13]) {
				lines[lines.length - 1] = lines[lines.length - 1].replace(CURSOR_MARKER, "");
				while (lines.length < count) lines.push(`row-${lines.length}`);
				lines[count - 1] += CURSOR_MARKER;
				tui.requestRender();
				await terminal.waitForRender();
				const transcript = Array.from({ length: count }, (_, row) => `row-${row}`);
				const top = Math.max(0, count - terminal.rows);
				const viewport = [...transcript.slice(top), ...Array(Math.max(0, terminal.rows - count)).fill("")];
				viewport.splice(5, 2, "TOP", "BOTTOM");
				assert.deepStrictEqual(
					terminal.getViewport().map((line) => line.trimEnd()),
					viewport,
				);
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					[...shell, ...transcript.slice(0, top), ...viewport],
				);
				assert.deepStrictEqual(terminal.getCursorPosition(), {
					x: `row-${count - 1}`.length,
					y: Math.min(count, 7) - 1,
				});
			}
			overlay.hide();
			await terminal.waitForRender();
			const transcript = Array.from({ length: 13 }, (_, row) => `row-${row}`);
			assert.deepStrictEqual(terminal.getScrollBuffer(), [...shell, ...transcript]);
			assert.deepStrictEqual(terminal.getViewport(), transcript.slice(-7));
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 6, y: 6 });
		} finally {
			tui.stop();
		}
	});

	it("rebuilds bottom overlay space after height and width redraws without inflating the transcript", async () => {
		const terminal = new VirtualTerminal(20, 7);
		terminal.write("shell\r\noutput\r\n");
		await terminal.flush();
		const tui = new TuiMainScreen(terminal);
		const lines = ["base", `ready${CURSOR_MARKER}`];
		tui.addChild(new SimpleContent(lines));
		tui.setShowHardwareCursor(true);
		try {
			tui.start();
			await terminal.waitForRender();
			const overlay = tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), {
				width: 8,
				anchor: "bottom-left",
				nonCapturing: true,
			});
			await terminal.waitForRender();
			for (const [width, height] of [
				[20, 5],
				[20, 9],
				[12, 9],
				[12, 6],
			]) {
				terminal.resize(width, height);
				await terminal.waitForRender();
				const base = ["base", "ready", ...Array(height - 2).fill("")];
				const bottom = [...base.slice(0, -2), "TOP", "BOTTOM"];
				assert.deepStrictEqual(
					terminal.getViewport().map((line) => line.trimEnd()),
					bottom,
				);
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					bottom,
				);
				assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
				overlay.setHidden(true);
				await terminal.waitForRender();
				assert.deepStrictEqual(terminal.getViewport(), base);
				assert.deepStrictEqual(terminal.getScrollBuffer(), base);
				overlay.setHidden(false);
				await terminal.waitForRender();
				assert.deepStrictEqual(
					terminal.getViewport().map((line) => line.trimEnd()),
					bottom,
				);
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					bottom,
				);
			}
			overlay.hide();
			await terminal.waitForRender();
			lines[1] = `later${CURSOR_MARKER}`;
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer(), ["base", "later", "", "", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
		} finally {
			tui.stop();
		}
	});

	it("preserves reserved rows across a stopped renderer handoff before and after resize", async () => {
		const terminal = new VirtualTerminal(20, 7);
		terminal.write("shell\r\noutput\r\n");
		await terminal.flush();
		const lines = ["base", `ready${CURSOR_MARKER}`];
		const content = new SimpleContent(lines);
		let tui = new TuiMainScreen(terminal);
		tui.addChild(content);
		tui.setShowHardwareCursor(true);
		try {
			tui.start();
			await terminal.waitForRender();
			let overlay = tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), {
				width: 8,
				anchor: "bottom-left",
				nonCapturing: true,
			});
			await terminal.waitForRender();
			for (const height of [7, 9]) {
				if (terminal.rows !== height) {
					terminal.resize(20, height);
					await terminal.waitForRender();
				}
				// Production handoff rejects open overlays: restore their cells before capture.
				overlay.hide();
				await terminal.waitForRender();
				const base = ["base", "ready", ...Array(height - 2).fill("")];
				const history = height === 7 ? ["shell", "output"] : [];
				assert.deepStrictEqual(terminal.getScrollBuffer(), [...history, ...base]);
				const state = tui.captureRenderState();
				tui.stop({ preserveScreen: true });
				await terminal.flush();
				assert.deepStrictEqual(terminal.getScrollBuffer(), [...history, ...base]);
				assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
				tui = new TuiMainScreen(terminal);
				tui.restoreRenderState(state);
				tui.addChild(content);
				tui.setShowHardwareCursor(true);
				tui.start();
				await terminal.waitForRender();
				assert.deepStrictEqual(terminal.getViewport(), base);
				assert.deepStrictEqual(terminal.getScrollBuffer(), [...history, ...base]);
				assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
				overlay = tui.showOverlay(new Text("TOP\nBOTTOM", 0, 0), {
					width: 8,
					anchor: "bottom-left",
					nonCapturing: true,
				});
				await terminal.waitForRender();
				const bottom = [...base.slice(0, -2), "TOP", "BOTTOM"];
				assert.deepStrictEqual(
					terminal.getViewport().map((line) => line.trimEnd()),
					bottom,
				);
				assert.deepStrictEqual(
					terminal.getScrollBuffer().map((line) => line.trimEnd()),
					[...history, ...bottom],
				);
				assert.deepStrictEqual(terminal.getCursorPosition(), { x: 5, y: 1 });
			}
			overlay.hide();
			await terminal.waitForRender();
			lines[1] = `done${CURSOR_MARKER}`;
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getScrollBuffer(), ["base", "done", "", "", "", "", "", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 4, y: 1 });
		} finally {
			tui.stop();
		}
	});
});
