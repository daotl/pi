import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import promptUrlWidgetExtension from "../../../../.pi/extensions/prompt-url-widget.ts";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { createInteractiveTui } from "../../src/modes/interactive/tui-renderer.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, createTestUiContext } from "./harness.ts";

it.each([
	["PR", "You are given one or more GitHub PR URLs:", "https://github.com/example/repo/pull/12"],
	["Issue", "Analyze GitHub issue(s):", "https://github.com/example/repo/issues/34"],
	[
		"Advisory",
		"Update a GitHub security advisory for publication:",
		"https://github.com/example/repo/security/advisories/GHSA-abcd-efgh-ijkl",
	],
])("ignores custom-start events while preserving the %s prompt widget", async (label, prefix, url) => {
	initTheme("dark");
	const harness = await createHarness({
		extensionFactories: [
			(pi) =>
				promptUrlWidgetExtension({
					...pi,
					exec: async () => ({
						code: 0,
						killed: false,
						stderr: "",
						stdout: JSON.stringify({ title: "Tracked work", summary: "Tracked work" }),
					}),
				}),
		],
	});
	harness.setResponses([
		fauxAssistantMessage("Custom notice handled"),
		fauxAssistantMessage("User prompt handled"),
		fauxAssistantMessage("Second notice handled"),
	]);
	const renderer = createInteractiveTui({
		tuiMode: "regular",
		showHardwareCursor: false,
		logDirectory: harness.tempDir,
		terminal: new VirtualTerminal(120, 40),
	});
	const widgets = new Map<string, string>();
	const errors: string[] = [];
	const ui = createTestUiContext({
		setWidget: (key: string, content: string[] | ((tui: TUI, thm: typeof theme) => Component) | undefined) => {
			if (content === undefined) widgets.delete(key);
			else {
				const lines = typeof content === "function" ? content(renderer, theme).render(120) : content;
				widgets.set(key, stripAnsi(lines.join("\n")));
			}
		},
	});
	try {
		await harness.session.bindExtensions({ uiContext: ui, onError: (error) => errors.push(error.error) });
		await harness.session.sendCustomMessage(
			{ customType: "background-notice", content: "Background task completed", display: true },
			{ triggerTurn: true },
		);
		expect(errors).toEqual([]);
		expect(widgets.has("prompt-url")).toBe(false);
		await harness.session.prompt(`${prefix} ${url}`);
		await vi.waitFor(() => expect(widgets.get("prompt-url")).toContain("Tracked work"));
		expect(widgets.get("prompt-url")).toContain(url);
		expect(harness.sessionManager.getSessionName()).toBe(`${label}: Tracked work (${url})`);
		const widget = widgets.get("prompt-url");
		await harness.session.sendCustomMessage(
			{ customType: "background-notice", content: "Background task completed", display: true },
			{ triggerTurn: true },
		);
		expect(errors).toEqual([]);
		expect(widgets.get("prompt-url")).toBe(widget);
		expect(harness.sessionManager.getSessionName()).toBe(`${label}: Tracked work (${url})`);
	} finally {
		renderer.stop();
		harness.cleanup();
	}
});
