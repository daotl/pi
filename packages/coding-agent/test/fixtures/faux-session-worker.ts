import { access, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFacet, local } from "@earendil-works/chord";
import { AgentHarness, BACKGROUND_CONTEXT, JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { COORDINATOR_PROTOCOL_VERSION } from "../../src/experimental/coordinator.ts";
import { consumeInternalProcessRole, encodeControlLine } from "../../src/experimental/process.ts";
import {
	type CreateSessionWorkerHarness,
	runSessionWorkerWithHarness,
	SESSION_WORKER_CONTROL_ADDRESS_ENV,
	SESSION_WORKER_CONTROL_TOKEN_ENV,
	SESSION_WORKER_PEER_ID_ENV,
	SESSION_WORKER_SESSION_KEY_ENV,
	SessionWorkerCommandSchema,
	SessionWorkerOptionsSchema,
} from "../../src/experimental/session-worker.ts";
import { KeyedProbe } from "./keyed-service.ts";

const createFauxHarness: CreateSessionWorkerHarness = async (session, options) => {
	if (options.provider !== "anthropic" || options.model !== "claude-sonnet-4-5") {
		throw new Error(`Unexpected faux worker model: ${options.provider}/${options.model}`);
	}
	const faux = fauxProvider();
	faux.setResponses([fauxAssistantMessage("deterministic remote answer", { timestamp: 20 })]);
	const models = createModels();
	models.setProvider(faux.provider);
	const harness = (
		await AgentHarness.create(
			{
				session,
				models,
				model: faux.getModel(),
				tools: [],
				resources: {},
			},
			BACKGROUND_CONTEXT,
		)
	).harness;
	const ProbeState = local("test.local.keyed-probe", {
		version: 1,
		input: Type.Object({ key: Type.String() }),
		members: {
			state: Type.Object({ value: Type.String() }),
			replace: KeyedProbe.def.variants.active.methods.replace,
		},
	});
	const keyedProbeFacet = {
		name: "@test/keyed-probe",
		...defineFacet(({ serve }) => {
			serve(
				ProbeState,
				(_input, _principal, self) => {
					const state = self.state("probe", Type.Object({ value: Type.String() }), { value: "first" });
					return { state, replace: (value, ctx) => state.replace(ctx, { value }) };
				},
				{ linger: 0 },
			);
			serve(KeyedProbe, ({ key }, _principal, self) => {
				const cleanupDirectory = process.env.__PI_TEST_WORKER_CLEANUP_DIR;
				if (cleanupDirectory !== undefined) {
					self.resource("principal-cleanup", {
						version: 1,
						open: () => ({}),
						close: async () => {
							if (key === "gated-cleanup") {
								await writeFile(join(cleanupDirectory, "cleanup-entered"), "closing");
								while (true) {
									try {
										await access(join(cleanupDirectory, "allow-cleanup"));
										break;
									} catch (error) {
										if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
									}
									await new Promise<void>((resolve) => setTimeout(resolve, 10));
								}
								await writeFile(join(cleanupDirectory, "cleanup-finished"), "closed");
							} else await writeFile(join(cleanupDirectory, "shutdown-entered"), "closing sibling");
						},
					});
				}
				const probe = self.get(ProbeState, { key }, { principal: "worker" });
				return {
					variant: "active",
					state: probe.state,
					replace: (value, ctx) => probe.replace(value, ctx),
					echo: (value) => value,
					async wait(ctx) {
						ctx.signal.throwIfAborted();
						if (cleanupDirectory !== undefined) await writeFile(join(cleanupDirectory, "wait-entered"), key);
						try {
							await new Promise<void>((_resolve, reject) => {
								const abort = () => reject(abortError(ctx.signal));
								if (ctx.signal.aborted) abort();
								else ctx.signal.addEventListener("abort", abort, { once: true });
							});
						} finally {
							if (cleanupDirectory !== undefined) await writeFile(join(cleanupDirectory, "wait-cancelled"), key);
						}
					},
				};
			});
		}),
	};
	return { harness, facetLoader: async () => ({ facets: [keyedProbeFacet], async dispose() {} }) };
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const role = consumeInternalProcessRole();
	if (role !== "session-worker") throw new Error("Faux Session worker requires a session-worker invocation");
	const legacyDirectory = process.env.__PI_TEST_LEGACY_WORKER_DIR;
	const running =
		legacyDirectory === undefined
			? runSessionWorkerWithHarness(process.argv.slice(2), createFauxHarness)
			: runLegacyWorker(legacyDirectory);
	void running.catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}

function abortError(signal: AbortSignal): Error {
	const reason: unknown = signal.reason;
	return reason instanceof Error ? reason : new DOMException("The operation was aborted", "AbortError");
}

/** Retained pre-Chord worker: unversioned readiness, old demand/shutdown controls and real session ownership. */
async function runLegacyWorker(directory: string): Promise<void> {
	const options: unknown = JSON.parse(process.argv[2]!);
	if (!Check(SessionWorkerOptionsSchema, options)) throw new Error("Invalid legacy worker options");
	const token = process.env[SESSION_WORKER_CONTROL_TOKEN_ENV]!;
	const sessionKey = Buffer.from(process.env[SESSION_WORKER_SESSION_KEY_ENV]!, "base64url").toString();
	const releaseOwnership = await lockfile.lock(options.metadata.path, { realpath: true, stale: 2_000, update: 1_000 });
	const executionEnv = new NodeExecutionEnv({ cwd: options.metadata.cwd });
	const repo = new JsonlSessionRepo({ fileSystem: executionEnv, sessionsRoot: options.sessionDir });
	const session = await repo.open(options.metadata, BACKGROUND_CONTEXT);
	const socket = createConnection(process.env[SESSION_WORKER_CONTROL_ADDRESS_ENV]!);
	const send = (payload: unknown): void => {
		socket.write(encodeControlLine({ type: "send", to: "server", payload }));
	};
	const announce = (): void =>
		send({
			type: "worker_ready",
			token,
			sessionKey,
			sessionId: options.metadata.id,
			pid: process.pid,
			metadata: options.metadata,
			pluginManifestPaths: options.pluginManifestPaths,
		});
	let stopping = false;
	const stop = async (): Promise<void> => {
		if (stopping) return;
		stopping = true;
		await writeFile(join(directory, "shutdown-received"), "shutdown");
		// The coordinator reports a disconnect while this process and its ownership lock remain alive.
		socket.destroy();
		while (true) {
			try {
				await access(join(directory, "allow-exit"));
				break;
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			}
			// This is a cross-process gate; parent-side fake timers cannot drive the fixture.
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
		}
		await session.close(BACKGROUND_CONTEXT);
		await repo.close(BACKGROUND_CONTEXT);
		await executionEnv.cleanup(BACKGROUND_CONTEXT);
		await releaseOwnership();
		process.exit(0);
	};
	const Input = Type.Union([
		Type.Object({ type: Type.Literal("peer_registered") }),
		Type.Object({ type: Type.Literal("message"), from: Type.Literal("server"), payload: SessionWorkerCommandSchema }),
	]);
	let buffered = "";
	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		buffered += chunk;
		while (true) {
			const newline = buffered.indexOf("\n");
			if (newline === -1) return;
			const value: unknown = JSON.parse(buffered.slice(0, newline));
			buffered = buffered.slice(newline + 1);
			if (!Check(Input, value)) continue;
			if (value.type === "peer_registered") announce();
			else if (value.payload.type === "discover_workers") announce();
			else if (value.payload.type === "shutdown") void stop().catch(() => process.exit(1));
			else if (value.payload.type === "session_demand")
				send({
					...value.payload,
					type: "demand_applied",
					token,
					sessionKey,
				});
			else void writeFile(join(directory, "invalid-chord-frame"), "chord");
		}
	});
	socket.once("connect", () =>
		socket.write(
			encodeControlLine({
				type: "register_peer",
				protocol: COORDINATOR_PROTOCOL_VERSION,
				peerId: process.env[SESSION_WORKER_PEER_ID_ENV],
			}),
		),
	);
	socket.once("error", () => process.exit(1));
}
