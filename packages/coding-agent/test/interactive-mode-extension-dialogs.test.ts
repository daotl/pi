import { type Component, Container, type OverlayHandle, Text } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type DialogContext = {
	extensionDialogs: Component[];
	extensionCustomDialogs: Set<() => void>;
	isShuttingDown: boolean;
	editorContainer: Container;
	editor: Component & { getText(): string; setText(text: string): void };
	focused: Component | undefined;
	ui: {
		setFocus: (component: Component) => void;
		requestRender: () => void;
		showOverlay: ReturnType<typeof vi.fn>;
		hideOverlay: ReturnType<typeof vi.fn>;
	};
	programStatus: { setBlocked: ReturnType<typeof vi.fn> };
	disposeActiveSelector: () => void;
	toggleToolOutputExpansion: () => void;
};

type DialogMethods = {
	resetExtensionUI(): void;
	showExtensionConfirm(title: string, message: string, opts?: { signal?: AbortSignal }): Promise<boolean>;
	showExtensionCustom<T>(
		factory: (
			tui: unknown,
			theme: unknown,
			keybindings: unknown,
			done: (result: T) => void,
		) => Component | Promise<Component>,
		options?: { overlay?: boolean; onHandle?: (handle: OverlayHandle) => void },
	): Promise<T | undefined>;
};

function createContext(): DialogContext & DialogMethods {
	const prototype = InteractiveMode.prototype as unknown as Record<string, unknown>;
	let editorText = "";
	const editor = Object.assign(new Text("editor"), {
		getText: () => editorText,
		setText: (text: string) => {
			editorText = text;
		},
	});
	const context: DialogContext = {
		extensionDialogs: [],
		extensionCustomDialogs: new Set(),
		isShuttingDown: false,
		editorContainer: new Container(),
		editor,
		focused: undefined,
		ui: {
			setFocus: (component) => {
				context.focused = component;
			},
			requestRender: vi.fn(),
			showOverlay: vi.fn(() => ({ hide: vi.fn() })),
			hideOverlay: vi.fn(),
		},
		programStatus: { setBlocked: vi.fn() },
		disposeActiveSelector: vi.fn(),
		toggleToolOutputExpansion: vi.fn(),
	};
	Object.assign(context, {
		clearExtensionTerminalInputListeners: vi.fn(),
		setExtensionFooter: vi.fn(),
		setExtensionHeader: vi.fn(),
		clearExtensionWidgets: vi.fn(),
		footerDataProvider: { clearExtensionStatuses: vi.fn() },
		footer: { invalidate: vi.fn() },
		setCustomEditorComponent: vi.fn(),
		setupAutocompleteProvider: vi.fn(),
		defaultEditor: {},
		updateTerminalTitle: vi.fn(),
		setWorkingIndicator: vi.fn(),
		setHiddenThinkingLabel: vi.fn(),
	});
	return new Proxy(context, {
		get(target, key, receiver) {
			if (key in target) return Reflect.get(target, key, receiver);
			const value = prototype[key as string];
			return typeof value === "function" ? value.bind(receiver) : value;
		},
	}) as DialogContext & DialogMethods;
}

function visible(context: DialogContext): string {
	expect(context.editorContainer.children).toEqual([context.focused]);
	return (context.focused?.render(80) ?? []).join("\n");
}

describe("InteractiveMode extension dialogs", () => {
	beforeAll(() => initTheme("dark"));

	// Regression for #11166: a second dialog replaced the first one and the first promise never settled.
	it("shows the earlier confirm again after the later one is answered", async () => {
		const context = createContext();
		const first = context.showExtensionConfirm("First", "first dialog");
		const second = context.showExtensionConfirm("Second", "second dialog");

		expect(visible(context)).toContain("Second");
		expect(context.programStatus.setBlocked).toHaveBeenLastCalledWith("extension-dialog", {
			kind: "permission",
			message: "Second",
		});
		context.focused?.handleInput?.("\x1b");
		await expect(second).resolves.toBe(false);

		expect(visible(context)).toContain("First");
		expect(context.programStatus.setBlocked).toHaveBeenLastCalledWith("extension-dialog", {
			kind: "permission",
			message: "First",
		});
		context.focused?.handleInput?.("\r");
		await expect(first).resolves.toBe(true);
		expect(context.focused).toBe(context.editor);
		expect(context.programStatus.setBlocked).toHaveBeenLastCalledWith("extension-dialog", undefined);
	});

	it("removes a hidden dialog when its signal aborts", async () => {
		const context = createContext();
		const controller = new AbortController();
		const first = context.showExtensionConfirm("First", "first dialog", { signal: controller.signal });
		const second = context.showExtensionConfirm("Second", "second dialog");

		controller.abort();
		await expect(first).resolves.toBe(false);
		expect(visible(context)).toContain("Second");

		context.focused?.handleInput?.("\r");
		await expect(second).resolves.toBe(true);
		expect(context.focused).toBe(context.editor);
	});

	// Regression for #9909: a second inline custom component replaced the first one and the first promise never settled.
	it("stacks concurrent inline custom components", async () => {
		const context = createContext();
		const dones: Array<(result: string) => void> = [];
		const open = (label: string) =>
			context.showExtensionCustom<string>((_tui, _theme, _keybindings, done) => {
				dones.push(done);
				return new Text(label);
			});
		const first = open("custom one");
		const second = open("custom two");
		await vi.waitFor(() => expect(dones).toHaveLength(2));
		await vi.waitFor(() => expect(visible(context)).toContain("custom two"));

		dones[1]("two");
		await expect(second).resolves.toBe("two");
		expect(visible(context)).toContain("custom one");

		dones[0]("one");
		await expect(first).resolves.toBe("one");
		expect(context.focused).toBe(context.editor);
	});

	it("shows a confirm opened from an inline custom component and then restores the component", async () => {
		const context = createContext();
		let confirmed: Promise<boolean> | undefined;
		let done: ((result: string) => void) | undefined;
		const custom = context.showExtensionCustom<string>((_tui, _theme, _keybindings, finish) => {
			done = finish;
			return Object.assign(new Text("custom form"), {
				handleInput: () => {
					confirmed = context.showExtensionConfirm("Discard?", "discard changes");
				},
			});
		});
		await vi.waitFor(() => expect(visible(context)).toContain("custom form"));

		context.focused?.handleInput?.("x");
		expect(visible(context)).toContain("Discard?");
		context.focused?.handleInput?.("\x1b");
		await expect(confirmed).resolves.toBe(false);

		expect(visible(context)).toContain("custom form");
		done?.("kept");
		await expect(custom).resolves.toBe("kept");
		expect(context.focused).toBe(context.editor);
	});

	it("settles and disposes every custom dialog once when reset reenters done", async () => {
		const context = createContext();
		const disposals: string[] = [];
		const settlements: string[] = [];
		const open = (label: string) =>
			context
				.showExtensionCustom<string>((_ui, _theme, _keys, done) =>
					Object.assign(new Text(label), {
						dispose: () => {
							disposals.push(label);
							done(label);
						},
					}),
				)
				.then((result) => {
					settlements.push(label);
					return result;
				});
		const first = open("first");
		const second = open("second");
		await vi.waitFor(() => expect(visible(context)).toContain("second"));
		context.resetExtensionUI();
		expect(disposals).toEqual(["first", "second"]);
		await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
		expect(settlements).toEqual(["first", "second"]);
		expect(context.extensionDialogs).toEqual([]);
		expect(context.focused).toBe(context.editor);
	});

	it("cancels non-nullable object and nullable string consumers before they use their result", async () => {
		const context = createContext();
		const consumeObject = vi.fn();
		const consumeString = vi.fn();
		const object = context
			.showExtensionCustom<{ cancelled: boolean; answer: string }>(() => new Text("object"))
			.then((result) => {
				if (result === undefined || result.cancelled) return "cancelled";
				consumeObject(result.answer);
				return "answered";
			});
		const string = context
			.showExtensionCustom<string | null>(() => new Text("string"))
			.then((result) => {
				if (result === undefined || result === null) return "cancelled";
				consumeString(result);
				return "answered";
			});
		await vi.waitFor(() => expect(visible(context)).toContain("string"));
		context.resetExtensionUI();
		await expect(Promise.all([object, string])).resolves.toEqual(["cancelled", "cancelled"]);
		expect(consumeObject).not.toHaveBeenCalled();
		expect(consumeString).not.toHaveBeenCalled();
	});

	it.each([false, true])(
		"disposes a late custom factory without mounting after reset (overlay: %s)",
		async (overlay) => {
			const context = createContext();
			let finishFactory: (component: Component) => void = () => {
				throw new Error("factory not started");
			};
			const dispose = vi.fn();
			const result = context.showExtensionCustom<string>(
				() =>
					new Promise<Component>((resolve) => {
						finishFactory = resolve;
					}),
				{ overlay },
			);
			context.resetExtensionUI();
			await expect(result).resolves.toBeUndefined();
			finishFactory(Object.assign(new Text("late"), { dispose }));
			await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
			expect(context.extensionDialogs).toEqual([]);
			expect(context.ui.showOverlay).not.toHaveBeenCalled();
		},
	);

	it.each([false, true])("does not start a custom factory during shutdown (overlay: %s)", async (overlay) => {
		const context = createContext();
		context.isShuttingDown = true;
		const factory = vi.fn(() => new Text("must not mount"));
		await expect(context.showExtensionCustom<string>(factory, { overlay })).resolves.toBeUndefined();
		expect(factory).not.toHaveBeenCalled();
		expect(context.ui.showOverlay).not.toHaveBeenCalled();
	});

	it("settles and disposes a mounted overlay when extension UI resets", async () => {
		const context = createContext();
		const dispose = vi.fn();
		const result = context.showExtensionCustom<{ answer: string }>(
			() => Object.assign(new Text("overlay"), { dispose }),
			{ overlay: true },
		);
		await vi.waitFor(() => expect(context.ui.showOverlay).toHaveBeenCalledTimes(1));
		context.resetExtensionUI();
		await expect(result).resolves.toBeUndefined();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(context.extensionCustomDialogs.size).toBe(0);
	});

	it.each([false, true])("cancels a factory that resolves after shutdown starts (overlay: %s)", async (overlay) => {
		const context = createContext();
		let finishFactory: (component: Component) => void = () => {
			throw new Error("factory not started");
		};
		const dispose = vi.fn();
		const result = context.showExtensionCustom<string>(
			() =>
				new Promise<Component>((resolve) => {
					finishFactory = resolve;
				}),
			{ overlay },
		);
		context.isShuttingDown = true;
		finishFactory(Object.assign(new Text("late shutdown"), { dispose }));
		await expect(result).resolves.toBeUndefined();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(context.extensionDialogs).toEqual([]);
		expect(context.ui.showOverlay).not.toHaveBeenCalled();
	});

	it("rejects and releases its mounted overlay when onHandle throws", async () => {
		const context = createContext();
		const hide = vi.fn();
		context.ui.showOverlay.mockReturnValue({ hide });
		const failure = new Error("onHandle failed");
		let done: (result: string) => void = () => {
			throw new Error("factory not started");
		};
		const dispose = vi.fn(() => done("dispose reentry"));
		const result = context.showExtensionCustom<string>(
			(_tui, _theme, _keys, finish) => {
				done = finish;
				return Object.assign(new Text("failed overlay"), { dispose });
			},
			{
				overlay: true,
				onHandle: () => {
					throw failure;
				},
			},
		);
		await expect(result).rejects.toBe(failure);
		expect(hide).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(context.extensionCustomDialogs.size).toBe(0);
		done("late completion");
		context.resetExtensionUI();
		expect(hide).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
