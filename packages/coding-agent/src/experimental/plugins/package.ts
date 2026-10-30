import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ServerId } from "@earendil-works/pi-protocol";
import { build } from "esbuild";

const PLUGIN_PACKAGE_PROFILE_VERSION = 1;
const DEFAULT_PLUGIN_FACETS = Object.freeze({ session: "src/session.ts", tui: "src/tui.ts" });

export const FACET_BUNDLE_MANIFEST_FILE = "pi-plugin-facets.json";
export const FACET_BUNDLE_ARTIFACT_FORMAT = "pi-plugin-facet";
export const FACET_BUNDLE_ARTIFACT_FORMAT_VERSION = 1;

export interface FacetBundleEntry {
	readonly file: string;
	readonly integrity: string;
	readonly externalImports: readonly string[];
}

export interface FacetBundleManifest {
	readonly plugin: { readonly id: string; readonly version?: string };
	readonly entries: Readonly<Record<string, FacetBundleEntry>>;
}

export interface FacetBundleArtifact {
	readonly format: typeof FACET_BUNDLE_ARTIFACT_FORMAT;
	readonly formatVersion: typeof FACET_BUNDLE_ARTIFACT_FORMAT_VERSION;
	readonly plugin: FacetBundleManifest["plugin"];
	readonly entryName: string;
	readonly entry: FacetBundleEntry;
	readonly source: string;
}

export async function readFacetBundleManifest(path: string): Promise<FacetBundleManifest> {
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (
		value === null ||
		typeof value !== "object" ||
		!("plugin" in value) ||
		!("entries" in value) ||
		value.plugin === null ||
		typeof value.plugin !== "object" ||
		!("id" in value.plugin) ||
		typeof value.plugin.id !== "string" ||
		value.plugin.id.length === 0 ||
		value.entries === null ||
		typeof value.entries !== "object" ||
		Array.isArray(value.entries)
	) {
		throw new Error(`Invalid plugin facet manifest ${path}`);
	}
	for (const entry of Object.values(value.entries)) {
		if (
			entry === null ||
			typeof entry !== "object" ||
			typeof entry.file !== "string" ||
			basename(entry.file) !== entry.file ||
			typeof entry.integrity !== "string" ||
			!Array.isArray(entry.externalImports) ||
			entry.externalImports.some((item: unknown) => typeof item !== "string")
		) {
			throw new Error(`Invalid plugin facet entry in ${path}`);
		}
	}
	return value as FacetBundleManifest;
}

async function bundlePluginPackage(packagePath: string, outdir: string): Promise<FacetBundleManifest> {
	const directory = basename(packagePath) === "package.json" ? dirname(packagePath) : packagePath;
	const metadata: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
	if (
		metadata === null ||
		typeof metadata !== "object" ||
		!("name" in metadata) ||
		typeof metadata.name !== "string" ||
		("version" in metadata && typeof metadata.version !== "string")
	)
		throw new Error(`Invalid plugin package ${directory}`);
	let configuredFacets: Record<string, unknown> = {};
	if ("chord" in metadata) {
		const chord = metadata.chord;
		if (chord === null || typeof chord !== "object" || Array.isArray(chord))
			throw new Error(`Invalid chord metadata in plugin package ${directory}`);
		if ("facets" in chord) {
			if (chord.facets === null || typeof chord.facets !== "object" || Array.isArray(chord.facets))
				throw new Error(`Invalid chord.facets in plugin package ${directory}`);
			configuredFacets = chord.facets as Record<string, unknown>;
		}
	}
	const entries: Record<string, FacetBundleEntry> = {};
	await mkdir(outdir, { recursive: true });
	for (const [name, conventional] of Object.entries(DEFAULT_PLUGIN_FACETS)) {
		const relative = Object.hasOwn(configuredFacets, name) ? configuredFacets[name] : conventional;
		if (relative === false) continue;
		if (typeof relative !== "string" || relative.length === 0)
			throw new Error(`Invalid chord.facets.${name} in plugin package ${directory}`);
		const path = resolve(directory, relative);
		try {
			await stat(path);
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT" &&
				!Object.hasOwn(configuredFacets, name)
			)
				continue;
			throw error;
		}
		const result = await build({
			entryPoints: [path],
			bundle: true,
			write: false,
			format: "esm",
			platform: "node",
			target: "node22",
			external: [
				"@earendil-works/chord",
				"@earendil-works/chord/*",
				"@earendil-works/pi-coding-agent/experimental/plugin",
				"typebox",
				"typebox/*",
			],
			metafile: true,
		});
		const source = result.outputFiles[0]!.text;
		const file = `${name}.mjs`;
		entries[name] = {
			file,
			integrity: `sha256-${createHash("sha256").update(source).digest("base64")}`,
			externalImports: [
				...new Set(
					Object.values(result.metafile.outputs).flatMap((output) =>
						output.imports.filter((item) => item.external).map((item) => item.path),
					),
				),
			],
		};
		await writeFile(join(outdir, file), source, "utf8");
	}
	if (Object.keys(entries).length === 0)
		throw new Error(`Plugin package ${directory} has no enabled session or tui entry`);
	const manifest: FacetBundleManifest = {
		plugin: { id: metadata.name, ...("version" in metadata ? { version: metadata.version as string } : {}) },
		entries,
	};
	await writeFile(join(outdir, FACET_BUNDLE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	return manifest;
}

export interface ConfiguredServerPluginPackage {
	readonly manifestPath: string;
	build(): Promise<readonly FacetBundleArtifact[]>;
}

/** Persist an explicit plugin package selection or restore it for a later server generation. */
export async function restoreServerPluginPackageProfile(
	directory: string,
	serverId: ServerId,
	configuredPackagePaths?: readonly string[],
): Promise<readonly string[]> {
	const path = join(directory, `plugin-packages-${serverId}.json`);
	if (configuredPackagePaths === undefined) {
		return (await readPluginPackageProfile(path, false)) ?? [];
	}
	const packagePaths = normalizePluginPackagePaths(configuredPackagePaths);
	if (packagePaths.length === 0) await rm(path, { force: true });
	else await writePluginPackageProfile(path, packagePaths);
	return packagePaths;
}

/** Read the explicit plugin selection stored for one durable Session. */
export function readSessionPluginPackageProfile(
	directory: string,
	serverId: ServerId,
	sessionPath: string,
): Promise<readonly string[] | undefined> {
	return readPluginPackageProfile(sessionPluginProfilePath(directory, serverId, sessionPath), true, sessionPath);
}

/** Remove the plugin selection stored for one deleted Session. */
export async function removeSessionPluginPackageProfile(
	directory: string,
	serverId: ServerId,
	sessionPath: string,
): Promise<void> {
	await rm(sessionPluginProfilePath(directory, serverId, sessionPath), { force: true });
}

/** Persist the plugin selection for one durable Session. */
export function writeSessionPluginPackageProfile(
	directory: string,
	serverId: ServerId,
	sessionPath: string,
	packagePaths: readonly string[],
): Promise<void> {
	return writePluginPackageProfile(
		sessionPluginProfilePath(directory, serverId, sessionPath),
		normalizePluginPackagePaths(packagePaths),
		sessionPath,
	);
}

/** Create a serialized server-owned builder for one configured plugin package. */
export function createServerPluginPackage(
	directory: string,
	serverId: ServerId,
	packagePath: string,
): ConfiguredServerPluginPackage {
	const normalizedPackagePath = resolve(packagePath);
	const outdir = join(directory, "plugin-builds", serverId, pluginBuildDirectoryName(normalizedPackagePath));
	const manifestPath = join(outdir, FACET_BUNDLE_MANIFEST_FILE);
	let buildTail = Promise.resolve();
	return {
		manifestPath,
		build() {
			const operation = buildTail.then(async (): Promise<readonly FacetBundleArtifact[]> => {
				const manifest = await bundlePluginPackage(normalizedPackagePath, outdir);
				const entry = manifest.entries.tui;
				if (entry === undefined) return [];
				return [
					{
						format: FACET_BUNDLE_ARTIFACT_FORMAT,
						formatVersion: FACET_BUNDLE_ARTIFACT_FORMAT_VERSION,
						plugin: manifest.plugin,
						entryName: "tui",
						entry,
						source: await readFile(join(outdir, entry.file), "utf8"),
					},
				];
			});
			buildTail = operation.then(
				() => undefined,
				() => undefined,
			);
			return operation;
		},
	};
}

async function readPluginPackageProfile(
	path: string,
	allowEmpty: boolean,
	sessionPath?: string,
): Promise<readonly string[] | undefined> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw new Error(`Could not read experimental plugin package profile ${path}`, { cause: error });
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		Object.keys(parsed).some(
			(key) => key !== "version" && key !== "packagePaths" && !(key === "sessionPath" && sessionPath !== undefined),
		) ||
		!("version" in parsed) ||
		parsed.version !== PLUGIN_PACKAGE_PROFILE_VERSION ||
		(sessionPath === undefined
			? "sessionPath" in parsed
			: !("sessionPath" in parsed) || parsed.sessionPath !== sessionPath) ||
		!("packagePaths" in parsed) ||
		!Array.isArray(parsed.packagePaths) ||
		(!allowEmpty && parsed.packagePaths.length === 0) ||
		parsed.packagePaths.some((packagePath) => typeof packagePath !== "string" || packagePath.length === 0)
	) {
		throw new Error(`Invalid experimental plugin package profile ${path}`);
	}
	return normalizePluginPackagePaths(parsed.packagePaths as readonly string[]);
}

function writePluginPackageProfile(path: string, packagePaths: readonly string[], sessionPath?: string): Promise<void> {
	return writeFile(
		path,
		`${JSON.stringify(
			{
				version: PLUGIN_PACKAGE_PROFILE_VERSION,
				...(sessionPath === undefined ? {} : { sessionPath }),
				packagePaths,
			},
			null,
			2,
		)}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
}

export function normalizePluginPackagePaths(packagePaths: readonly string[]): readonly string[] {
	const normalized = packagePaths.map((packagePath) => {
		if (packagePath.length === 0) throw new Error("Plugin package path must not be empty");
		return resolve(packagePath);
	});
	if (new Set(normalized).size !== normalized.length) {
		throw new Error("Plugin package paths must be unique");
	}
	return Object.freeze(normalized);
}

function sessionPluginProfilePath(directory: string, serverId: ServerId, sessionPath: string): string {
	const hash = createHash("sha256").update(sessionPath).digest("hex").slice(0, 24);
	return join(directory, `session-plugin-packages-${serverId}-${hash}.json`);
}

function pluginBuildDirectoryName(packagePath: string): string {
	const packageDirectory = basename(packagePath) === "package.json" ? dirname(packagePath) : packagePath;
	const base = basename(packageDirectory).replaceAll(/[^a-zA-Z0-9._-]/gu, "-") || "plugin";
	const label = base.endsWith("-plugin") ? base : `${base}-plugin`;
	const hash = createHash("sha256").update(packagePath).digest("hex").slice(0, 12);
	return `${label}-${hash}`;
}
