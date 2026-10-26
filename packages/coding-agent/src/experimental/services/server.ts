import { ChordError, type Context, createHost, type JsonValue, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import {
	createRoutedLinkPair,
	type RoutedServerServiceAttachment,
	type RoutedServerServiceHost,
	ServerError,
} from "@earendil-works/pi-server";
import { PresentationPlugins } from "./plugins.ts";
import {
	type SessionCreateOptions,
	SessionDirectory,
	type SessionDirectoryState,
	SessionManagement,
	type SessionSummary,
} from "./sessions.ts";

export interface ExperimentalServerServices {
	readonly host: RoutedServerServiceHost;
	refresh(context?: Context): Promise<void>;
	dispose(): Promise<void>;
}

export async function createExperimentalServerServices(options: {
	list(context: Context): Promise<SessionSummary[]>;
	create(createOptions: SessionCreateOptions, context: Context): Promise<SessionSummary>;
	remove(sessionId: string, context: Context): Promise<void>;
	prepareSessionPlugins(
		sessionId: string,
		packagePaths: readonly string[] | undefined,
		context: Context,
	): Promise<{ readonly packagePaths: readonly string[]; readonly presentationPlugins: JsonValue }>;
	reloadPresentationPlugins(packagePaths: readonly string[], context: Context): Promise<JsonValue>;
}): Promise<ExperimentalServerServices> {
	let revision = 1;
	const directory = replicatedState<SessionDirectoryState>({
		revision,
		sessions: await options.list(BACKGROUND_CONTEXT),
	});
	const attachments = new Set<RoutedServerServiceAttachment>();
	let mutationTail = Promise.resolve();
	const refreshNow = async (context: Context): Promise<void> => {
		const sessions = await options.list(context);
		directory.change(context, (draft) => {
			draft.revision = ++revision;
			draft.sessions = sessions;
		});
	};
	const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = mutationTail.catch(() => {}).then(operation);
		mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result.catch((error: unknown) => {
			if (error instanceof ChordError) throw error;
			if (error instanceof ServerError) throw new ChordError("invalid", error.message, { reason: error.code });
			throw new ChordError("unavailable", "Internal server error", { reason: "internal_error", cause: error });
		});
	};
	return {
		host: {
			attachClient(presentation) {
				const host = createHost({ name: "server", self: "server" });
				let preparedPluginPackagePaths: readonly string[] | undefined;
				host.serve(SessionDirectory, () => ({
					variant: "active",
					state: {
						get value() {
							return directory.value!;
						},
						subscribe: (listener) =>
							directory.subscribe((value) => {
								if (value !== undefined) listener(value);
							}),
						events: (listener) =>
							directory.subscribe((value) => {
								if (value !== undefined) listener({ type: "reset", value });
							}),
					},
				}));
				host.serve(PresentationPlugins, () => ({
					variant: "active",
					prepareSession: ({ sessionId, packagePaths }, ctx) =>
						serialize(async () => {
							const selected = await options.prepareSessionPlugins(
								sessionId,
								packagePaths ?? undefined,
								withAbortSignal(ctx.signal, BACKGROUND_CONTEXT),
							);
							preparedPluginPackagePaths = selected.packagePaths;
							return selected.presentationPlugins;
						}),
					reload: (ctx) =>
						serialize(() => {
							if (preparedPluginPackagePaths === undefined)
								throw new ChordError("invalid", "No Session plugin selection is prepared", {
									reason: "session_not_attached",
								});
							return options.reloadPresentationPlugins(
								preparedPluginPackagePaths,
								withAbortSignal(ctx.signal, BACKGROUND_CONTEXT),
							);
						}),
				}));
				host.serve(SessionManagement, () => ({
					variant: "active",
					create: (createOptions, ctx) =>
						serialize(async () => {
							const context = withAbortSignal(ctx.signal, BACKGROUND_CONTEXT);
							const created = await options.create(createOptions, context);
							await refreshNow(context);
							return created;
						}),
					remove: (sessionId, ctx) =>
						serialize(async () => {
							const context = withAbortSignal(ctx.signal, BACKGROUND_CONTEXT);
							await presentation.prepareSessionRemoval(sessionId, context);
							await options.remove(sessionId, context);
							await refreshNow(context);
						}),
					attach: (sessionId, ctx) =>
						serialize(() =>
							presentation.attachSession(sessionId, withAbortSignal(ctx.signal, BACKGROUND_CONTEXT)),
						),
					detach: (ctx) =>
						serialize(async () => {
							await presentation.detachSession(withAbortSignal(ctx.signal, BACKGROUND_CONTEXT));
							preparedPluginPackagePaths = undefined;
						}),
				}));
				const [provider, link] = createRoutedLinkPair();
				host.accept(provider, { principal: "presentation", kind: "client" });
				let released: Promise<void> | undefined;
				const attachment: RoutedServerServiceAttachment = {
					link,
					release() {
						released ??= (async () => {
							link.close("Server attachment released");
							try {
								await host.close();
							} finally {
								attachments.delete(attachment);
							}
						})();
						return released;
					},
				};
				attachments.add(attachment);
				return attachment;
			},
		},
		refresh: (context = BACKGROUND_CONTEXT) => serialize(() => refreshNow(context)),
		async dispose() {
			const releases = await Promise.allSettled(
				[...attachments].map((attachment) => attachment.release(BACKGROUND_CONTEXT)),
			);
			await mutationTail;
			const errors = releases.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, "Failed to release server attachments");
		},
	};
}
