import { createHost, hostNamed, method, remote } from "@earendil-works/chord";
import type { Context, Session, SessionMetadata } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, MemorySessionRepo } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { SessionAmbiguousError, SessionNotFoundError } from "../errors.ts";
import { createRoutedLinkPair } from "../link.ts";
import type { RoutedServerServiceHost, RoutedSessionHandle, ServerHost } from "../types.ts";

export class Deferred<T> {
	readonly promise: Promise<T>;
	private resolvePromise!: (value: T) => void;

	constructor() {
		this.promise = new Promise<T>((resolve) => {
			this.resolvePromise = resolve;
		});
	}

	resolve(value: T): void {
		this.resolvePromise(value);
	}
}

interface OpenGate {
	entered: Deferred<void>;
	release: Deferred<void>;
}
export const TestSessionManagement = remote("test.session-management", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: { live: { methods: { attach: method(Type.String()), detach: method() } } },
});

export const TestSessionContract = remote("test.session", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: {
		live: {
			state: { revision: Type.Integer() },
			methods: { run: method(Type.String(), Type.String()), increment: method(), wait: method() },
		},
	},
});

export class TestHarness {
	readonly session: Session;
	readonly closed = new Deferred<void>();
	readonly #termination = new Deferred<Error | undefined>();
	readonly terminated = this.#termination.promise;
	attachedClients = 0;
	attachmentReleaseCount = 0;
	closeCount = 0;
	readonly calls: string[] = [];
	readonly waitEntered = new Deferred<void>();
	readonly waitCancelled = new Deferred<void>();
	failAttachmentRelease?: Error;
	failClose?: Error;
	private nextCloseGate?: OpenGate;

	constructor(session: Session) {
		this.session = session;
	}

	attachClient(_context: Context) {
		this.attachedClients += 1;
		const host = createHost({ name: "session", self: "session" });
		host.serve(TestSessionContract, (_input, _principal, self) => {
			const revision = self.state("revision", Type.Integer(), 0);
			return {
				variant: "live",
				revision,
				run: (value) => {
					this.calls.push(value);
					return value;
				},
				increment: (ctx) => {
					revision.change(ctx, (value) => value + 1);
				},
				wait: async (ctx) => {
					this.waitEntered.resolve(undefined);
					await new Promise<void>((resolve) => {
						if (ctx.signal.aborted) resolve();
						else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
					});
					this.waitCancelled.resolve(undefined);
				},
			};
		});
		const [link, provider] = createRoutedLinkPair();
		host.accept(provider, { principal: "presentation" });
		let released = false;
		return {
			link,
			release: async (_context: Context) => {
				if (released) return;
				released = true;
				this.attachmentReleaseCount += 1;
				this.attachedClients -= 1;
				link.close();
				await host.close();
				if (this.failAttachmentRelease) throw this.failAttachmentRelease;
			},
		};
	}

	async close(context: Context): Promise<void> {
		this.closeCount += 1;
		const gate = this.nextCloseGate;
		if (gate) {
			this.nextCloseGate = undefined;
			gate.entered.resolve(undefined);
			await gate.release.promise;
		}
		if (this.failClose) {
			const error = this.failClose;
			this.failClose = undefined;
			throw error;
		}
		await this.session.close(context);
		this.closed.resolve(undefined);
		this.#termination.resolve(undefined);
	}

	async terminate(error: Error): Promise<void> {
		await this.session.close(BACKGROUND_CONTEXT);
		this.#termination.resolve(error);
	}

	gateNextClose(): OpenGate {
		const gate = { entered: new Deferred<void>(), release: new Deferred<void>() };
		this.nextCloseGate = gate;
		return gate;
	}
}

export function createTestServerServices(): RoutedServerServiceHost {
	return {
		attachClient(presentation) {
			const host = createHost({ name: "server", self: "server" });
			host.serve(TestSessionManagement, () => ({
				variant: "live",
				attach: (sessionId) => presentation.attachSession(sessionId, BACKGROUND_CONTEXT),
				detach: () => presentation.detachSession(BACKGROUND_CONTEXT),
			}));
			const [link, provider] = createRoutedLinkPair();
			host.accept(provider, { principal: "presentation" });
			return {
				link,
				release: async () => {
					link.close();
					await host.close();
				},
			};
		},
	};
}

export class TestServerHost implements ServerHost {
	readonly serverServices = createTestServerServices();
	readonly repo = new MemorySessionRepo({ now: () => 1 });
	readonly harnesses = new Map<string, TestHarness[]>();
	openSessionCount = 0;
	nextOpenSessionError?: Error;
	nextHarnessCloseError?: Error;
	private nextOpenSessionGate?: OpenGate;

	async resolveSession(sessionId: string, context: Context): Promise<SessionMetadata> {
		const matches = (await this.repo.list(undefined, context)).filter(({ id }) => id === sessionId);
		if (matches.length === 0) throw new SessionNotFoundError(`Unknown session: ${sessionId}`);
		if (matches.length > 1) throw new SessionAmbiguousError();
		return matches[0]!;
	}

	async openSession(metadata: SessionMetadata, context: Context): Promise<RoutedSessionHandle> {
		this.openSessionCount += 1;
		const gate = this.nextOpenSessionGate;
		if (gate) {
			this.nextOpenSessionGate = undefined;
			gate.entered.resolve(undefined);
			await gate.release.promise;
		}
		const session = await this.repo.open(metadata, context);
		try {
			if (this.nextOpenSessionError) {
				const error = this.nextOpenSessionError;
				this.nextOpenSessionError = undefined;
				throw error;
			}
			const harness = new TestHarness(session);
			if (this.nextHarnessCloseError) {
				harness.failClose = this.nextHarnessCloseError;
				this.nextHarnessCloseError = undefined;
			}
			const harnesses = this.harnesses.get(metadata.id) ?? [];
			harnesses.push(harness);
			this.harnesses.set(metadata.id, harnesses);
			return harness;
		} catch (error) {
			await session.close(context);
			throw error;
		}
	}

	async seed(id = "session-1", parentSessionId?: string): Promise<SessionMetadata> {
		const session = await this.repo.create({ id, parentSessionId }, BACKGROUND_CONTEXT);
		const metadata = session.metadata;
		await session.close(BACKGROUND_CONTEXT);
		return metadata;
	}

	gateNextOpenSession(): OpenGate {
		const gate = { entered: new Deferred<void>(), release: new Deferred<void>() };
		this.nextOpenSessionGate = gate;
		return gate;
	}

	latestHarness(id: string): TestHarness {
		const harnesses = this.harnesses.get(id);
		if (!harnesses?.length) throw new Error(`No harness for ${id}`);
		return harnesses.at(-1)!;
	}
}
