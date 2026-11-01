import { type Frame, type Link, stringifyFrame } from "@earendil-works/chord";
import {
	type AttachmentEnvelope,
	encodeClientMessage,
	type FrameEnvelope,
	isServerId,
	ProtocolValidationError,
	type RpcTarget,
	type ServerHello,
	type SessionTarget,
} from "@earendil-works/pi-protocol";
import { Connection } from "./connection.ts";
import { ClientDisposedError, DisconnectedError, toError } from "./errors.ts";
import type {
	AttachmentChangeListener,
	ClientOptions,
	ConnectionState,
	ConnectionStateChange,
	Unsubscribe,
} from "./types.ts";

export class Client {
	readonly #options: ClientOptions;
	readonly #connection: Connection;
	readonly #connectionStateListeners = new Set<(change: ConnectionStateChange) => void>();
	readonly #attachmentListeners = new Set<AttachmentChangeListener>();
	readonly #links = new Set<ClientChordLink>();
	readonly #queuedFrames = new Map<string, Frame[]>();
	#hello: ServerHello | undefined;
	#attachment: SessionTarget | undefined;
	#disposed = false;
	#disposePromise: Promise<void> | undefined;

	constructor(options: ClientOptions) {
		if (!isServerId(options.serverId)) throw new TypeError("serverId must be a canonical lowercase UUIDv4");
		this.#options = options;
		this.#connection = new Connection({
			transportFactory: options.transportFactory,
			serverId: options.serverId,
			maxFrameLength: options.maxFrameLength,
			onHandshake: (hello) => {
				this.#hello = hello;
			},
			onMessage: (message) => this.#handleMessage(message),
			onStateChange: (change) => this.#handleConnectionStateChange(change),
		});
	}

	get disposed(): boolean {
		return this.#disposed;
	}
	get connectionState(): ConnectionState {
		return this.#connection.state;
	}
	get connected(): boolean {
		return this.#connection.state === "connected";
	}
	get serverId(): string {
		return this.#options.serverId;
	}
	get hello(): ServerHello | undefined {
		return this.#hello;
	}
	get attachment(): SessionTarget | undefined {
		return this.#attachment;
	}

	static async connect(options: ClientOptions): Promise<Client> {
		const client = new Client(options);
		try {
			await client.connect();
			return client;
		} catch (error) {
			await client.dispose();
			throw error;
		}
	}

	connect(): Promise<ServerHello> {
		if (this.#disposed) return Promise.reject(new ClientDisposedError());
		return this.#connection.connect();
	}

	reconnect(): Promise<ServerHello> {
		return this.connect();
	}
	disconnect(reason = "Client disconnected"): void {
		this.#connection.disconnect(reason);
	}

	onConnectionStateChange(listener: (change: ConnectionStateChange) => void): Unsubscribe {
		this.#assertNotDisposed();
		this.#connectionStateListeners.add(listener);
		return () => this.#connectionStateListeners.delete(listener);
	}

	onAttachmentChange(listener: AttachmentChangeListener): Unsubscribe {
		this.#assertNotDisposed();
		this.#attachmentListeners.add(listener);
		return () => this.#attachmentListeners.delete(listener);
	}

	/** Opens the native Chord channel for one live routed capability. Only one channel owns a route. */
	chordLink(target: RpcTarget): Link {
		this.#assertNotDisposed();
		if (!this.connected || !this.#targetIsCurrent(target)) throw new DisconnectedError("Chord route is unavailable");
		for (const existing of this.#links) {
			if (sameTarget(existing.target, target)) throw new Error("Chord route already has a link");
		}
		const captured = { ...target };
		const link = new ClientChordLink(
			captured,
			(frame) => {
				if (!this.connected || !this.#targetIsCurrent(captured)) throw new DisconnectedError();
				// Native frames use optional undefined fields. A JSON link omits those before the strict CBOR boundary.
				const normalized = JSON.parse(stringifyFrame(frame)) as Frame;
				const encoded = encodeClientMessage(
					{ type: "chord", target: captured, frame: normalized },
					{ maxFrameLength: this.#connection.maxFrameLength },
				);
				this.#connection.send(encoded);
				return encoded.byteLength;
			},
			() => this.#links.delete(link),
		);
		this.#links.add(link);
		const key = targetKey(captured);
		for (const frame of this.#queuedFrames.get(key) ?? []) link.deliver(frame);
		this.#queuedFrames.delete(key);
		return link;
	}

	#handleMessage(message: FrameEnvelope | AttachmentEnvelope): void {
		if (message.type === "attachment") {
			if (message.attachment !== null && message.attachment.serverId !== this.serverId) {
				this.#connection.fail(new ProtocolValidationError("Attachment update belongs to another server"));
				return;
			}
			this.#setAttachment(message.attachment ?? undefined);
			return;
		}
		if (!this.#targetIsCurrent(message.target)) return;
		for (const link of this.#links) {
			if (sameTarget(link.target, message.target)) {
				link.deliver(message.frame);
				return;
			}
		}
		const key = targetKey(message.target);
		const queued = this.#queuedFrames.get(key) ?? [];
		queued.push(message.frame);
		this.#queuedFrames.set(key, queued);
	}

	#handleConnectionStateChange(change: ConnectionStateChange): void {
		if (change.state === "connecting") this.#hello = undefined;
		if (change.state === "disconnected") {
			this.#hello = undefined;
			for (const link of [...this.#links]) link.end(change.error?.message ?? "disconnected");
			this.#queuedFrames.clear();
			this.#setAttachment(undefined);
		}
		for (const listener of this.#connectionStateListeners) {
			try {
				listener(change);
			} catch (error) {
				this.#reportListenerError(error);
			}
		}
	}

	dispose(): Promise<void> {
		if (this.#disposePromise) return this.#disposePromise;
		this.#disposed = true;
		this.#disposePromise = Promise.resolve();
		this.#connection.disconnect(new ClientDisposedError());
		this.#hello = undefined;
		this.#setAttachment(undefined);
		this.#connectionStateListeners.clear();
		this.#attachmentListeners.clear();
		this.#queuedFrames.clear();
		return this.#disposePromise;
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.dispose();
	}

	#setAttachment(attachment: SessionTarget | undefined): void {
		const previous = this.#attachment;
		if (
			previous === undefined
				? attachment === undefined
				: attachment !== undefined && sameTarget(previous, attachment)
		)
			return;
		this.#attachment = attachment;
		for (const link of [...this.#links]) {
			if ("sessionId" in link.target && !this.#targetIsCurrent(link.target)) link.end("attachment changed");
		}
		for (const [key] of this.#queuedFrames) {
			const target = JSON.parse(key) as RpcTarget;
			if (!this.#targetIsCurrent(target)) this.#queuedFrames.delete(key);
		}
		for (const listener of this.#attachmentListeners) {
			try {
				listener(attachment);
			} catch (error) {
				this.#reportListenerError(error);
			}
		}
	}

	#targetIsCurrent(target: RpcTarget): boolean {
		if (!("sessionId" in target)) return this.#hello?.serverId === target.serverId;
		return this.#attachment !== undefined && sameTarget(this.#attachment, target);
	}
	#assertNotDisposed(): void {
		if (this.#disposed) throw new ClientDisposedError();
	}
	#reportListenerError(error: unknown): void {
		try {
			this.#options.onListenerError?.(toError(error));
		} catch {
			/* Diagnostics never affect the transport. */
		}
	}
}

class ClientChordLink implements Link {
	closed = false;
	readonly target: RpcTarget;
	readonly #send: (frame: Frame) => number;
	readonly #remove: () => void;
	readonly #handlers = new Set<(reason: string) => void>();
	#receiver: ((frame: Frame) => void) | undefined;
	#queue: Frame[] = [];
	constructor(target: RpcTarget, send: (frame: Frame) => number, remove: () => void) {
		this.target = target;
		this.#send = send;
		this.#remove = remove;
	}
	send(frame: Frame): number | undefined {
		if (this.closed) return undefined;
		try {
			return this.#send(frame);
		} catch (error) {
			this.end(toError(error).message);
			throw error;
		}
	}
	receive(handler: (frame: Frame) => void): void {
		this.#receiver = handler;
		for (const frame of this.#queue.splice(0)) {
			if (this.closed) break;
			handler(frame);
		}
	}
	onClose(handler: (reason: string) => void): void {
		if (this.closed) handler("closed");
		else this.#handlers.add(handler);
	}
	close(reason = "closed"): void {
		if (this.closed) return;
		try {
			this.#send({ t: "bye", reason });
		} catch {
			/* The byte transport may already be gone. */
		} finally {
			this.end(reason);
		}
	}
	deliver(frame: Frame): void {
		if (this.closed) return;
		if (frame.t === "bye") this.end(frame.reason ?? "peer closed");
		else if (this.#receiver) this.#receiver(frame);
		else this.#queue.push(frame);
	}
	end(reason: string): void {
		if (this.closed) return;
		this.closed = true;
		this.#queue.length = 0;
		this.#receiver = undefined;
		this.#remove();
		for (const handler of this.#handlers) handler(reason);
		this.#handlers.clear();
	}
}

/** Captures a server or Session route as a native Chord link. Recreate it after route changes or disconnect. */
export function createClientChordLink(client: Client, getTarget: () => RpcTarget | undefined): Link {
	const target = getTarget();
	if (target === undefined) throw new DisconnectedError("Chord route is unavailable");
	return client.chordLink(target);
}

function sameTarget(left: RpcTarget, right: RpcTarget): boolean {
	if (left.serverId !== right.serverId) return false;
	if (!("sessionId" in left) || !("sessionId" in right)) return !("sessionId" in left) && !("sessionId" in right);
	return left.sessionId === right.sessionId && left.attachmentId === right.attachmentId;
}

function targetKey(target: RpcTarget): string {
	return JSON.stringify(
		"sessionId" in target
			? { serverId: target.serverId, sessionId: target.sessionId, attachmentId: target.attachmentId }
			: { serverId: target.serverId },
	);
}
