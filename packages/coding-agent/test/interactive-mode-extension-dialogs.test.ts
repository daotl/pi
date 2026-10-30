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
	shutdown(options?: { fromSignal?: boolean }): Promise<void>;
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
		scheduledDeliveryGeneration: 0,
		scheduledPreflights: new Set<AbortController>(),
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

	it.each([false, true])("cancels dialog-dependent work before shutdown waits (signal: %s)", async (fromSignal) => {
		const context = createContext();
		const confirm = context.showExtensionConfirm("Permission", "waiting tool hook");
		const custom = context.showExtensionCustom<string>(() => new Text("waiting custom tool"));
		await Promise.resolve();
		const failure = new Error("persistence unavailable");
		const settleRun = vi.fn(async () => {
			await expect(confirm).resolves.toBe(false);
			await expect(custom).resolves.toBeUndefined();
			throw failure;
		});
		const clearWidgets = vi.fn();
		Object.assign(context, {
			session: { abort: settleRun },
			runtimeHost: { dispose: settleRun },
			showError: vi.fn(),
			flushCompactionQueue: async () => {},
			fireDueScheduledMessages: vi.fn(),
			tickHeartbeats: vi.fn(),
			clearExtensionWidgets: clearWidgets,
		});
		try {
			await context.shutdown({ fromSignal });
			expect(settleRun).toHaveBeenCalledTimes(1);
			expect(clearWidgets).not.toHaveBeenCalled();
			expect(context.focused).toBe(context.editor);
		} finally {
			context.resetExtensionUI();
		}
	});

	it("keeps interaction order when two custom factories resolve in reverse order", async () => {
		const context = createContext();
		const firstFactory = Promise.withResolvers<Component>();
		const secondFactory = Promise.withResolvers<Component>();
		let firstDone: ((result: string) => void) | undefined;
		let secondDone: ((result: string) => void) | undefined;
		const first = context.showExtensionCustom<string>((_ui, _theme, _keys, done) => {
			firstDone = done;
			return firstFactory.promise;
		});
		const second = context.showExtensionCustom<string>((_ui, _theme, _keys, done) => {
			secondDone = done;
			return secondFactory.promise;
		});
		secondFactory.resolve(new Text("newer interaction"));
		await Promise.resolve();
		expect(visible(context)).toContain("newer interaction");
		firstFactory.resolve(new Text("older interaction"));
		await Promise.resolve();
		expect(visible(context)).toContain("newer interaction");
		secondDone?.("second");
		await expect(second).resolves.toBe("second");
		expect(visible(context)).toContain("older interaction");
		firstDone?.("first");
		await expect(first).resolves.toBe("first");
	});

	it.each(["reset", "reject"] as const)("preserves edits while an unmounted factory is %s", async (action) => {
		const context = createContext();
		context.editor.setText("original draft");
		const factory = Promise.withResolvers<Component>();
		const result = context.showExtensionCustom(() => factory.promise);
		context.editor.setText("draft typed during loading");
		if (action === "reset") {
			context.resetExtensionUI();
			await expect(result).resolves.toBeUndefined();
			factory.resolve(new Text("late"));
		} else {
			const failure = new Error("factory failed");
			factory.reject(failure);
			await expect(result).rejects.toBe(failure);
		}
		expect(context.editor.getText()).toBe("draft typed during loading");
	});

	it("keeps a newer confirmation above an older factory and captures the draft at actual mount", async () => {
		const context = createContext();
		context.editor.setText("initial draft");
		const factory = Promise.withResolvers<Component>();
		let done: ((result: string) => void) | undefined;
		const custom = context.showExtensionCustom<string>((_ui, _theme, _keys, finish) => {
			done = finish;
			return factory.promise;
		});
		context.editor.setText("new draft");
		const confirm = context.showExtensionConfirm("Newer", "answer first");
		factory.resolve(new Text("older custom"));
		await Promise.resolve();
		expect(visible(context)).toContain("Newer");
		context.focused?.handleInput?.("\r");
		await expect(confirm).resolves.toBe(true);
		expect(visible(context)).toContain("older custom");
		context.editor.setText("custom editor change");
		done?.("finished");
		await expect(custom).resolves.toBe("finished");
		expect(context.editor.getText()).toBe("new draft");
	});

	it("reserves a custom slot before its factory opens a confirmation", async () => {
		const context = createContext();
		let confirm: Promise<boolean> | undefined;
		let done: ((result: string) => void) | undefined;
		const custom = context.showExtensionCustom<string>((_ui, _theme, _keys, finish) => {
			done = finish;
			confirm = context.showExtensionConfirm("Factory confirmation", "answer first");
			return new Text("custom under confirmation");
		});
		await Promise.resolve();
		expect(visible(context)).toContain("Factory confirmation");
		context.focused?.handleInput?.("\x1b");
		await expect(confirm).resolves.toBe(false);
		expect(visible(context)).toContain("custom under confirmation");
		done?.("finished");
		await expect(custom).resolves.toBe("finished");
	});

	it("does not restore a hidden custom draft over its newer editor owner", async () => {
		const context = createContext();
		context.editor.setText("draft");
		let closeOlder: ((result: string) => void) | undefined;
		let closeNewer: ((result: string) => void) | undefined;
		const older = context.showExtensionCustom<string>((_ui, _theme, _keys, done) => {
			closeOlder = done;
			return new Text("older");
		});
		await Promise.resolve();
		const newer = context.showExtensionCustom<string>((_ui, _theme, _keys, done) => {
			closeNewer = done;
			return new Text("newer");
		});
		await Promise.resolve();
		context.editor.setText("newer owns this edit");
		closeOlder?.("closed hidden");
		await expect(older).resolves.toBe("closed hidden");
		expect(context.editor.getText()).toBe("newer owns this edit");
		expect(visible(context)).toContain("newer");
		closeNewer?.("closed visible");
		await expect(newer).resolves.toBe("closed visible");
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
