import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isJsonRpcNotification, isJsonRpcRequest, LATEST_PROTOCOL_VERSION } from "@earendil-works/pi-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { runMcpCommand } from "../src/extensions/mcp/cli.ts";
import { McpOAuthCredentialStore } from "../src/extensions/mcp/runtime.ts";

const FIXTURE = resolve(import.meta.dirname, "../../mcp/test/fixtures/stdio-server.mjs");

describe("pi mcp", () => {
	const dirs: string[] = [];

	afterEach(() => {
		while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
	});

	async function run(args: string[], servers: Record<string, unknown> | undefined, dir?: string) {
		const agentDir = dir ?? mkdtempSync(join(tmpdir(), "pi-mcp-command-"));
		if (!dir) dirs.push(agentDir);
		if (servers) writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
		const output: string[] = [];
		const exitCode = await runMcpCommand(args, {
			cwd: agentDir,
			agentDir,
			log: (line) => output.push(line),
			error: (line) => output.push(line),
		});
		return { exitCode, output: output.join("\n"), agentDir };
	}

	const readConfig = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

	const servers = {
		fixture: { command: process.execPath, args: [FIXTURE] },
		broken: { command: "pi-test-missing-mcp-server" },
		parked: { command: process.execPath, args: [FIXTURE], enabled: false },
		bad: { args: ["no command"] },
	};

	it("lists servers with their state, tools, and errors, and fails while anything is wrong", async () => {
		const { exitCode, output } = await run(["list"], servers);
		expect(exitCode).toBe(1);
		expect(output).toContain("fixture: connected, 1 tool (codemode, global)\n");
		expect(output).toContain("  tools: echo");
		expect(output).toContain(
			"broken: failed (codemode, global)\n  pi-test-missing-mcp-server\n  spawn pi-test-missing-mcp-server ENOENT",
		);
		expect(output).toContain("parked: disabled (codemode, global)");
		expect(output).toContain("config error: ");
		expect(output).toContain('server "bad" needs either "command"');

		const ok = await run(["list"], { fixture: servers.fixture });
		expect(ok.exitCode).toBe(0);
	});

	it("prints JSON for scripts", async () => {
		const { exitCode, output } = await run(["list", "--json"], { fixture: servers.fixture, parked: servers.parked });
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(output) as { servers: { name: string; state: string; tools: string[] }[] };
		expect(parsed.servers.map(({ name, state, tools }) => ({ name, state, tools }))).toEqual([
			{ name: "fixture", state: "connected", tools: ["echo"] },
			{ name: "parked", state: "disabled", tools: [] },
		]);
	});

	it("lists global Radius tools with agentDir provider credentials resolved again after rotation, without session startup", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-mcp-provider-command-"));
		dirs.push(root);
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		const defaultAgentDir = join(root, "default-agent");
		for (const dir of [join(agentDir, "extensions"), join(cwd, ".pi"), defaultAgentDir]) {
			mkdirSync(dir, { recursive: true });
		}
		vi.stubEnv(ENV_AGENT_DIR, defaultAgentDir);
		vi.stubEnv("RADIUS_API_KEY", undefined);
		// A network guard, rather than offline mode, must catch accidental catalog discovery.
		vi.stubEnv("PI_OFFLINE", undefined);
		vi.stubEnv("PI_DISABLE_CLOUD_PROVIDERS", undefined);
		const initialToken = "radius-command-initial";
		const rotatedToken = "radius-command-rotated-longer";
		const authPath = join(agentDir, "auth.json");
		const credential = (access: string) => ({
			type: "oauth",
			access,
			refresh: "radius-command-refresh",
			expires: Date.now() + 3_600_000,
		});
		writeFileSync(authPath, JSON.stringify({ radius: credential(initialToken) }));
		writeFileSync(
			join(defaultAgentDir, "auth.json"),
			JSON.stringify({ radius: credential("wrong-default-directory-token") }),
		);
		const extensionMarker = join(root, "extension-loaded");
		writeFileSync(
			join(agentDir, "extensions", "sentinel.ts"),
			`import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(extensionMarker)}, "loaded");
export default function () { throw new Error("MCP list must not load extensions"); }
`,
		);
		const requests: { method: string; authorization: string | undefined }[] = [];
		let expectedToken: string | undefined = initialToken;
		const server = createServer((request, response) => {
			if (request.url !== "/mcp") {
				request.resume();
				response.writeHead(404).end();
				return;
			}
			if (request.method !== "POST") {
				request.resume();
				response.writeHead(405).end();
				return;
			}
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk: string) => {
				body += chunk;
			});
			request.on("end", () => {
				const message: unknown = JSON.parse(body);
				if (!isJsonRpcRequest(message) && !isJsonRpcNotification(message)) {
					response.writeHead(400).end();
					return;
				}
				requests.push({ method: message.method, authorization: request.headers.authorization });
				if (!expectedToken || request.headers.authorization !== `Bearer ${expectedToken}`) {
					response.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
					return;
				}
				if (!isJsonRpcRequest(message)) {
					response.writeHead(202).end();
					return;
				}
				let result: unknown;
				if (message.method === "initialize") {
					// Rotate before replying: the same connection's next request needs the new credential.
					expectedToken = rotatedToken;
					writeFileSync(authPath, JSON.stringify({ radius: credential(rotatedToken) }));
					result = {
						protocolVersion: LATEST_PROTOCOL_VERSION,
						capabilities: { tools: {} },
						serverInfo: { name: "radius-command-fixture", version: "1.0.0" },
					};
				} else if (message.method === "tools/list") {
					result = { tools: [{ name: "radius_search", inputSchema: { type: "object" } }] };
				} else {
					response.writeHead(400).end();
					return;
				}
				response.writeHead(200, { "Content-Type": "application/json" });
				response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
			});
		});
		const listening = Promise.withResolvers<void>();
		server.once("error", listening.reject);
		server.listen(0, "127.0.0.1", listening.resolve);
		await listening.promise;
		server.off("error", listening.reject);
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("Expected loopback address");
		const url = `http://127.0.0.1:${address.port}/mcp`;
		writeFileSync(
			join(agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { radius: { url, auth: { provider: "radius" } } } }),
		);
		writeFileSync(
			join(cwd, ".pi", "mcp.json"),
			JSON.stringify({ mcpServers: { untrusted: { command: "pi-mcp-must-not-start-untrusted-project" } } }),
		);
		const unexpectedNetwork: string[] = [];
		const originalFetch = globalThis.fetch;
		const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const requestUrl = input instanceof Request ? input.url : String(input);
			if (requestUrl !== url) {
				unexpectedNetwork.push(requestUrl);
				return Promise.reject(new Error(`Unexpected non-MCP network request: ${requestUrl}`));
			}
			return originalFetch(input, init);
		});
		const mcpOAuth = vi.spyOn(McpOAuthCredentialStore.prototype, "forServer");
		const openUrl = vi.fn(() => {
			throw new Error("MCP list must not start interactive sign-in");
		});
		const list = async () => {
			const output: string[] = [];
			const exitCode = await runMcpCommand(["list", "--json"], {
				cwd,
				agentDir,
				openUrl,
				log: (line) => output.push(line),
				error: (line) => output.push(line),
			});
			const report = JSON.parse(output.join("\n")) as {
				servers: { name: string; scope: string; source: string; state: string; tools: string[] }[];
				errors: string[];
				note?: string;
			};
			return { exitCode, report, output: output.join("\n") };
		};
		try {
			const ready = await list();
			expect(ready.exitCode, ready.output).toBe(0);
			expect(ready.report.errors).toEqual([]);
			expect(ready.report.servers).toMatchObject([
				{
					name: "radius",
					scope: "global",
					source: join(agentDir, "mcp.json"),
					state: "connected",
					tools: ["radius_search"],
				},
			]);
			expect(ready.report.servers).toHaveLength(1);
			expect(ready.report.note).toContain("ignored because the project is not trusted");
			expect(requests).toEqual([
				{ method: "initialize", authorization: `Bearer ${initialToken}` },
				{ method: "notifications/initialized", authorization: `Bearer ${rotatedToken}` },
				{ method: "tools/list", authorization: `Bearer ${rotatedToken}` },
			]);
			expect(ready.output).not.toContain(initialToken);
			expect(ready.output).not.toContain(rotatedToken);

			writeFileSync(authPath, "{}");
			expectedToken = undefined;
			requests.length = 0;
			const missing = await list();
			expect(missing.exitCode).toBe(1);
			expect(missing.report.errors).toEqual([]);
			expect(missing.report.servers).toMatchObject([{ name: "radius", state: "needs-auth", tools: [] }]);
			expect(requests).toEqual([{ method: "initialize", authorization: undefined }]);
			expect(unexpectedNetwork).toEqual([]);
			expect(openUrl).not.toHaveBeenCalled();
			expect(mcpOAuth).not.toHaveBeenCalled();
			expect(existsSync(extensionMarker)).toBe(false);
			expect(existsSync(join(agentDir, "mcp-auth.json"))).toBe(false);
			expect(existsSync(join(defaultAgentDir, "mcp-auth.json"))).toBe(false);
		} finally {
			fetch.mockRestore();
			mcpOAuth.mockRestore();
			server.closeAllConnections();
			const closed = Promise.withResolvers<void>();
			server.close((error) => (error ? closed.reject(error) : closed.resolve()));
			await closed.promise;
		}
	});

	it.each(["0.05", "1.001", "0.0001"])(
		"cancels a stalled initialize at a %s-second login deadline",
		async (seconds) => {
			const methods: unknown[] = [];
			const initialized = Promise.withResolvers<void>();
			const deadline = new AbortController();
			const originalTimeout = AbortSignal.timeout;
			const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
				// Keep Node's integer/range validation, but release the deadline only after initialize arrives.
				const signal = originalTimeout(milliseconds);
				return milliseconds === Math.max(1, Math.ceil(Number(seconds) * 1000)) ? deadline.signal : signal;
			});
			const server = createServer((request, response) => {
				if (request.method === "POST") {
					let body = "";
					request.setEncoding("utf8");
					request.on("data", (chunk: string) => {
						body += chunk;
					});
					request.on("end", () => {
						const message: unknown = JSON.parse(body);
						if (message !== null && typeof message === "object" && "method" in message) {
							methods.push(message.method);
							if (message.method === "initialize") initialized.resolve();
						}
					});
				} else response.end();
			});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			try {
				const address = server.address();
				if (address === null || typeof address === "string") throw new Error("Expected loopback address");
				let settled = false;
				const pending = run(["login", "stalled", "--timeout", seconds], {
					stalled: { url: `http://127.0.0.1:${address.port}/mcp`, timeout: 2 },
				}).finally(() => {
					settled = true;
				});
				await Promise.race([
					initialized.promise,
					pending.then(() => {
						throw new Error("Login settled before initialize reached the server");
					}),
				]);
				expect(settled).toBe(false);
				deadline.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
				const result = await pending;
				expect(result.exitCode).toBe(1);
				expect(methods).toContain("initialize");
				expect(result.output).toContain("timed out before connection completed.");
			} finally {
				timeout.mockRestore();
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			}
		},
	);

	it.each(["2147483.648", "1e308"])("rejects an unsupported %s-second login timeout normally", async (seconds) => {
		const result = await run(["login", "example", "--timeout", seconds], {
			example: { url: "http://127.0.0.1:1/mcp" },
		});
		expect(result).toMatchObject({
			exitCode: 1,
			output: "--timeout must not exceed 2147483.647 seconds.",
		});
	});

	it("rejects unknown servers and servers without OAuth for login and logout", async () => {
		expect(await run(["login", "nope"], servers)).toMatchObject({
			exitCode: 1,
			output: 'No MCP server named "nope". Configured: fixture, broken, parked.',
		});
		expect(await run(["logout", "fixture"], servers)).toMatchObject({
			exitCode: 1,
			output: 'MCP server "fixture" does not use OAuth. Only HTTP servers without an Authorization header do.',
		});
		expect((await run(["frobnicate"], servers)).exitCode).toBe(1);
	});

	it("adds stdio servers and passes options after the command through", async () => {
		const added = await run(
			["add", "--env", "A=1", "--env", "B=x=y", "files", "--", "npx", "-y", "server", "--root", "."],
			undefined,
		);
		expect(added.exitCode).toBe(0);
		expect(added.output).toContain('Added global MCP server "files"');
		expect(readConfig(join(added.agentDir, "mcp.json"))).toEqual({
			mcpServers: {
				files: { command: "npx", args: ["-y", "server", "--root", "."], env: { A: "1", B: "x=y" } },
			},
		});

		// Without `--`, options after the command belong to the command too.
		const replaced = await run(["add", "files", "node", "server.js", "--port", "1"], undefined, added.agentDir);
		expect(replaced.output).toContain('Replaced global MCP server "files"');
		expect(readConfig(join(added.agentDir, "mcp.json"))).toEqual({
			mcpServers: { files: { command: "node", args: ["server.js", "--port", "1"] } },
		});
	});

	it("adds HTTP servers and keeps other content of the file", async () => {
		const { exitCode, output, agentDir } = await run(
			[
				"add",
				"docs",
				"--url",
				"https://example.com/mcp",
				"--bearer-token-env-var",
				"DOCS_TOKEN",
				"--header",
				"X-Team=core",
				"--exposure",
				"direct",
				"--description",
				"Product docs",
			],
			{ fixture: servers.fixture },
		);
		expect(exitCode).toBe(0);
		expect(output).not.toContain("mcp login");
		expect(readConfig(join(agentDir, "mcp.json"))).toEqual({
			mcpServers: {
				fixture: servers.fixture,
				docs: {
					url: "https://example.com/mcp",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: literal config value reference
					headers: { "X-Team": "core", Authorization: "Bearer ${DOCS_TOKEN}" },
					exposure: "direct",
					description: "Product docs",
				},
			},
		});

		const oauth = await run(
			[
				"add",
				"sentry",
				"--url",
				"https://mcp.sentry.dev/mcp",
				"--oauth-client-id",
				"pi",
				"--oauth-client-name",
				"Claude Code",
			],
			undefined,
			agentDir,
		);
		expect(oauth.output).toContain("If it requires sign-in: pi mcp login sentry");
		expect(readConfig(join(agentDir, "mcp.json")).mcpServers).toMatchObject({
			sentry: { url: "https://mcp.sentry.dev/mcp", oauth: { clientId: "pi", clientName: "Claude Code" } },
		});
	});

	it("rejects invalid add invocations without writing", async () => {
		const cases = [
			["add", "x"],
			["add", "x", "--url", "https://example.com", "--", "cmd"],
			["add", "bad name", "--", "cmd"],
			["add", "x", "--url", "ftp://example.com"],
			["add", "x", "--env", "A=1", "--url", "https://example.com"],
			["add", "x", "--header", "A=1", "--", "cmd"],
			["add", "x", "--env", "NOVALUE", "--", "cmd"],
			["add", "x", "--exposure", "loud", "--", "cmd"],
		];
		for (const args of cases) {
			const result = await run(args, undefined);
			expect(result.exitCode, args.join(" ")).toBe(1);
			expect(existsSync(join(result.agentDir, "mcp.json"))).toBe(false);
		}
	});

	it("adds and removes project servers", async () => {
		const added = await run(["add", "-l", "local", "--", "node", "server.js"], undefined);
		expect(added.output).toContain("The project is not trusted");
		const projectConfig = join(added.agentDir, ".pi", "mcp.json");
		expect(readConfig(projectConfig)).toEqual({ mcpServers: { local: { command: "node", args: ["server.js"] } } });

		const wrongScope = await run(["remove", "local"], undefined, added.agentDir);
		expect(wrongScope.exitCode).toBe(1);
		expect(wrongScope.output).toContain(`It is defined in ${projectConfig}; use --local.`);

		const removed = await run(["remove", "local", "--local"], undefined, added.agentDir);
		expect(removed.exitCode).toBe(0);
		expect(removed.output).toContain('Removed project MCP server "local"');
		expect(readConfig(projectConfig)).toEqual({ mcpServers: {} });
	});

	it("removes global servers", async () => {
		const { exitCode, agentDir } = await run(["remove", "broken"], servers);
		expect(exitCode).toBe(0);
		expect(Object.keys(readConfig(join(agentDir, "mcp.json")).mcpServers as object)).toEqual([
			"fixture",
			"parked",
			"bad",
		]);
		const missing = await run(["remove", "broken"], undefined, agentDir);
		expect(missing).toMatchObject({ exitCode: 1 });
		expect(missing.output).toContain('No global MCP server named "broken"');
	});
});
