import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, CURSOR_MARKER } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { stripTerminalSequences, terminalLinePhysicalRows, terminalLineRows, visibleWidth } from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class TestComponent implements Component {
	lines: string[] = [];
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

describe("TUI wrapped-line differential rendering (wrapping disabled)", () => {
	it("preserves text width while materializing forward cursor gaps for overlay restoration", () => {
		const source = "a\x1b[2Cb";
		assert.strictEqual(visibleWidth(source), 2);
		assert.strictEqual(terminalLineRows(source, 10), 1);
		assert.deepStrictEqual(terminalLinePhysicalRows(source, 10).map(stripTerminalSequences), ["a  b"]);
	});
	it("matches terminal rows when cursor-forward movement reaches the wrap boundary", async () => {
		for (const [source, expected] of [
			["abcdefgh\x1b[2CXY", ["abcdefgh X", "Y"]],
			["abcdefghij\x1b[2CXY", ["abcdefghiX", "Y"]],
			["abcdefgh\x1b[0CXY", ["abcdefgh X", "Y"]],
			["abcdefgh\x1b[C界Z", ["abcdefgh", "界Z"]],
			["abcdefgh\x1b[2CX\rZ", ["Zbcdefgh X"]],
			["\x1b[31m\x1b]8;;https://example.com\x1b\\abcdefg a\u0301\x1b[2CXY", ["abcdefg áX", "Y"]],
		] as const) {
			const terminal = new VirtualTerminal(10, 4);
			terminal.write(source);
			await terminal.flush();
			assert.deepStrictEqual(terminal.getViewport().slice(0, expected.length), expected);
			assert.strictEqual(terminalLineRows(source, 10), expected.length);
			const rows = terminalLinePhysicalRows(source, 10);
			assert.deepStrictEqual(rows.map(stripTerminalSequences), expected);
			for (const row of rows) assert.ok(visibleWidth(row) <= 10);
			const replay = new VirtualTerminal(10, 4);
			replay.write(rows.join("\x1b[0m\x1b]8;;\x1b\\\r\n"));
			await replay.flush();
			assert.deepStrictEqual(replay.getViewport().slice(0, expected.length), expected);
			assert.deepStrictEqual(terminalLinePhysicalRows(source, 10, 1).map(stripTerminalSequences), expected.slice(1));
		}
	});

	it("preserves cursor-forward continuation and following content through overlay open and hide", async () => {
		const terminal = new VirtualTerminal(10, 6);
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		component.lines = ["Header", "abcdefgh\x1b[2CXY", "Footer"];
		tui.addChild(component);
		tui.start();
		try {
			await terminal.waitForRender();
			const expected = ["Header", "abcdefgh X", "Y", "Footer", "", ""];
			assert.deepStrictEqual(terminal.getViewport(), expected);
			const content = new TestComponent();
			content.lines = ["Q"];
			const overlay = tui.showOverlay(content, { width: 1, row: 1, col: 0, nonCapturing: true });
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["Header", "Qbcdefgh X", "Y", "Footer", "", ""]);
			overlay.hide();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), expected);
		} finally {
			tui.stop();
		}
	});

	it("wraps independently rendered Indic constituents without pushing the footer cursor down", async () => {
		const terminal = new VirtualTerminal(79, 6);
		const tui = new TuiMainScreen(terminal, true);
		const component = new TestComponent();
		const body = "र्क".repeat(79);
		component.lines = ["Header", body, `Footer${CURSOR_MARKER}`];
		tui.addChild(component);
		tui.start();
		try {
			await terminal.waitForRender();
			const expectedBody = [`${"र्क".repeat(39)}र्`, `क${"र्क".repeat(39)}`];
			assert.deepStrictEqual(terminal.getViewport(), ["Header", ...expectedBody, "Footer", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 6, y: 3 });

			component.lines = ["Changed", body, `Footer${CURSOR_MARKER}`];
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["Changed", ...expectedBody, "Footer", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 6, y: 3 });
		} finally {
			tui.stop();
		}
	});

	it("positions the hardware cursor before a wide glyph that wraps and after the last glyph", async () => {
		const terminal = new VirtualTerminal(79, 6);
		const tui = new TuiMainScreen(terminal, true);
		const component = new TestComponent();
		let wide = `${"界".repeat(78)}${CURSOR_MARKER}界`;
		component.lines = ["Header", wide, "Footer"];
		tui.addChild(component);
		tui.start();
		try {
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [
				"Header",
				"界".repeat(39),
				"界".repeat(39),
				"界",
				"Footer",
				"",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 0, y: 3 });

			component.lines = ["Changed", wide, "Footer"];
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [
				"Changed",
				"界".repeat(39),
				"界".repeat(39),
				"界",
				"Footer",
				"",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 0, y: 3 });

			wide = `${"界".repeat(79)}${CURSOR_MARKER}`;
			component.lines = ["Changed", wide, "Footer"];
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [
				"Changed",
				"界".repeat(39),
				"界".repeat(39),
				"界",
				"Footer",
				"",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 2, y: 3 });
		} finally {
			tui.stop();
		}
	});

	it("positions the hardware cursor after embedded newlines without counting control payload newlines", async () => {
		const terminal = new VirtualTerminal(8, 6);
		const tui = new TuiMainScreen(terminal, true);
		const component = new TestComponent();
		const payload = "\x1b]0;hidden\ntext\x07\x1b_hidden\ntext\x1b\\";
		component.lines = ["Header", `abc\n${payload}12${CURSOR_MARKER}3456`, "Footer"];
		tui.addChild(component);
		tui.start();
		try {
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["Header", "abc", "123456", "Footer", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 2, y: 2 });
		} finally {
			tui.stop();
		}
	});

	it("keeps ASCII cursor positions across exact-width wraps and zero-width controls", async () => {
		const terminal = new VirtualTerminal(8, 5);
		const tui = new TuiMainScreen(terminal, true);
		const component = new TestComponent();
		component.lines = ["Header", `abcdefgh${CURSOR_MARKER}\x1b[31m\u0301\x1b[0mX`, "Footer"];
		tui.addChild(component);
		tui.start();
		try {
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["Header", "abcdefgh", "X", "Footer", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 0, y: 2 });

			component.lines = ["Header", `abcdefgh${CURSOR_MARKER}`, "Footer"];
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["Header", "abcdefgh", "Footer", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 0, y: 2 });
		} finally {
			tui.stop();
		}
	});

	it("preserves three CJK rows at an odd terminal width when the header changes", async () => {
		const terminal = new VirtualTerminal(79, 6);
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		const wide = "界".repeat(79);
		component.lines = ["Header", wide, "Footer"];
		tui.addChild(component);
		tui.start();
		let stopped = false;
		try {
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [
				"Header",
				"界".repeat(39),
				"界".repeat(39),
				"界",
				"Footer",
				"",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 6, y: 4 });

			component.lines = ["Changed", wide, "Footer"];
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [
				"Changed",
				"界".repeat(39),
				"界".repeat(39),
				"界",
				"Footer",
				"",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 7, y: 0 });
			tui.stop();
			stopped = true;
			terminal.write("shell prompt");
			await terminal.flush();
			assert.deepStrictEqual(
				terminal
					.getScrollBuffer()
					.slice(0, 7)
					.map((line) => line.trimEnd()),
				["Changed", "界".repeat(39), "界".repeat(39), "界", "Footer", "", "shell prompt"],
			);
		} finally {
			if (!stopped) tui.stop();
		}
	});

	it("starts embedded newlines at column zero and preserves rows when the header changes", async () => {
		const terminal = new VirtualTerminal(8, 6);
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		component.lines = ["Header", "abc\n123456", "Footer"];
		tui.addChild(component);
		tui.start();
		try {
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["Header", "abc", "123456", "Footer", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 6, y: 3 });

			component.lines = ["Changed", "abc\n123456", "Footer"];
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), ["Changed", "abc", "123456", "Footer", "", ""]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 7, y: 0 });
		} finally {
			tui.stop();
		}
	});

	it("materializes exact-width pending wraps only for visible glyphs", async () => {
		const terminal = new VirtualTerminal(8, 11);
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		const pending = "abcdefgh\x1b[31m\u0301\x1b[0m";
		const payload = "\x1b]0;hidden\ntext\x07\x1b_hidden\ntext\x1b\\";
		const content = [pending, `${pending}\nN`, `${pending}X`, `abc\r\n123456`, `abc\rZ`, `end${payload}`];
		component.lines = ["Header", ...content];
		tui.addChild(component);
		tui.start();
		try {
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [
				"Header",
				"abcdefgh",
				"abcdefgh",
				"N",
				"abcdefgh",
				"X",
				"abc",
				"123456",
				"Zbc",
				"end",
				"",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 3, y: 9 });

			component.lines = ["Changed", ...content];
			tui.requestRender();
			await terminal.waitForRender();
			assert.deepStrictEqual(terminal.getViewport(), [
				"Changed",
				"abcdefgh",
				"abcdefgh",
				"N",
				"abcdefgh",
				"X",
				"abc",
				"123456",
				"Zbc",
				"end",
				"",
			]);
			assert.deepStrictEqual(terminal.getCursorPosition(), { x: 7, y: 0 });
		} finally {
			tui.stop();
		}
	});
	it("positions a later changed line below a wrapped (multi-row) line", async () => {
		const terminal = new VirtualTerminal(20, 6);
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Middle line is wider than the 20-col terminal, so it wraps to two rows.
		const wide = "A".repeat(30);
		component.lines = ["Header", wide, "Footer"];
		tui.start();
		await terminal.waitForRender();

		// Initial render: Header (row0), wide wraps to rows 1-2, Footer on row 3.
		let viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Header"), `row0: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("AAA"), `row1 (wide first fragment): ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("AAA"), `row2 (wide second fragment): ${viewport[2]}`);
		assert.ok(viewport[3]?.includes("Footer"), `row3: ${viewport[3]}`);

		// Change the last line: the differential renderer must move to the correct
		// terminal row (below the wrapped wide line) and rewrite it there.
		component.lines = ["Header", wide, "CHANGED"];
		tui.requestRender();
		await terminal.waitForRender();

		viewport = terminal.getViewport();
		assert.ok(viewport[3]?.includes("CHANGED"), `row3 should be CHANGED, got: ${viewport[3]}`);
		assert.ok(viewport[4]?.trim() === "", `row4 should be empty, got: ${viewport[4]}`);
		// The wrapped wide line must stay intact across rows 1-2.
		assert.ok(viewport[1]?.includes("AAA"), `row1 wide fragment preserved: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("AAA"), `row2 wide fragment preserved: ${viewport[2]}`);
		assert.ok(!viewport.join("\n").includes("Footer"), "no stale Footer should remain");

		tui.stop();
	});

	it("does not duplicate a wrapped line when it shrinks to a single row", async () => {
		const terminal = new VirtualTerminal(20, 6);
		const tui = new TuiMainScreen(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// First render: a wide line wrapped to two rows, then a footer below it.
		const wide = "B".repeat(30);
		component.lines = ["Top", wide, "Footer"];
		tui.start();
		await terminal.waitForRender();

		// Shrink the wide line to a short one: the wrapped second row must not linger.
		component.lines = ["Top", "Short", "Footer"];
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		assert.ok(viewport[1]?.includes("Short"), `row1: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("Footer"), `row2 should be Footer (wide's second row cleared): ${viewport[2]}`);
		assert.ok(!viewport.join("\n").includes("B".repeat(2)), "no stale wide fragments should remain");

		tui.stop();
	});
});
