import type { AcceptOptions } from "./connection.ts";
import type { Host } from "./host.ts";
import { type WebSocketLike, webSocketLink } from "./link.ts";

/** A WebSocket server (e.g. `ws`'s `WebSocketServer`), structurally: Chord does not depend on `ws`. */
export interface WebSocketServerLike<Request> {
	on(event: "connection", listener: (socket: WebSocketLike, request: Request) => void): unknown;
}

/** WebSocket peers are always accepted as clients: no roots, no code versions, no reload votes, not addressable. */
export interface WebSocketAcceptOptions<Request, P = unknown>
	extends Omit<AcceptOptions<P>, "principal" | "kind" | "name"> {
	/** Maximum milliseconds allowed to authenticate a socket (default 10000; finite and nonnegative). */
	readonly authenticationTimeout?: number;
	/** The authenticator: the principal of the connecting client, or undefined to refuse it. */
	principal(request: Request): P | undefined | Promise<P | undefined>;
}

/** Accepts every connection of `server` on `host` as a client link stamped with the authenticated principal. */
export function acceptWebSockets<Request, P = unknown>(
	server: WebSocketServerLike<Request>,
	host: Host<P>,
	options: WebSocketAcceptOptions<Request, P>,
): void {
	const { authenticationTimeout = 10_000, principal: authenticate, ...accept } = options;
	if (!Number.isFinite(authenticationTimeout) || authenticationTimeout < 0)
		throw new TypeError("authenticationTimeout must be finite and nonnegative");
	server.on("connection", (socket, request) => {
		// Wrap at once so frames sent while authenticating are queued, not lost. Large payloads go out deflated; clients
		// may not send packed frames (a small message could inflate to anything).
		const link = webSocketLink(socket, { compress: true, acceptPacked: false });
		const timer = setTimeout(() => link.close("authentication timed out"), authenticationTimeout);
		timer.unref?.();
		link.onClose(() => clearTimeout(timer));
		const authenticated = (principal: P | undefined): void => {
			clearTimeout(timer);
			if (link.closed) return;
			if (socket.readyState !== 1) {
				link.close("socket closed while authenticating");
				return;
			}
			if (principal === undefined) link.close("unauthorized");
			else host.accept(link, { ...accept, principal, kind: "client" });
		};
		try {
			void Promise.resolve(authenticate(request))
				.then(authenticated)
				.catch(() => link.close("authentication failed"));
		} catch {
			link.close("authentication failed");
		}
	});
}
