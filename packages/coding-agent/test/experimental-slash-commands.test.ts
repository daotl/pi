import {
	createHost,
	defineFacet,
	type Facet,
	hostNamed,
	local,
	memoryLinkPair,
	method,
	remote,
} from "@earendil-works/chord";
import { Type } from "typebox";
import { describe, expect, test, vi } from "vitest";
import { SlashCommands } from "../src/experimental/services/slash-commands.ts";
import {
	createSlashCommandsRuntimeFacet,
	SlashCommandRegistry,
} from "../src/experimental/services/slash-commands-provider.ts";

describe("experimental slash command facets", () => {
	test("registers and removes contributions", () => {
		const registry = new SlashCommandRegistry();
		const snapshots: string[][] = [];
		const unsubscribe = registry.subscribe((commands) => snapshots.push(commands.map(({ name }) => name)));
		const close = registry.register({ name: "hello", description: "Hello", run: () => undefined });
		expect(registry.list().map(({ name }) => name)).toEqual(["hello"]);
		expect(() => registry.register({ name: "hello", run: () => undefined })).toThrow("already registered");
		close();
		close();
		expect(registry.list()).toEqual([]);
		expect(snapshots).toEqual([[], ["hello"], []]);
		unsubscribe();
	});

	test("stages replacements until the previous registration retires", () => {
		const registry = new SlashCommandRegistry();
		const first = { name: "hello", description: "First", run: () => undefined };
		const second = { name: "hello", description: "Second", run: () => undefined };
		const closeFirst = registry.register(first);
		const closeSecond = registry.replace(second);
		expect(registry.list()).toEqual([first]);
		closeSecond();
		expect(registry.list()).toEqual([first]);
		const closeReplacement = registry.replace(second);
		closeFirst();
		expect(registry.list()).toEqual([second]);
		closeReplacement();
		expect(registry.list()).toEqual([]);
	});

	test("tracks plugin facet reload, failed candidates and unload", async () => {
		const registry = new SlashCommandRegistry();
		const publications: string[][] = [];
		const unsubscribe = registry.subscribe((commands) => {
			publications.push(commands.map(({ description, name }) => description ?? name));
		});
		const lifecycle: string[] = [];
		const Plugin = local("test.slash-command-plugin", { version: 1, input: Type.Object({}) });
		const originalRun = vi.fn(() => undefined);
		const plugin = (description: string, run: () => undefined, failure?: Error): Facet => ({
			name: "@test/example-hello",
			...defineFacet(({ serve }) => {
				serve(
					Plugin,
					(_input, _principal, self) => {
						const commands = self.get(SlashCommands, {});
						self.resource("command", {
							version: description === "Original" ? 1 : description === "Failing" ? 2 : 3,
							deps: [commands],
							open() {
								const close = commands.registry!.replace({ name: "hello", description, run });
								lifecycle.push(`open ${description}`);
								if (failure !== undefined) {
									close();
									lifecycle.push(`discard ${description}`);
									throw failure;
								}
								return close;
							},
							close: (unregister) => {
								lifecycle.push(`close ${description}`);
								unregister();
							},
						});
						return {};
					},
					{ lifetime: "host" },
				);
			}),
		});
		const host = createHost({ name: "presentation", self: "presentation" });
		try {
			await host.load([createSlashCommandsRuntimeFacet(registry), plugin("Original", originalRun)]);
			expect(registry.list().map(({ name }) => name)).toEqual(["hello"]);
			const failure = new Error("replacement failed");
			await expect(host.reload([plugin("Failing", () => undefined, failure)])).rejects.toThrow("replacement failed");
			expect(registry.list()).toEqual([expect.objectContaining({ name: "hello", run: originalRun })]);
			expect(publications).toEqual([[], ["Original"]]);
			expect(lifecycle).toEqual(["open Original", "open Failing", "discard Failing"]);
			const replacementRun = vi.fn(() => undefined);
			await host.reload([plugin("Replacement", replacementRun)]);
			expect(registry.list()).toEqual([
				expect.objectContaining({ name: "hello", description: "Replacement", run: replacementRun }),
			]);
			expect(publications).toEqual([[], ["Original"], ["Replacement"]]);
			// Removing a facet publishes synchronously, but native object disposal waits for its invocations and tasks.
			// Await the resource's actual unregister notification; the test deadline bounds missing cleanup.
			const removed = Promise.withResolvers<void>();
			const stopWaiting = registry.subscribe((commands) => {
				if (commands.length === 0) removed.resolve();
			});
			try {
				await Promise.all([host.reload([], { remove: ["@test/example-hello"] }), removed.promise]);
			} finally {
				stopWaiting();
			}
			expect(registry.list()).toEqual([]);
			expect(publications).toEqual([[], ["Original"], ["Replacement"], []]);
			expect(lifecycle).toEqual([
				"open Original",
				"open Failing",
				"discard Failing",
				"open Replacement",
				"close Original",
				"close Replacement",
			]);
		} finally {
			unsubscribe();
			await host.close();
		}
	}, 5_000);

	test("presentation plugin reload stays local when remote contracts use routed native links", async () => {
		const Greeting = remote("test.routed-presentation-greeting", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("session"),
			variants: { active: { methods: { read: method(undefined, Type.String()) } } },
		});
		const provider = createHost({ name: "session", self: "session" });
		const presentation = createHost({ name: "presentation", kind: "client", self: "presentation" });
		provider.serve(Greeting, () => ({ variant: "active", read: () => "hello" }));
		const [down, up] = memoryLinkPair();
		provider.accept(down, { principal: "presentation", kind: "client" });
		presentation.route("session", { authorize: () => true, principal: () => "session", resolve: async () => up });
		try {
			const greeting = await presentation.get(Greeting, {});
			expect(await presentation.root((context) => greeting.read(context))).toBe("hello");
			await presentation.reload([{ name: "test.presentation-plugin", ...defineFacet(() => {}) }], {
				voteDeadline: 100,
			});
			expect(provider.codeVersion).toBe(1);
			expect(await presentation.root((context) => greeting.read(context))).toBe("hello");
			greeting.release();
		} finally {
			await presentation.close();
			await provider.close();
		}
	});
});
