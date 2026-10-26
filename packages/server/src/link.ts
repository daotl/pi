import type { Frame, Link } from "@earendil-works/chord";

/** A JSON-only in-process link for endpoints tunneled over the routed byte protocol. */
export function createRoutedLinkPair(): [Link, Link] {
	class RoutedLink implements Link {
		peer!: RoutedLink;
		closed = false;
		#receiver: ((frame: Frame) => void) | undefined;
		#queue: Frame[] = [];
		#handlers = new Set<(reason: string) => void>();
		#tail = Promise.resolve();

		send(frame: Frame): number | undefined {
			if (this.closed) return undefined;
			const json = JSON.stringify(frame);
			const copy = JSON.parse(json) as Frame;
			this.#tail = this.#tail.then(() => this.peer.deliver(copy));
			return json.length;
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
			this.send({ t: "bye", reason });
			this.end(reason);
		}

		private deliver(frame: Frame): void {
			if (this.closed) return;
			if (frame.t === "bye") this.end(frame.reason ?? "peer closed");
			else if (this.#receiver) this.#receiver(frame);
			else this.#queue.push(frame);
		}

		private end(reason: string): void {
			if (this.closed) return;
			this.closed = true;
			this.#queue.length = 0;
			this.#receiver = undefined;
			for (const handler of this.#handlers) handler(reason);
			this.#handlers.clear();
		}
	}
	const left = new RoutedLink();
	const right = new RoutedLink();
	left.peer = right;
	right.peer = left;
	return [left, right];
}
