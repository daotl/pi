import { type Ctx as Context, hostNamed, method, type Readable, remote } from "@earendil-works/chord";
import type { ServerId } from "@earendil-works/pi-protocol";
import { Type } from "typebox";

export interface SessionAddress {
	serverId: ServerId;
	sessionId: string;
}

export interface SessionSummary extends SessionAddress {
	createdAt: number;
}

export interface SessionCreateOptions {
	id?: string;
}

export interface SessionDirectoryState {
	revision: number;
	sessions: SessionSummary[];
}

export interface SessionDirectory {
	readonly state: Readable<SessionDirectoryState>;
}

export const SessionSummarySchema = Type.Unsafe<SessionSummary>(
	Type.Object({ serverId: Type.String(), sessionId: Type.String(), createdAt: Type.Number() }),
);
export const SessionDirectoryStateSchema = Type.Unsafe<SessionDirectoryState>(
	Type.Object({ revision: Type.Number(), sessions: Type.Array(SessionSummarySchema) }),
);
export const SessionDirectory = remote("pi.session-directory", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: { active: { state: { state: SessionDirectoryStateSchema } } },
});

export interface SessionManagement {
	create(options: SessionCreateOptions, context: Context): Promise<SessionSummary>;
	remove(sessionId: string, context: Context): Promise<void>;
	attach(sessionId: string, context: Context): Promise<void>;
	detach(context: Context): Promise<void>;
}

export const SessionManagement = remote("pi.session-management", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: {
		active: {
			methods: {
				create: method(Type.Object({ id: Type.Optional(Type.String()) }), SessionSummarySchema),
				remove: method(Type.String()),
				attach: method(Type.String()),
				detach: method(),
			},
		},
	},
});
