import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer, Socket } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Connection, nodePlatform } from "../src/connection.ts";
import { LocalExecutionEnv } from "../src/list-files.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import {
	acceptHostKey,
	connectSsh,
	deployDaemon,
	detectPlatform,
	forgetHostKey,
	HostKeyChangedError,
	HostKeyUnknownError,
	launchCommand,
	type SshTarget,
	scanHostKey,
	sshArguments,
	sshConnection,
} from "../src/ssh.ts";
import { daemon } from "./daemon.ts";

/** The deployed daemon is named by its content. */
const deployedName = `pi-env-${createHash("sha256").update(readFileSync(daemon)).digest("hex").slice(0, 32)}`;
const context = BACKGROUND_CONTEXT;

function which(program: string): string | undefined {
	try {
		return execFileSync("sh", ["-c", `command -v ${program}`], { encoding: "utf8" }).trim() || undefined;
	} catch {
		return undefined;
	}
}

const sshd =
	process.platform === "win32"
		? undefined
		: (which("sshd") ?? (existsSync("/usr/sbin/sshd") ? "/usr/sbin/sshd" : undefined));
const fish = process.platform === "win32" ? undefined : which("fish");
const gnuSha256 =
	process.platform === "win32"
		? undefined
		: [which("sha256sum"), which("gsha256sum")].find((program) => {
				if (!program) return false;
				try {
					return execFileSync(program, ["--version"], { encoding: "utf8" }).includes("GNU coreutils");
				} catch {
					return false;
				}
			});

// #34: execute SSH's joined remote command in the actual shell, without requiring a running sshd.
describe.skipIf(process.platform === "win32")("SSH remote shell compatibility", () => {
	it.skipIf(gnuSha256 === undefined)("verifies a backslash home with GNU sha256sum on upload and reuse", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-env-gnu-hash-"));
		const home = join(root, "home \\with spaces");
		const bin = join(root, "bin");
		const ssh = join(root, "ssh");
		mkdirSync(bin);
		// Force the real GNU implementation even if the host normally prefers shasum or another utility.
		writeFileSync(join(bin, "sha256sum"), `#!/bin/sh\nexec '${gnuSha256!.replaceAll("'", "'\\''")}' "$@"\n`, {
			mode: 0o700,
		});
		writeFileSync(
			ssh,
			[
				`#!${process.execPath}`,
				'const { spawnSync } = require("node:child_process");',
				'const command = process.argv.slice(process.argv.indexOf("--") + 2).join(" ");',
				`const result = spawnSync("sh", ["-c", command], { stdio: "inherit", env: { ...process.env, PATH: ${JSON.stringify(bin)} + ":" + process.env.PATH } });`,
				"if (result.error) throw result.error; process.exit(result.status ?? 1);",
			].join("\n"),
			{ mode: 0o700 },
		);
		const target: SshTarget = {
			host: "gnu-hash",
			hostKeyAlias: "gnu-hash",
			knownHostsFile: join(root, "known_hosts"),
			ssh,
		};
		const remote = { platform: "linux" as const, arch: "arm64" as const, home, warnings: [] };
		try {
			const deployed = await deployDaemon(target, remote, daemon);
			expect(readFileSync(deployed)).toEqual(readFileSync(daemon));
			const before = statSync(deployed).mtimeMs;
			expect(await deployDaemon(target, remote, daemon)).toBe(deployed);
			expect(statSync(deployed).mtimeMs).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	for (const shell of ["sh", "fish"] as const) {
		it.skipIf(shell === "fish" && fish === undefined)(
			`detects, deploys and forwards daemon arguments through ${shell}`,
			async () => {
				const root = mkdtempSync(join(tmpdir(), "pi-env-shell-"));
				const home = join(root, "home 'with' \\slashes $and spaces");
				const program = shell === "fish" ? fish! : which("sh")!;
				const ssh = join(root, "ssh");
				mkdirSync(join(home, ".config/fish"), { recursive: true });
				writeFileSync(
					join(home, ".config/fish/config.fish"),
					"if status is-login; set -gx PI_ENV_FISH_LOGIN yes; end\n",
				);
				writeFileSync(
					ssh,
					[
						`#!${process.execPath}`,
						'const { spawnSync } = require("node:child_process");',
						'const command = process.argv.slice(process.argv.indexOf("--") + 2).join(" ");',
						`const result = spawnSync(${JSON.stringify(program)}, ["-c", command], {`,
						'  stdio: "inherit",',
						`  env: { ...process.env, HOME: ${JSON.stringify(home)}, SHELL: ${JSON.stringify(program)},`,
						`    XDG_CONFIG_HOME: ${JSON.stringify(join(home, ".config"))}, PI_ENV_FISH_LOGIN: "" },`,
						"});",
						"if (result.error) throw result.error;",
						"process.exit(result.status ?? 1);",
					].join("\n"),
					{ mode: 0o700 },
				);
				const target: SshTarget = {
					host: "shell-test",
					hostKeyAlias: "shell-test",
					knownHostsFile: join(root, "known_hosts"),
					ssh,
				};
				try {
					for (const loginShell of [false, true]) {
						const { connection, remote } = await connectSsh({ ...target, binary: daemon, loginShell });
						try {
							expect(remote.home).toBe(home);
							// A real hello authenticates the forwarded serve/--token/token arguments.
							expect((await connection.info()).home).toBe(home);
							const env = new RemoteExecutionEnv({ connection, id: "pi-env:shell-test", cwd: home });
							const output: string[] = [];
							const result = getOrThrow(
								await env.exec(
									["sh", "-c", 'printf "%s" "$PI_ENV_FISH_LOGIN"'],
									{ onOutput: (text) => output.push(text) },
									context,
								),
							);
							expect(result.exitCode).toBe(0);
							expect(output.join("")).toBe(shell === "fish" && loginShell ? "yes" : "");
						} finally {
							connection.close();
						}
					}
				} finally {
					rmSync(root, { recursive: true, force: true });
				}
			},
			60_000,
		);
	}
});

async function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer().listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

describe.skipIf(process.platform === "win32")("Windows POSIX SSH shells", () => {
	for (const system of ["MINGW64_NT-10.0", "MSYS_NT-10.0", "CYGWIN_NT-10.0"]) {
		it(`launches the daemon through ${system} using native Windows platform details`, async () => {
			const root = mkdtempSync(join(tmpdir(), "pi-env-windows-posix-"));
			const home = "C:\\Users\\home 'quoted' with spaces";
			const file = `${home.replaceAll("\\", "/")}/.pi/mobile/tools/${deployedName}.exe`;
			const ssh = join(root, "ssh");
			mkdirSync(join(root, file, ".."), { recursive: true });
			copyFileSync(daemon, join(root, file));
			writeFileSync(
				ssh,
				[
					`#!${process.execPath}`,
					'const { spawnSync } = require("node:child_process");',
					'const command = process.argv.slice(process.argv.indexOf("--") + 2).join(" ");',
					`if (command.startsWith("sh -c ")) { console.log(${JSON.stringify(`PI-ENV-PROBE\n${system}\nx86_64\n-\n/home/posix\n-\n-`)}); process.exit(0); }`,
					`if (command.startsWith("powershell ")) { const script = Buffer.from(command.split(" ").at(-1), "base64").toString("utf16le"); console.log(script.includes("PI-ENV-PROBE") ? ${JSON.stringify(`PI-ENV-PROBE\nWindows\nARM64\n-\n${home}\n-\n-`)} : "present"); process.exit(0); }`,
					'if (command === "echo %OS%") { console.log("%OS%"); process.exit(0); }',
					"if (command.startsWith('\"PI-ENV-POWERSHELL-\"')) { process.exit(1); }",
					`const result = spawnSync("sh", ["-c", command], { cwd: ${JSON.stringify(root)}, stdio: "inherit" });`,
					"if (result.error) throw result.error; process.exit(result.status ?? 1);",
				].join("\n"),
				{ mode: 0o700 },
			);
			let connection: Connection | undefined;
			try {
				const connected = await connectSsh({
					host: "windows-posix",
					hostKeyAlias: "windows-posix",
					knownHostsFile: join(root, "known_hosts"),
					ssh,
					binary: daemon,
				});
				connection = connected.connection;
				expect(connected.remote).toMatchObject({ platform: "windows", arch: "arm64", home, shell: "posix" });
				expect((await connection.info()).protocol).toBe(1);
			} finally {
				connection?.close();
				rmSync(root, { recursive: true, force: true });
			}
		});
	}
	for (const shell of ["powershell", "cmd"] as const) {
		it(`keeps the outer ${shell} shell when child sh reports MINGW`, async () => {
			const root = mkdtempSync(join(tmpdir(), "pi-env-native-shell-"));
			const ssh = join(root, "ssh");
			const home = "C:\\Users\\native home";
			writeFileSync(
				ssh,
				[
					`#!${process.execPath}`,
					'const command = process.argv.slice(process.argv.indexOf("--") + 2).join(" ");',
					`if (command.startsWith("sh -c ")) { console.log("PI-ENV-PROBE\\nMINGW64_NT-10.0\\nx86_64\\n-\\n/home/child\\n-\\n-"); process.exit(0); }`,
					`if (command.startsWith("powershell ")) { console.log(${JSON.stringify(`PI-ENV-PROBE\nWindows\nARM64\n-\n${home}\n-\n-`)}); process.exit(0); }`,
					`if (command === "echo %OS%") { console.log(${JSON.stringify(shell === "cmd" ? "Windows_NT" : "%OS%")}); process.exit(0); }`,
					`if (command.startsWith('"PI-ENV-POWERSHELL-"')) { console.log("PI-ENV-POWERSHELL-5"); process.exit(0); }`,
					'console.error("Unexpected SSH command: " + command); process.exit(1);',
				].join("\n"),
				{ mode: 0o700 },
			);
			try {
				expect(
					await detectPlatform({
						host: "native-shell",
						hostKeyAlias: "native-shell",
						knownHostsFile: join(root, "known_hosts"),
						ssh,
					}),
				).toMatchObject({
					platform: "windows",
					arch: "arm64",
					home,
					shell,
				});
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}
});

describe.skipIf(process.platform !== "win32")("Windows cmd daemon launch", () => {
	for (const name of ["A&B", "native home"]) {
		it(`authenticates a daemon launched by cmd from ${name}`, async () => {
			const root = mkdtempSync(join(tmpdir(), "pi-env-cmd-"));
			// Relative to the transport's cwd so an unrelated space in the local temp directory cannot mask A&B.
			const home = name;
			const file = join(home, ".pi", "mobile", "tools", `${deployedName}.exe`);
			mkdirSync(join(root, file, ".."), { recursive: true });
			copyFileSync(daemon, join(root, file));
			const launch = launchCommand(
				{ platform: "windows", arch: "x64", home, shell: "cmd", warnings: [] },
				file,
				false,
			);
			// Model OpenSSH's joined command using the real native cmd interpreter, not a shell emulator.
			const script = [
				'const { spawn } = require("node:child_process");',
				`const command = ${JSON.stringify(launch)} + " " + process.argv.slice(1).join(" ");`,
				`const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", '"' + command + '"'], { cwd: ${JSON.stringify(root)}, stdio: "inherit", windowsVerbatimArguments: true });`,
				'child.on("error", error => { console.error(error); process.exit(1); });',
				'child.on("exit", code => process.exit(code ?? 1));',
			].join("\n");
			const connection = new Connection({ command: [process.execPath, "-e", script, "--"] });
			try {
				const info = await connection.info();
				expect(info.protocol).toBe(1);
				expect(nodePlatform(info).platform).toBe("win32");
			} finally {
				connection.close();
				rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
			}
		}, 70_000);
	}
});

async function waitForPort(port: number): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const open = await new Promise<boolean>((resolve) => {
			const socket = new Socket();
			socket.once("connect", () => resolve(true)).once("error", () => resolve(false));
			socket.connect(port, "127.0.0.1");
		}).finally(() => undefined);
		if (open) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("sshd did not start");
}

// A disposable sshd on localhost with its own host key, client key and home directory.
describe.skipIf(sshd === undefined)("SSH bootstrap", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-env-ssh-"));
	const home = join(root, "home");
	let server: ChildProcess | undefined;
	let target: SshTarget;

	beforeAll(async () => {
		execFileSync("mkdir", ["-p", home]);
		execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(root, "host_key")]);
		execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(root, "client_key")]);
		writeFileSync(join(root, "authorized_keys"), readFileSync(join(root, "client_key.pub")));
		const port = await freePort();
		writeFileSync(
			join(root, "sshd_config"),
			[
				`Port ${port}`,
				"ListenAddress 127.0.0.1",
				`HostKey ${join(root, "host_key")}`,
				`AuthorizedKeysFile ${join(root, "authorized_keys")}`,
				`PidFile ${join(root, "sshd.pid")}`,
				"PasswordAuthentication no",
				"KbdInteractiveAuthentication no",
				"StrictModes no",
				`SetEnv HOME=${home}`,
				"",
			].join("\n"),
		);
		writeFileSync(join(root, "ssh_config"), "");
		server = spawn(sshd!, ["-D", "-e", "-f", join(root, "sshd_config")], { stdio: "ignore" });
		await waitForPort(port);
		target = {
			host: "127.0.0.1",
			port,
			user: userInfo().username,
			identityFile: join(root, "client_key"),
			knownHostsFile: join(root, "known_hosts"),
			hostKeyAlias: "pi-env-test",
			configFile: join(root, "ssh_config"),
		};
	});

	afterAll(() => {
		server?.kill();
		rmSync(root, { recursive: true, force: true });
	});

	it("requires application acceptance even when SSH config supplies the server key", async () => {
		const configFile = join(root, "alternate-trust-config");
		const keys = join(root, "command_known_hosts");
		const key = readFileSync(join(root, "host_key.pub"), "utf8").split(" ").slice(0, 2).join(" ");
		const scoped: SshTarget = {
			...target,
			host: "alternate-trust-route",
			knownHostsFile: join(root, "alternate-trust-known-hosts"),
			configFile,
		};
		writeFileSync(keys, `${scoped.hostKeyAlias} ${key}\n`);
		writeFileSync(
			configFile,
			[
				`Host ${scoped.host}`,
				"  HostName 127.0.0.1",
				`  KnownHostsCommand /bin/cat ${keys}`,
				"  VerifyHostKeyDNS yes",
				"",
			].join("\n"),
		);
		const args = sshArguments(scoped);
		// Exercise OpenSSH's resolved configuration, including the retained route, not just argv spelling.
		const configured = execFileSync("ssh", ["-G", ...args], { encoding: "utf8" });
		expect(configured).toMatch(/^hostname 127\.0\.0\.1$/m);
		// Prove the configured command really can authenticate this server in the absence of our override.
		const inherited = args.flatMap((argument, index) => {
			if (argument === "-o" && args[index + 1] === "KnownHostsCommand=none") return [];
			return argument === "KnownHostsCommand=none" ? [] : [argument];
		});
		expect(execFileSync("ssh", [...inherited, "echo alternate-trust"], { encoding: "utf8" }).trim()).toBe(
			"alternate-trust",
		);
		await expect(detectPlatform(scoped)).rejects.toBeInstanceOf(HostKeyUnknownError);
		expect(configured).toMatch(/^verifyhostkeydns (?:false|no)$/m);
		await acceptHostKey(scoped, [`${scoped.hostKeyAlias} ${key}`]);
		const { connection, remote } = await connectSsh({ ...scoped, binary: daemon });
		try {
			expect(remote.home).toBe(home);
			expect((await connection.info()).home).toBe(home);
		} finally {
			connection.close();
		}
	}, 60_000);

	it("refuses an untrusted host, then deploys and runs the daemon once its key is accepted", async () => {
		await expect(connectSsh({ ...target, binary: daemon })).rejects.toBeInstanceOf(HostKeyUnknownError);

		const scanned = await scanHostKey(target);
		const expected = execFileSync("ssh-keygen", ["-lf", join(root, "host_key.pub")], { encoding: "utf8" }).split(
			" ",
		)[1];
		expect(scanned.fingerprints.join("\n")).toContain(expected);
		await acceptHostKey(target, scanned.lines);

		mkdirSync(join(home, ".pi/mobile/tools"), { recursive: true });
		writeFileSync(join(home, ".pi/mobile/tools/pi-env-0123456789abcdef0123456789abcdef"), "old");
		const { connection, remote } = await connectSsh({ ...target, binary: daemon });
		try {
			expect(remote.home).toBe(home);
			expect(readFileSync(join(home, ".pi/mobile/tools", deployedName)).equals(readFileSync(daemon))).toBe(true);
			const env = new RemoteExecutionEnv({ connection, id: "pi-env:test", cwd: home });
			getOrThrow(await env.writeFile("over-ssh.txt", "hello", context));
			expect(getOrThrow(await env.readTextFile("over-ssh.txt", context))).toBe("hello");
			const output: string[] = [];
			const result = getOrThrow(
				await env.exec(["sh", "-c", 'printf "%s" "$HOME"'], { onOutput: (text) => output.push(text) }, context),
			);
			expect(result.exitCode).toBe(0);
			expect(output.join("")).toBe(home);
		} finally {
			connection.close();
		}
	}, 60_000);

	it("reuses a verified daemon and replaces a tampered one", async () => {
		const file = join(home, ".pi/mobile/tools", deployedName);
		const before = statSync(file).mtimeMs;
		(await connectSsh({ ...target, binary: daemon })).connection.close();
		expect(statSync(file).mtimeMs).toBe(before);

		writeFileSync(file, "tampered");
		const { connection } = await connectSsh({ ...target, binary: daemon });
		try {
			expect(readFileSync(file).equals(readFileSync(daemon))).toBe(true);
			expect((await connection.info()).home).toBe(home);
		} finally {
			connection.close();
		}
	}, 60_000);

	it("starts a pending connection after a different daemon build is deployed", async () => {
		await acceptHostKey(target, (await scanHostKey(target)).lines);
		const alternate = join(root, "alternate-daemon");
		// Trailing data leaves the native executable runnable but gives it a distinct content address.
		writeFileSync(alternate, Buffer.concat([readFileSync(daemon), Buffer.from("\npi-env alternate build\n")]));
		const first = await connectSsh({ ...target, binary: daemon });
		let second: Connection | undefined;
		try {
			second = (await connectSsh({ ...target, binary: alternate })).connection;
			expect(readFileSync(join(home, ".pi/mobile/tools", deployedName)).equals(readFileSync(daemon))).toBe(true);
			const [a, b] = await Promise.all([first.connection.info(), second.info()]);
			expect(a.home).toBe(home);
			expect(b.home).toBe(home);
			const env = new RemoteExecutionEnv({ connection: first.connection, id: "pi-env:pending", cwd: home });
			getOrThrow(await env.writeFile("pending-start.txt", "both builds survive", context));
			expect(getOrThrow(await env.readTextFile("pending-start.txt", context))).toBe("both builds survive");
		} finally {
			first.connection.close();
			second?.close();
		}
	}, 60_000);

	it("verifies the daemon again before starting it after a lost connection", async () => {
		const { connection } = await connectSsh({ ...target, binary: daemon });
		const file = join(home, ".pi/mobile/tools", deployedName);
		try {
			const { pid } = await connection.info();
			process.kill(pid, "SIGKILL");
			await new Promise((done) => setTimeout(done, 300));
			// Linux refuses to write a running program's file.
			writeFileSync(file, "tampered");
			// The next start redeploys the verified binary instead of running whatever is there.
			expect((await connection.info()).pid).not.toBe(pid);
			expect(readFileSync(file).equals(readFileSync(daemon))).toBe(true);
		} finally {
			connection.close();
		}
	}, 60_000);

	it("lists files over SSH as the local environment lists them", async () => {
		const tree = join(home, "tree");
		for (const file of ["a/b.txt", "a/c/d.txt", ".hidden", "out/x.js", "skip/y.txt", ".git/HEAD"]) {
			mkdirSync(join(tree, file, ".."), { recursive: true });
			writeFileSync(join(tree, file), "");
		}
		mkdirSync(join(tree, "empty"));
		writeFileSync(join(tree, ".gitignore"), "out/\n");
		const { connection } = await connectSsh({ ...target, binary: daemon });
		const local = new Connection({ command: [daemon] });
		try {
			const remote = new RemoteExecutionEnv({ connection, id: "pi-env:test", cwd: home });
			const listing = getOrThrow(await remote.listFiles("tree", { exclude: ["skip"] }, context));
			expect(listing).toEqual({
				entries: [
					{ path: ".gitignore", kind: "file" },
					{ path: ".hidden", kind: "file" },
					{ path: "a", kind: "directory" },
					{ path: "a/b.txt", kind: "file" },
					{ path: "a/c", kind: "directory" },
					{ path: "a/c/d.txt", kind: "file" },
					{ path: "empty", kind: "directory" },
				],
				truncated: false,
			});
			const env = new LocalExecutionEnv({ connection: local, cwd: home });
			expect(getOrThrow(await env.listFiles("tree", { exclude: ["skip"] }, context))).toEqual(listing);
		} finally {
			connection.close();
			local.close();
		}
	}, 60_000);

	it("starts the daemon through the login shell only when asked", async () => {
		// The login shell is the account's shell: sh and bash read .profile, zsh (the macOS default) reads .zprofile.
		writeFileSync(join(home, ".profile"), "export PI_ENV_LOGIN=yes\n");
		writeFileSync(join(home, ".zprofile"), "export PI_ENV_LOGIN=yes\n");
		mkdirSync(join(home, ".config/fish"), { recursive: true });
		writeFileSync(join(home, ".config/fish/config.fish"), "if status is-login; set -gx PI_ENV_LOGIN yes; end\n");
		const login = async (loginShell: boolean) => {
			const { connection } = await connectSsh({ ...target, binary: daemon, loginShell });
			try {
				const env = new RemoteExecutionEnv({ connection, id: "pi-env:test", cwd: home });
				const output: string[] = [];
				getOrThrow(
					await env.exec(
						["sh", "-c", 'printf "%s" "$PI_ENV_LOGIN"'],
						{ onOutput: (text) => output.push(text) },
						context,
					),
				);
				return output.join("");
			} finally {
				connection.close();
			}
		};
		expect(await login(false)).toBe("");
		expect(await login(true)).toBe("yes");
	}, 60_000);

	// #34: sshd's forced command supplies a fish remote shell without changing the account's login shell.
	it.skipIf(fish === undefined)(
		"starts a fish login shell over real SSH and preserves its environment",
		async () => {
			const fishHome = join(root, "fish-home");
			mkdirSync(join(fishHome, ".config/fish"), { recursive: true });
			writeFileSync(
				join(fishHome, ".config/fish/config.fish"),
				"if status is-login; set -gx PI_ENV_FISH_LOGIN yes; end\n",
			);
			const wrapper = join(root, "fish-remote");
			const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
			writeFileSync(
				wrapper,
				[
					"#!/bin/sh",
					`export HOME=${quote(fishHome)}`,
					`export XDG_CONFIG_HOME=${quote(join(fishHome, ".config"))}`,
					`export SHELL=${quote(fish!)}`,
					'exec "$SHELL" -c "$SSH_ORIGINAL_COMMAND"',
				].join("\n"),
				{ mode: 0o700 },
			);
			const authorized = join(root, "authorized_keys");
			const original = readFileSync(authorized);
			writeFileSync(authorized, `command="${wrapper}" ${original.toString("utf8")}`);
			try {
				await acceptHostKey(target, (await scanHostKey(target)).lines);
				const { connection, remote } = await connectSsh({ ...target, binary: daemon, loginShell: true });
				try {
					expect(remote.home).toBe(fishHome);
					expect((await connection.info()).home).toBe(fishHome);
					const env = new RemoteExecutionEnv({ connection, id: "pi-env:fish-ssh", cwd: fishHome });
					const output: string[] = [];
					const result = getOrThrow(
						await env.exec(
							["sh", "-c", 'printf "%s" "$PI_ENV_FISH_LOGIN"'],
							{ onOutput: (text) => output.push(text) },
							context,
						),
					);
					expect(result.exitCode).toBe(0);
					expect(output.join("")).toBe("yes");
				} finally {
					connection.close();
				}
			} finally {
				writeFileSync(authorized, original);
			}
		},
		60_000,
	);

	it("connects lazily and reports a failed start as the error of the operation", async () => {
		const lazyTarget = { ...target, knownHostsFile: join(root, "lazy_known_hosts") };
		const { connection, remote } = sshConnection({ ...lazyTarget, binary: daemon });
		try {
			expect(remote()).toBeUndefined();
			const env = new RemoteExecutionEnv({ connection, id: "pi-env:test", cwd: home });
			// Nothing is trusted yet: each operation fails with the reason and tries again.
			const read = await env.readTextFile("missing.txt", context);
			expect(read.ok ? "ok" : read.error.message).toMatch(/not trusted/);
			const command = await env.exec(["sh", "-c", "exit 0"], undefined, context);
			expect(command.ok ? "ok" : command.error.code).toBe("spawn_error");
			await acceptHostKey(lazyTarget, (await scanHostKey(lazyTarget)).lines);
			const accepted = await env.exec(["sh", "-c", "exit 0"], undefined, context);
			expect(accepted.ok ? accepted.value.exitCode : accepted.error.message).toBe(0);
			expect(remote()?.home).toBe(home);
		} finally {
			connection.close();
		}
	}, 60_000);

	it("accepts only host keys for the alias and never replaces a trusted key silently", async () => {
		const knownHosts = join(root, "accept_known_hosts");
		const scoped = { ...target, knownHostsFile: knownHosts };
		const key = (name: string) => {
			const file = join(root, name);
			execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", file]);
			return readFileSync(`${file}.pub`, "utf8").split(" ").slice(0, 2).join(" ");
		};
		const first = key("accept_first");
		const second = key("accept_second");
		await expect(acceptHostKey(scoped, [`other-alias ${first}`])).rejects.toThrow();
		await expect(acceptHostKey(scoped, [`@cert-authority pi-env-test ${first}`])).rejects.toThrow();
		await Promise.all([
			acceptHostKey(scoped, [`pi-env-test ${first}`]),
			acceptHostKey(scoped, [`pi-env-test ${first}`]),
		]);
		expect(readFileSync(knownHosts, "utf8")).toBe(`pi-env-test ${first}\n`);
		await expect(acceptHostKey(scoped, [`pi-env-test ${second}`])).rejects.toBeInstanceOf(HostKeyChangedError);
		await forgetHostKey(scoped);
		await acceptHostKey(scoped, [`pi-env-test ${second}`]);
		expect(readFileSync(knownHosts, "utf8")).toBe(`pi-env-test ${second}\n`);
	});

	it("refuses a changed host key", async () => {
		const other = join(root, "other_key");
		execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", other]);
		const key = readFileSync(`${other}.pub`, "utf8").split(" ").slice(0, 2).join(" ");
		const knownHosts = join(root, "changed_known_hosts");
		writeFileSync(knownHosts, `pi-env-test ${key}\n`);
		await expect(connectSsh({ ...target, knownHostsFile: knownHosts, binary: daemon })).rejects.toBeInstanceOf(
			HostKeyChangedError,
		);
	}, 60_000);
});
