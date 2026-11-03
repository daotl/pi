import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { McpManagerView } from "../src/extensions/mcp/ui.ts";
import { AuthUrlComponent } from "../src/modes/interactive/components/auth-url.ts";
import { LoginDialogComponent } from "../src/modes/interactive/components/login-dialog.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn(async (_text: string) => {}) }));

vi.mock("../src/utils/clipboard.ts", () => ({ copyToClipboard }));
vi.mock("../src/utils/open-browser.ts", () => ({ openBrowser: vi.fn() }));

const URL = `https://auth.example.invalid/authorize?${"x".repeat(300)}`;
const CTRL_X = "\x18";

const tui = { requestRender: vi.fn() } as unknown as TUI;

function rendered(component: { render(width: number): string[] }): string {
	return stripAnsi(component.render(80).join("\n"));
}

describe("sign-in URL copy key", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
		copyToClipboard.mockClear();
	});

	test("login dialog copies the auth URL instead of typing into the code input", async () => {
		const dialog = new LoginDialogComponent(tui, "test", () => {});
		dialog.showAuth(URL);
		void dialog.showManualInput("Paste the code:");
		expect(rendered(dialog)).toContain("ctrl+x to copy");

		dialog.handleInput(CTRL_X);
		await vi.waitFor(() => expect(rendered(dialog)).toContain("Copied URL to clipboard"));
		expect(copyToClipboard).toHaveBeenCalledWith(URL);
	});

	test("login dialog ignores the copy key without an auth URL", () => {
		const dialog = new LoginDialogComponent(tui, "test", () => {});
		dialog.showDeviceCode({ userCode: "ABCD", verificationUri: "https://example.invalid/device" });
		dialog.handleInput(CTRL_X);
		expect(copyToClipboard).not.toHaveBeenCalled();
	});

	test("keeps the latest copy success when an older copy fails", async () => {
		let rejectFirst!: (error: Error) => void;
		let resolveSecond!: () => void;
		const firstCopy = new Promise<void>((_resolve, reject) => {
			rejectFirst = reject;
		});
		const secondCopy = new Promise<void>((resolve) => {
			resolveSecond = resolve;
		});
		copyToClipboard.mockImplementationOnce(() => firstCopy).mockImplementationOnce(() => secondCopy);
		const component = new AuthUrlComponent(tui, URL);

		const firstOperation = component.copy();
		const secondOperation = component.copy();
		resolveSecond();
		await secondOperation;
		expect(rendered(component)).toContain("Copied URL to clipboard");

		rejectFirst(new Error("first copy failed"));
		await firstOperation;
		expect(rendered(component)).toContain("Copied URL to clipboard");
		expect(rendered(component)).not.toContain("first copy failed");
	});

	test("keeps the latest copy failure when an older copy succeeds", async () => {
		const firstCopy = Promise.withResolvers<void>();
		const secondCopy = Promise.withResolvers<void>();
		copyToClipboard.mockImplementationOnce(() => firstCopy.promise).mockImplementationOnce(() => secondCopy.promise);
		const component = new AuthUrlComponent(tui, URL);
		const firstOperation = component.copy();
		const secondOperation = component.copy();
		try {
			secondCopy.reject(new Error("latest copy failed"));
			await secondOperation;
			expect(rendered(component)).toContain("latest copy failed");
			expect(rendered(component)).not.toContain("Copied URL to clipboard");

			firstCopy.resolve();
			await firstOperation;
			expect(rendered(component)).toContain("latest copy failed");
			expect(rendered(component)).not.toContain("Copied URL to clipboard");
		} finally {
			firstCopy.resolve();
			secondCopy.resolve();
			await Promise.allSettled([firstOperation, secondOperation]);
		}
	});

	test("MCP sign-in screen copies the authorization URL", async () => {
		const view = new McpManagerView(tui, theme, new KeybindingsManager());
		void view.redirectUrl("Sign in to issues", URL, new AbortController().signal);
		expect(rendered(view)).toContain("ctrl+x to copy");

		view.handleInput(CTRL_X);
		await vi.waitFor(() => expect(rendered(view)).toContain("Copied URL to clipboard"));
		expect(copyToClipboard).toHaveBeenCalledWith(URL);
	});
});
