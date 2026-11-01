import { Text } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { playArmin3d, playPiLogo3d } from "../src/modes/interactive/components/easter-egg-3d.lazy.ts";
import { EasterEgg3dAnimation } from "../src/modes/interactive/components/easter-egg-3d.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { createInteractiveTui } from "../src/modes/interactive/tui-renderer.ts";

it("keeps regular-screen Armin available and does not replace an existing fullscreen dialog", () => {
	const terminal = new VirtualTerminal(80, 24);
	const regular = createInteractiveTui({
		tuiMode: "regular",
		showHardwareCursor: false,
		logDirectory: "/tmp",
		terminal,
	});
	const fullscreen = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: "/tmp",
		terminal,
	});
	const dialog = fullscreen.showOverlay(new Text("Existing dialog"));
	const show = vi.spyOn(fullscreen, "showOverlay");
	const colors = vi.spyOn(fullscreen, "queryTerminalColors");
	try {
		expect(playArmin3d(regular)).toBe(false);
		expect(playArmin3d(fullscreen)).toBe(true);
		expect(show).not.toHaveBeenCalled();
		expect(colors).not.toHaveBeenCalled();
		expect(fullscreen.hasOverlay()).toBe(true);
	} finally {
		dialog.hide();
		regular.stop();
		fullscreen.stop();
	}
});

it.each(["armin", "pi-logo"] as const)("opens and dismisses the fullscreen %s animation", async (kind) => {
	initTheme("dark");
	const terminal = new VirtualTerminal(80, 24);
	const fullscreen = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: "/tmp",
		terminal,
	});
	vi.spyOn(fullscreen, "queryTerminalColors").mockResolvedValue({});
	let animation: EasterEgg3dAnimation | undefined;
	const showOverlay = fullscreen.showOverlay.bind(fullscreen);
	vi.spyOn(fullscreen, "showOverlay").mockImplementation((component, options) => {
		if (component instanceof EasterEgg3dAnimation) animation = component;
		return showOverlay(component, options);
	});
	try {
		if (kind === "armin") expect(playArmin3d(fullscreen)).toBe(true);
		else playPiLogo3d(fullscreen, 1, 1);
		await vi.waitFor(() => expect(fullscreen.hasOverlay()).toBe(true));
		if (!animation) throw new Error("Missing fullscreen animation");
		animation.close();
		animation.close();
		expect(fullscreen.hasOverlay()).toBe(false);
	} finally {
		animation?.close();
		animation?.close();
		fullscreen.stop();
	}
});
