import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isBuiltin, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Facet, JsonValue } from "@earendil-works/chord";
import { nodeLoader } from "@earendil-works/chord/node";
import {
	FACET_BUNDLE_ARTIFACT_FORMAT,
	FACET_BUNDLE_ARTIFACT_FORMAT_VERSION,
	type FacetBundleArtifact,
	readFacetBundleManifest,
} from "./package.ts";

const PRESENTATION_FACET_BUNDLES_KEY = "presentationFacetBundles";
const PI_PLUGIN_API = "@earendil-works/pi-coding-agent/experimental/plugin";

/** Application-owned module files and resolver hooks live exactly as long as their loaded facets. */
export interface LoadedPluginFacets {
	readonly facets: readonly Facet[];
	dispose(): Promise<void>;
}

export async function loadSessionPluginFacets(manifestPaths: readonly string[]): Promise<LoadedPluginFacets> {
	const artifacts: FacetBundleArtifact[] = [];
	for (const manifestPath of manifestPaths) {
		const manifest = await readFacetBundleManifest(manifestPath);
		const entry = manifest.entries.session;
		if (entry === undefined) continue;
		artifacts.push({
			format: FACET_BUNDLE_ARTIFACT_FORMAT,
			formatVersion: FACET_BUNDLE_ARTIFACT_FORMAT_VERSION,
			plugin: manifest.plugin,
			entryName: "session",
			entry,
			source: await readFile(join(dirname(manifestPath), entry.file), "utf8"),
		});
	}
	return loadPluginArtifacts(artifacts);
}

export function createPresentationFacetData(artifacts: readonly FacetBundleArtifact[]): JsonValue {
	return { [PRESENTATION_FACET_BUNDLES_KEY]: artifacts.map((artifact) => artifact as unknown as JsonValue) };
}

/** Load only artifacts selected and sent by the connected server; never resolve server-local file paths. */
export async function loadPresentationFacets(data: JsonValue): Promise<LoadedPluginFacets> {
	if (data === null || Array.isArray(data) || typeof data !== "object")
		throw new Error("Invalid presentation plugin data");
	const artifacts = data[PRESENTATION_FACET_BUNDLES_KEY] ?? [];
	if (!Array.isArray(artifacts)) throw new Error("Invalid presentation plugin bundle list");
	return loadPluginArtifacts(artifacts);
}

async function loadPluginArtifacts(values: readonly unknown[]): Promise<LoadedPluginFacets> {
	const artifacts = values.map((value) => {
		if (
			value === null ||
			typeof value !== "object" ||
			!("format" in value) ||
			value.format !== FACET_BUNDLE_ARTIFACT_FORMAT ||
			!("formatVersion" in value) ||
			value.formatVersion !== FACET_BUNDLE_ARTIFACT_FORMAT_VERSION ||
			!("plugin" in value) ||
			value.plugin === null ||
			typeof value.plugin !== "object" ||
			!("id" in value.plugin) ||
			typeof value.plugin.id !== "string" ||
			value.plugin.id.length === 0 ||
			!("entryName" in value) ||
			typeof value.entryName !== "string" ||
			!("source" in value) ||
			typeof value.source !== "string" ||
			!("entry" in value) ||
			value.entry === null ||
			typeof value.entry !== "object" ||
			!("file" in value.entry) ||
			typeof value.entry.file !== "string" ||
			basename(value.entry.file) !== value.entry.file ||
			!("integrity" in value.entry) ||
			typeof value.entry.integrity !== "string" ||
			!("externalImports" in value.entry) ||
			!Array.isArray(value.entry.externalImports) ||
			value.entry.externalImports.some((item: unknown) => typeof item !== "string")
		) {
			throw new Error("Invalid plugin facet artifact");
		}
		if (value.entry.integrity !== `sha256-${createHash("sha256").update(value.source).digest("base64")}`) {
			throw new Error("Plugin facet integrity mismatch");
		}
		return value as FacetBundleArtifact;
	});
	// Node canonicalizes file URLs before resolving imports, including symlinked OS temporary directories.
	const directory = await realpath(await mkdtemp(join(tmpdir(), "pi-plugin-facets-")));
	const root = pathToFileURL(`${directory}/`).href;
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			if (!context.parentURL?.startsWith(root) || isBuiltin(specifier)) return nextResolve(specifier, context);
			if (specifier === PI_PLUGIN_API) {
				const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
				return nextResolve(new URL(`../plugin.${extension}`, import.meta.url).href, context);
			}
			if (
				specifier === "@earendil-works/chord" ||
				specifier.startsWith("@earendil-works/chord/") ||
				specifier === "typebox" ||
				specifier.startsWith("typebox/")
			) {
				return nextResolve(import.meta.resolve(specifier), context);
			}
			throw new Error(`Unsupported plugin external import: ${specifier}`);
		},
	});
	let disposed = false;
	try {
		const modules = await Promise.all(
			artifacts.map(async (artifact, index) => {
				const path = join(directory, `${index}.mjs`);
				await writeFile(path, artifact.source, "utf8");
				return path;
			}),
		);
		const facets = await nodeLoader(modules);
		return {
			facets: facets.map((facet, index) => ({
				...facet,
				name: `${artifacts[index]!.plugin.id}/${artifacts[index]!.entryName}`,
			})),
			async dispose() {
				if (disposed) return;
				disposed = true;
				hooks.deregister();
				await rm(directory, { force: true, recursive: true });
			},
		};
	} catch (error) {
		hooks.deregister();
		await rm(directory, { force: true, recursive: true });
		throw error;
	}
}
