import { resolve } from "node:path";
import { ChordError, type Ctx, defineFacet, type Host, type JsonValue, local } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	CombinedAutocompleteProvider,
	type Component,
	Container,
	type SelectItem,
	SelectList,
	setKeybindings,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ClientCommand } from "../cli/experimental/commands/client.ts";
import { getAgentDir } from "../config.ts";
import { KeybindingsManager } from "../core/keybindings.ts";
import { DefaultResourceLoader } from "../core/resource-loader.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { createChatViewport } from "../modes/interactive/chat-viewport.ts";
import { CustomEditor } from "../modes/interactive/components/custom-editor.ts";
import { getEditorTheme, setRegisteredThemes, stopThemeWatcher, theme } from "../modes/interactive/theme/theme.ts";
import { InteractiveThemeController } from "../modes/interactive/theme/theme-controller.ts";
import { createInteractiveTui } from "../modes/interactive/tui-renderer.ts";
import { type OpenClientRuntimeOptions, openClientRuntime } from "./client-runtime.ts";
import { ExperimentalChatView } from "./client-tui-chat.ts";
import { type LoadedPluginFacets, loadPresentationFacets } from "./plugins/bundled.ts";
import { AgentController, type AgentOperationResponse, type AgentQueueResponse } from "./services/agent-controller.ts";
import type {
	ServerConnectionState,
	ServerServiceSource,
	SessionAttachmentState,
	SessionServiceSource,
} from "./services/connection.ts";
import { PresentationPlugins } from "./services/plugins.ts";
import { PresentationUI } from "./services/presentation-ui.ts";
import { SessionDirectory, SessionManagement, type SessionSummary } from "./services/sessions.ts";
import { SlashCommands } from "./services/slash-commands.ts";
import {
	createBuiltInSlashCommandsFacet,
	createSlashCommandsRuntimeFacet,
} from "./services/slash-commands-provider.ts";
import { Transcript, type Transcript as TranscriptService } from "./services/transcript.ts";

export interface RunClientTuiOptions extends OpenClientRuntimeOptions {
	readonly facetLoader?: () => Promise<LoadedPluginFacets>;
}

export interface ClientTuiServer {
	readonly serverId: string;
	readonly radius: boolean;
	readonly server: ServerServiceSource;
	readonly session: SessionServiceSource;
}

interface SessionFeature {
	readonly serverId: string;
	readonly session: SessionServiceSource;
	readonly transcript: TranscriptService;
}

interface PreparedClientSession {
	readonly server: ClientTuiServer;
	readonly summary: SessionSummary;
	readonly presentationPlugins: JsonValue;
}

interface PendingSelection {
	readonly title: string;
	readonly items: readonly SelectItem[];
	readonly selectedValue?: string;
	resolve(value: string | undefined): void;
}

const selectTheme = {
	selectedPrefix: (text: string) => theme.fg("accent", text),
	selectedText: (text: string) => theme.fg("accent", text),
	description: (text: string) => theme.fg("muted", text),
	scrollInfo: (text: string) => theme.fg("dim", text),
	noMatch: (text: string) => theme.fg("warning", text),
};

/** Service-only presentation driven by a replicated main-lane snapshot. */
export class ExperimentalClientTui implements Component {
	readonly #ui: TUI;
	readonly #requestRender: () => void;
	readonly #finish: () => void;
	readonly #documentContainer = new Container();
	readonly #sessionHeading = new Text("", 1, 0);
	readonly #pendingMessagesContainer = new Container();
	readonly #statusContainer = new Container();
	readonly #editorContainer = new Container();
	readonly #footerComponent = new Text("", 1, 0);
	readonly #layoutRoot: Component;
	readonly #sharedFacets: LoadedPluginFacets;
	readonly #keybindings = KeybindingsManager.create();
	#presentationFacets: LoadedPluginFacets | undefined;
	#facetHost: Host | undefined;
	#facetReloadTail = Promise.resolve();
	#rebindPresentation: ((generation: number) => Promise<void>) | undefined;
	readonly #statusUnsubscribes: (() => void)[] = [];
	#session: SessionFeature | undefined;
	#slashCommands: SlashCommands | undefined;
	#controller: AgentController | undefined;
	readonly #chatInput: CustomEditor;
	#selectList: SelectList | undefined;
	#selection: PendingSelection | undefined;
	#screen: "select" | "chat" = "chat";
	#selectedServerId: string | undefined;
	#sessionId: string | undefined;
	#status = "Starting Session…";
	#busy = false;
	#closed = false;
	#closePromise: Promise<void> | undefined;
	#recoveryTransition: Promise<void> = Promise.resolve();
	#attachmentGeneration = 0;
	#laneUnsubscribe: (() => void) | undefined;
	#chatView: ExperimentalChatView | undefined;

	private constructor(ui: TUI, requestRender: () => void, finish: () => void, loadedFacets: LoadedPluginFacets) {
		this.#ui = ui;
		this.#requestRender = requestRender;
		this.#finish = finish;
		this.#sharedFacets = loadedFacets;
		setKeybindings(this.#keybindings);
		this.#chatInput = new CustomEditor(ui, getEditorTheme(), this.#keybindings, { paddingX: 1 });
		this.#chatInput.onSubmit = (message) => void this.#runPrompt(message);
		this.#chatInput.onEscape = () => this.#interrupt();
		this.#chatInput.onCtrlD = finish;
		this.#chatInput.onAction("app.clear", finish);
		this.#chatInput.onAction("app.model.select", () => void this.#executeSlashCommand("model", ""));
		this.#chatInput.onAction("app.message.followUp", () => {
			const text = this.#chatInput.getText().trim();
			if (text.length === 0) return;
			this.#chatInput.setText("");
			void this.#queueFollowUp(text);
		});
		this.#editorContainer.addChild(this.#chatInput);
		this.#layoutRoot = createChatViewport({
			document: this.#documentContainer,
			pendingMessages: this.#pendingMessagesContainer,
			status: this.#statusContainer,
			editor: this.#editorContainer,
			footer: this.#footerComponent,
			scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
			scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
		}).root;
		this.#rebuild();
	}

	static async create(options: {
		readonly command: ClientCommand;
		readonly ui: TUI;
		readonly servers: readonly ClientTuiServer[];
		readonly facetLoader?: () => Promise<LoadedPluginFacets>;
		requestRender(): void;
		finish(): void;
	}): Promise<ExperimentalClientTui> {
		const prepared = await prepareClientSession(options.command, options.servers);
		const loadedFacets = await (options.facetLoader?.() ?? Promise.resolve({ facets: [], async dispose() {} }));
		const component = new ExperimentalClientTui(options.ui, options.requestRender, options.finish, loadedFacets);
		try {
			await component.#start(prepared);
			await component.#openPreparedSession(prepared);
			return component;
		} catch (error) {
			try {
				await component.close();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "Experimental TUI startup and cleanup failed");
			}
			throw error;
		}
	}

	get layoutRoot(): Component {
		return this.#layoutRoot;
	}

	render(width: number): string[] {
		return [
			...this.#documentContainer.render(width),
			...this.#pendingMessagesContainer.render(width),
			...this.#statusContainer.render(width),
			...this.#editorContainer.render(width),
			...this.#footerComponent.render(width),
		];
	}

	handleInput(data: string): void {
		if (this.#busy) {
			if (
				this.#keybindings.matches(data, "app.clear") ||
				(this.#chatInput.getText().length === 0 && this.#keybindings.matches(data, "app.exit"))
			) {
				this.#finish();
			}
			return;
		}
		if (this.#screen === "chat") {
			this.#chatInput.handleInput(data);
			this.#requestRender();
			return;
		}
		this.#selectList?.handleInput(data);
	}

	invalidate(): void {
		this.#layoutRoot.invalidate();
	}

	dispose(): void {
		void this.close().catch(() => {});
	}

	refreshTheme(): void {
		const snapshot = this.#laneSnapshot();
		if (snapshot !== undefined) this.#chatView?.refreshTheme(snapshot);
		this.#rebuild();
	}

	showError(error: string): void {
		this.#status = `Error: ${error}`;
		this.#rebuild();
	}

	close(): Promise<void> {
		this.#closePromise ??= this.#close();
		return this.#closePromise;
	}

	async #start(prepared: PreparedClientSession): Promise<void> {
		const server = prepared.server;
		let presentationFacets = await loadPresentationFacets(prepared.presentationPlugins);
		this.#presentationFacets = presentationFacets;
		const facetHost = server.server.host;
		this.#facetHost = facetHost;
		const reloadPresentationPlugins = (data: JsonValue): Promise<void> => {
			const operation = this.#facetReloadTail.then(async () => {
				const candidate = await loadPresentationFacets(data);
				try {
					await facetHost.reload(candidate.facets, {
						remove: presentationFacets.facets
							.filter((old) => !candidate.facets.some((next) => next.name === old.name))
							.map((facet) => facet.name),
					});
				} catch (error) {
					try {
						await candidate.dispose();
					} catch (cleanupError) {
						throw new AggregateError([error, cleanupError], "TUI plugin reload and cleanup failed");
					}
					throw error;
				}
				const retired = presentationFacets;
				presentationFacets = candidate;
				this.#presentationFacets = candidate;
				await retired.dispose();
			});
			this.#facetReloadTail = operation.catch(() => {});
			return operation;
		};
		const Bridge = local("pi.local.presentation-bridge", { version: 1, input: Type.Object({}) });
		const presentationBridgeFacet = {
			name: "@pi/presentation-bridge",
			...defineFacet(({ serve }) => {
				serve(
					PresentationUI,
					() => ({
						ui: {
							select: (
								title: string,
								items: readonly { value: string; label: string; description?: string }[],
								selectedValue: string | undefined,
								context: Ctx,
							) => this.#select(title, items, selectedValue, context),
							showStatus: (status: string) => {
								this.#status = status;
								this.#rebuild();
							},
						},
					}),
					{ lifetime: "host" },
				);
				serve(
					Bridge,
					(_input, _principal, self) => {
						const commands = self.get(SlashCommands, {});
						const controller = self.get(AgentController, {});
						const transcript = self.get(Transcript, {});
						self.resource("presentation", {
							version: 1,
							deps: [commands, controller, transcript],
							open: () => {
								if (this.#closed) throw new ChordError("gone", "Experimental TUI is closed");
								const registry = commands.registry!;
								const feature: SessionFeature = {
									serverId: server.serverId,
									session: server.session,
									transcript,
								};
								this.#session = feature;
								this.#slashCommands = registry;
								this.#controller = controller;
								const cleanup = [registry.subscribe(() => this.#updateAutocomplete())];
								return { feature, registry, cleanup };
							},
							close: ({ feature, registry, cleanup }) => {
								for (const close of cleanup.reverse()) close();
								if (this.#session === feature) this.#session = undefined;
								if (this.#slashCommands === registry) this.#slashCommands = undefined;
								if (this.#controller === controller) this.#controller = undefined;
							},
						});
						return {};
					},
					{ lifetime: "host" },
				);
			}),
		};
		const facets = () => [
			createSlashCommandsRuntimeFacet(),
			presentationBridgeFacet,
			createBuiltInSlashCommandsFacet({ reloadPresentationPlugins }),
			...this.#sharedFacets.facets,
			...presentationFacets.facets,
		];
		this.#rebindPresentation = async (generation) => {
			await this.#facetReloadTail;
			if (!this.#isCurrentAttachment(server, generation)) return;
			await facetHost.reload([], { remove: facets().map((facet) => facet.name) });
			if (!this.#isCurrentAttachment(server, generation)) return;
			await facetHost.load(facets());
		};
		await facetHost.load(facets());
		if (server.radius) {
			this.#statusUnsubscribes.push(
				server.server.connection.subscribe((state) => this.#handleConnectionState(server.serverId, state)),
			);
			this.#statusUnsubscribes.push(
				server.session.attachment.subscribe((state) => this.#handleAttachmentState(server, state)),
			);
		}
	}

	async #openPreparedSession(prepared: PreparedClientSession): Promise<void> {
		const feature = this.#session;
		if (feature === undefined) throw new Error(`No Session service is available for ${prepared.server.serverId}`);
		await feature.session.whenAttached(prepared.summary.sessionId, BACKGROUND_CONTEXT);
		this.#selectedServerId = feature.serverId;
		this.#sessionId = prepared.summary.sessionId;
		this.#updateAutocomplete();
		await this.#openLane(feature);
		this.#screen = "chat";
		this.#status = "";
		this.#rebuild();
	}

	async #close(): Promise<void> {
		this.#closed = true;
		this.#completeSelection(undefined);
		const errors: unknown[] = [];
		for (const unsubscribe of this.#statusUnsubscribes.splice(0)) unsubscribe();
		// Host shutdown cancels activation that an in-flight presentation rebind may be awaiting.
		const hostClose = this.#facetHost?.close();
		const transitions = await Promise.allSettled([
			hostClose,
			this.#recoveryTransition,
			this.#closeLane(),
			this.#facetReloadTail,
		]);
		errors.push(...transitions.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])));
		this.#facetHost = undefined;
		const generations = [this.#presentationFacets, this.#sharedFacets].filter(
			(generation): generation is LoadedPluginFacets => generation !== undefined,
		);
		this.#presentationFacets = undefined;
		const results = await Promise.allSettled(generations.map((generation) => generation.dispose()));
		errors.push(...results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])));
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, "Failed to dispose experimental TUI facets");
	}

	#rebuild(): void {
		this.#sessionHeading.setText(
			this.#sessionId === undefined || this.#selectedServerId === undefined
				? ""
				: theme.fg("dim", `Server: ${this.#selectedServerId}\nSession: ${this.#sessionId}`),
		);
		this.#statusContainer.clear();
		if (this.#status.length > 0) {
			this.#statusContainer.addChild(new Text(theme.fg("dim", this.#status), 1, 0));
		}
		if (this.#chatView !== undefined) this.#statusContainer.addChild(this.#chatView.status);
		this.#footerComponent.setText(theme.fg("dim", this.#footer()));
		this.#editorContainer.clear();
		if (this.#screen === "select" && this.#selection !== undefined) {
			this.#chatInput.focused = false;
			const selector = new Container();
			selector.addChild(new Text(theme.bold(this.#selection.title), 1, 1));
			const items = [...this.#selection.items];
			this.#selectList = new SelectList(items, Math.min(Math.max(items.length, 1), 12), selectTheme);
			const selectedIndex = items.findIndex((item) => item.value === this.#selection?.selectedValue);
			if (selectedIndex >= 0) this.#selectList.setSelectedIndex(selectedIndex);
			const selection = this.#selection;
			this.#selectList.onSelect = (item) => this.#completeSelection(item.value, selection);
			this.#selectList.onCancel = () => this.#completeSelection(undefined, selection);
			selector.addChild(this.#selectList);
			this.#editorContainer.addChild(selector);
		} else {
			this.#selectList = undefined;
			this.#chatInput.focused = !this.#busy;
			this.#editorContainer.addChild(this.#chatInput);
		}
		this.#layoutRoot.invalidate();
		this.#requestRender();
	}

	#select(
		title: string,
		items: readonly SelectItem[],
		selectedValue: string | undefined,
		context: Ctx,
	): Promise<string | undefined> {
		if (context.signal.aborted) return Promise.resolve(undefined);
		if (this.#selection !== undefined) throw new Error("A slash command selector is already active");
		const { promise, resolve } = Promise.withResolvers<string | undefined>();
		const selection: PendingSelection = {
			title,
			items,
			...(selectedValue === undefined ? {} : { selectedValue }),
			resolve(value) {
				context.signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
		};
		const onAbort = () => this.#completeSelection(undefined, selection);
		this.#selection = selection;
		context.signal.addEventListener("abort", onAbort, { once: true });
		this.#screen = "select";
		this.#rebuild();
		return promise;
	}

	#completeSelection(value: string | undefined, selection = this.#selection, redraw = true): void {
		if (selection === undefined || this.#selection !== selection) return;
		this.#selection = undefined;
		this.#screen = "chat";
		selection.resolve(value);
		if (redraw && !this.#closed) this.#rebuild();
	}

	#updateAutocomplete(): void {
		const commands = this.#selectedSlashCommands()?.list() ?? [];
		this.#chatInput.setAutocompleteProvider(
			new CombinedAutocompleteProvider(
				commands.map((command) => ({
					name: command.name,
					description: command.description,
					...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
					...(command.getArgumentCompletions === undefined
						? {}
						: {
								getArgumentCompletions: async (prefix: string) => {
									const items = await command.getArgumentCompletions!(prefix);
									return items === null ? null : [...items];
								},
							}),
				})),
				process.cwd(),
			),
		);
		this.#requestRender();
	}

	#selectedSlashCommands(): SlashCommands | undefined {
		return this.#slashCommands;
	}

	#handleConnectionState(serverId: string, state: ServerConnectionState): void {
		if (this.#closed || this.#selectedServerId !== serverId) return;
		if (state.status === "connected") {
			if (this.#laneUnsubscribe === undefined) {
				this.#busy = true;
				this.#status = "Reattaching Session…";
				this.#rebuild();
			}
			return;
		}
		this.#attachmentGeneration++;
		this.#completeSelection(undefined, this.#selection, false);
		// The Client ends remote references before notifying connection listeners.
		// Drop the stale consumer view before any footer or autocomplete redraw.
		this.#session = undefined;
		this.#controller = undefined;
		this.#slashCommands = undefined;
		this.#busy = true;
		this.#status = state.status === "connecting" ? "Reconnecting to Radius…" : "Radius disconnected; retrying…";
		this.#queueRecovery(() => this.#closeLane());
		this.#rebuild();
	}

	#handleAttachmentState(server: ClientTuiServer, state: SessionAttachmentState): void {
		if (this.#closed || this.#selectedServerId !== server.serverId || this.#sessionId === undefined) return;
		const generation = ++this.#attachmentGeneration;
		this.#completeSelection(undefined, this.#selection, false);
		if (state.status === "attached" && state.sessionId === this.#sessionId) {
			this.#busy = true;
			this.#status = "Reattaching Session…";
			this.#rebuild();
			this.#queueRecovery(async () => {
				if (!this.#isCurrentAttachment(server, generation)) return;
				if (this.#laneUnsubscribe === undefined) {
					await this.#rebindPresentation?.(generation);
					if (!this.#isCurrentAttachment(server, generation)) return;
					const active = this.#session;
					if (active === undefined) throw new Error("Session presentation did not reactivate");
					await this.#openLane(active, generation);
					if (!this.#isCurrentAttachment(server, generation)) return;
				}
				this.#busy = false;
				this.#status = "";
				this.#rebuild();
			});
			return;
		}
		this.#session = undefined;
		this.#controller = undefined;
		this.#slashCommands = undefined;
		this.#busy = true;
		this.#status =
			state.status !== "detached" && state.sessionId === this.#sessionId
				? "Reattaching Session…"
				: "Session detached; waiting for the selected Session…";
		this.#queueRecovery(() => this.#closeLane());
		this.#rebuild();
	}

	#isCurrentAttachment(server: ClientTuiServer, generation: number): boolean {
		const attachment = server.session.attachment.value;
		return (
			!this.#closed &&
			generation === this.#attachmentGeneration &&
			this.#selectedServerId === server.serverId &&
			attachment?.status === "attached" &&
			attachment.sessionId === this.#sessionId
		);
	}

	#queueRecovery(operation: () => Promise<void>): void {
		const transition = this.#recoveryTransition
			.catch(() => {})
			.then(async () => {
				if (this.#closed) return;
				try {
					await operation();
				} catch (error) {
					if (this.#closed && error instanceof ChordError && (error.code === "gone" || error.code === "aborted"))
						return;
					throw error;
				}
			});
		this.#recoveryTransition = transition;
		void transition.catch((error: unknown) => {
			if (this.#closed) return;
			this.#busy = true;
			this.#status = `Reconnect error: ${message(error)}`;
			this.#rebuild();
		});
	}

	async #openLane(feature: SessionFeature, generation?: number): Promise<void> {
		await this.#closeLane();
		if (this.#closed || (generation !== undefined && generation !== this.#attachmentGeneration)) return;
		const view = new ExperimentalChatView(this.#ui, process.cwd());
		this.#chatView = view;
		this.#documentContainer.addChild(this.#sessionHeading);
		this.#documentContainer.addChild(view.transcript);
		this.#pendingMessagesContainer.addChild(view.pendingMessages);
		this.#laneUnsubscribe = feature.transcript.state.subscribe((value) => {
			if (this.#closed || this.#session !== feature) return;
			if (value.snapshot === null) return;
			view.apply(value.snapshot);
			this.#rebuild();
		});
		if (feature.transcript.state.value?.snapshot === null || feature.transcript.state.value?.snapshot === undefined) {
			await this.#closeLane();
			throw new Error("Transcript has no initialized snapshot");
		}
	}

	async #closeLane(): Promise<void> {
		this.#laneUnsubscribe?.();
		this.#laneUnsubscribe = undefined;
		this.#chatView?.dispose();
		this.#chatView = undefined;
		this.#documentContainer.clear();
		this.#pendingMessagesContainer.clear();
		this.#statusContainer.clear();
		if (!this.#closed) this.#rebuild();
	}

	async #runPrompt(messageText: string): Promise<void> {
		const prompt = messageText.trim();
		if (prompt.length === 0) return;
		if (prompt.startsWith("/")) {
			const separator = prompt.indexOf(" ");
			const name = prompt.slice(1, separator === -1 ? undefined : separator);
			const args = separator === -1 ? "" : prompt.slice(separator + 1).trim();
			await this.#executeSlashCommand(name, args);
			return;
		}
		this.#chatInput.setText("");
		try {
			await this.#submitPrompt(prompt);
		} catch (error) {
			this.#status = `Error: ${message(error)}`;
			this.#rebuild();
		}
	}

	async #executeSlashCommand(name: string, args: string): Promise<void> {
		const command = this.#selectedSlashCommands()
			?.list()
			.find((candidate) => candidate.name === name);
		this.#chatInput.setText("");
		if (command === undefined) {
			this.#status = `Unknown slash command: /${name}`;
			this.#rebuild();
			return;
		}
		try {
			const result = await this.#facetHost!.root((context) => command.run(args, context));
			if (result !== undefined) {
				if ("entryId" in result) this.#reportQueue(result);
				else this.#reportOperation(result);
			}
		} catch (error) {
			this.#status = `Error: ${message(error)}`;
			this.#rebuild();
		}
	}

	async #submitPrompt(prompt: string): Promise<void> {
		const controller = this.#selectedController();
		if (controller === undefined) throw new Error("No Session AgentController service is available");
		const operation = this.#laneSnapshot()?.operation;
		const running = operation !== null && operation !== undefined;
		this.#status = running ? "Queueing steering message…" : "Running turn…";
		this.#rebuild();
		if (running)
			this.#reportQueue(
				await this.#facetHost!.root((context) => controller.steer({ message: prompt, images: null }, context)),
			);
		else
			this.#reportOperation(
				await this.#facetHost!.root((context) => controller.prompt({ message: prompt, images: null }, context)),
			);
	}

	async #queueFollowUp(text: string): Promise<void> {
		const controller = this.#selectedController();
		if (controller === undefined) return;
		try {
			this.#status = "Queueing follow-up…";
			this.#rebuild();
			this.#reportQueue(
				await this.#facetHost!.root((context) => controller.followUp({ message: text, images: null }, context)),
			);
		} catch (error) {
			this.#status = `Error: ${message(error)}`;
			this.#rebuild();
		}
	}

	#reportOperation(response: AgentOperationResponse): void {
		this.#status = response.accepted
			? response.error === null
				? ""
				: `Operation failed: ${response.error.message}`
			: `Operation rejected: ${response.error.message}`;
		this.#rebuild();
	}

	#reportQueue(response: AgentQueueResponse): void {
		this.#status = response.accepted ? `Queued ${response.entryId}.` : `Message rejected: ${response.error.message}`;
		this.#rebuild();
	}

	#interrupt(): void {
		const operation = this.#laneSnapshot()?.operation;
		const controller = this.#selectedController();
		if (operation === null || operation === undefined || controller === undefined) return;
		this.#status = `Aborting ${operation.id}…`;
		this.#rebuild();
		void this.#facetHost!.root((context) => controller.requestAbort(operation.id, context)).catch(
			(error: unknown) => {
				this.#status = `Error: ${message(error)}`;
				this.#rebuild();
			},
		);
	}

	#selectedController(): AgentController | undefined {
		return this.#controller;
	}

	#laneSnapshot() {
		const snapshot = this.#session?.transcript.state.value?.snapshot;
		return snapshot === null ? undefined : snapshot;
	}

	#footer(): string {
		const snapshot = this.#laneSnapshot();
		if (!snapshot) return "/model · /thinking · /compact · /reload";
		return `${snapshot.configuration.model.provider}/${snapshot.configuration.model.modelId} · thinking:${snapshot.configuration.thinkingLevel} · ${snapshot.stats.messageCount} messages · /model · /thinking · /compact · /reload`;
	}
}

async function prepareClientSession(
	command: ClientCommand,
	servers: readonly ClientTuiServer[],
): Promise<PreparedClientSession> {
	const opened = servers.map((server) => ({
		server,
		directory: server.server.host.hold(SessionDirectory, {}),
		management: server.server.host.hold(SessionManagement, {}),
		plugins: server.server.host.hold(PresentationPlugins, {}),
	}));
	try {
		await Promise.all(
			opened.flatMap(({ directory, management, plugins }) => [directory.ready, management.ready, plugins.ready]),
		);
		const features = opened;
		let selected:
			| {
					readonly server: ClientTuiServer;
					readonly management: SessionManagement;
					readonly plugins: PresentationPlugins;
					readonly summary: SessionSummary;
			  }
			| undefined;
		if (command.sessionId !== undefined) {
			const matches = features.flatMap((feature) =>
				(feature.directory.state.value?.sessions ?? [])
					.filter((session) => session.sessionId === command.sessionId)
					.map((summary) => ({
						server: feature.server,
						management: feature.management,
						plugins: feature.plugins,
						summary,
					})),
			);
			if (matches.length > 1) throw new Error(`Session ${command.sessionId} is available from more than one server`);
			selected = matches[0];
			if (selected === undefined) {
				if (command.connect?.transport === "radius") {
					throw new Error(`Remote server does not contain Session ${command.sessionId}`);
				}
				const feature = requireSingleServer(features);
				selected = {
					server: feature.server,
					management: feature.management,
					plugins: feature.plugins,
					summary: await feature.server.server.host.root((context) =>
						feature.management.create({ id: command.sessionId }, context),
					),
				};
			}
		} else if (command.continue === true || command.resume === true) {
			selected = features
				.flatMap((feature) =>
					(feature.directory.state.value?.sessions ?? []).map((summary) => ({
						server: feature.server,
						management: feature.management,
						plugins: feature.plugins,
						summary,
					})),
				)
				.sort(
					(left, right) =>
						right.summary.createdAt - left.summary.createdAt ||
						left.summary.serverId.localeCompare(right.summary.serverId) ||
						left.summary.sessionId.localeCompare(right.summary.sessionId),
				)[0];
		}
		if (selected === undefined) {
			const feature = requireSingleServer(features);
			selected = {
				server: feature.server,
				management: feature.management,
				plugins: feature.plugins,
				summary: await feature.server.server.host.root((context) => feature.management.create({}, context)),
			};
		}
		const presentationPlugins = await selected.server.server.host.root((context) =>
			selected!.plugins.prepareSession(
				{
					sessionId: selected!.summary.sessionId,
					packagePaths: command.pluginPackages?.map((packagePath) => resolve(packagePath)) ?? null,
				},
				context,
			),
		);
		await selected.server.server.host.root((context) =>
			selected!.management.attach(selected!.summary.sessionId, context),
		);
		await selected.server.session.whenAttached(selected.summary.sessionId, BACKGROUND_CONTEXT);
		return {
			server: selected.server,
			summary: selected.summary,
			presentationPlugins,
		};
	} finally {
		for (const { directory, management, plugins } of opened) {
			directory.release();
			management.release();
			plugins.release();
		}
	}
}

export async function runClientTui(command: ClientCommand, options: RunClientTuiOptions = {}): Promise<void> {
	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	setRegisteredThemes(resourceLoader.getThemes().themes);
	const runtime = await openClientRuntime(command, options);
	const tui = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: settingsManager.getShowHardwareCursor(),
		logDirectory: agentDir,
		fullscreenWheelScrollLines: settingsManager.getFullscreenWheelScrollLines(),
	});
	tui.setClearOnShrink(settingsManager.getClearOnShrink());
	let component: ExperimentalClientTui | undefined;
	let tuiStarted = false;
	const themeController = new InteractiveThemeController(tui, {
		getSettingsManager: () => settingsManager,
		showError: (error) => component?.showError(error),
		onChanged: () => component?.refreshTheme(),
	});
	const errors: unknown[] = [];
	try {
		let finish!: () => void;
		const finished = new Promise<void>((resolve) => {
			finish = () => {
				themeController.disableAutoSync();
				if (tuiStarted) {
					tui.stop();
					tuiStarted = false;
				}
				resolve();
			};
		});
		component = await ExperimentalClientTui.create({
			command,
			ui: tui,
			servers: runtime.servers.map((server) => ({
				serverId: server.route.serverId,
				radius: server.route.transport === "radius",
				server: server.server,
				session: server.session,
			})),
			facetLoader: options.facetLoader,
			requestRender: () => tui.requestRender(),
			finish,
		});
		tui.addChild(component);
		tui.setLayoutRoot(component.layoutRoot);
		tui.setFocus(component);
		tuiStarted = true;
		tui.start();
		themeController.applyFromSettings();
		await finished;
	} catch (error) {
		errors.push(error);
	}
	for (const cleanup of [
		() => themeController.dispose(),
		stopThemeWatcher,
		() => {
			if (tuiStarted) tui.stop();
		},
	]) {
		try {
			cleanup();
		} catch (error) {
			errors.push(error);
		}
	}
	const results = await Promise.allSettled([
		Promise.resolve().then(() => component?.close()),
		Promise.resolve().then(() => runtime.dispose()),
	]);
	for (const result of results) if (result.status === "rejected") errors.push(result.reason);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, "Failed to run or close experimental client TUI");
}

function requireSingleServer<T>(features: readonly T[]): T {
	if (features.length !== 1) throw new Error("Starting a Session requires exactly one server");
	return features[0]!;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
