import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Editor } from "../src/components/editor.ts";
import { Text } from "../src/components/text.ts";
import { TruncatedText } from "../src/components/truncated-text.ts";
import type { TuiMouseEvent } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { setPadLinesToWidth, visibleWidth } from "../src/utils.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

afterEach(() => setPadLinesToWidth(false));

it("keeps Box content visible in a one-column viewport instead of spending it on margins", () => {
	setPadLinesToWidth(true);
	const box = new Box(2, 0);
	box.addChild(new Text("x", 0, 0));
	assert.deepEqual(box.render(1), ["x"]);
});

it("keeps truncated content inside narrow viewports with oversized configured margins", () => {
	setPadLinesToWidth(true);
	const text = new TruncatedText("x", 4, 0);
	for (const width of [1, 2, 3]) {
		const lines = text.render(width);
		assert.equal(visibleWidth(lines[0]), width);
		assert.equal(lines[0].trim(), "x");
	}
});

for (const { padded, width, x, expected } of [
	{ padded: false, width: 20, x: 3, expected: "abcXdef" },
	{ padded: true, width: 1, x: 0, expected: "Xabcdef" },
]) {
	it(`routes a Box click using its rendered margin (padding ${padded}, width ${width})`, () => {
		setPadLinesToWidth(padded);
		const editor = new Editor(new TuiMainScreen(new VirtualTerminal(width, 24)), defaultEditorTheme, { paddingX: 0 });
		editor.setText("abcdef");
		const box = new Box(2, 0);
		box.addChild(editor);
		const height = box.render(width).length;
		const event: TuiMouseEvent = {
			type: "click",
			button: "left",
			x,
			y: 1,
			screenX: x,
			screenY: 1,
			width,
			height,
			shift: false,
			alt: false,
			ctrl: false,
		};
		box.handleMouse(event);
		editor.handleInput("X");
		assert.equal(editor.getText(), expected);
	});
}
