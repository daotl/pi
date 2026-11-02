import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const durableSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const durableSrcTesting = fileURLToPath(new URL("./src/testing/index.ts", import.meta.url));

// Exclude before collection: live cache tests resolve and may refresh credentials at module scope.
const e2eExclude = process.env.PI_E2E_TESTS === "1" ? [] : ["test/**/*-e2e.test.ts"];

export default defineConfig({
	test: {
		environment: "node",
		// Run in workerd by their own config: `npm run test:workers`.
		exclude: [...configDefaults.exclude, "test-workers/**", ...e2eExclude],
		setupFiles: ["./test/setup-document-retention.ts"],
	},
	resolve: {
		conditions: ["source"],
		alias: [
			{ find: /^@earendil-works\/pi-durable$/, replacement: durableSrcIndex },
			{ find: /^@earendil-works\/pi-durable\/testing$/, replacement: durableSrcTesting },
		],
	},
	ssr: { resolve: { conditions: ["source"] } },
});
