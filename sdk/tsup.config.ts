import { defineConfig } from "tsup";

const formats: ("esm" | "cjs")[] = ["esm", "cjs"];

export default defineConfig([
	{
		entry: { index: "src/index.ts", admin: "src/admin.ts" },
		format: formats,
		outDir: "dist",
		target: "node18",
		platform: "node",
		clean: false,
		splitting: true,
		dts: true,
		tsconfig: "tsconfig.build.json",
		noExternal: [/@helios\/contracts/]
	},
	{
		entry: { browser: "src/browser/index.ts" },
		format: formats,
		outDir: "dist",
		target: "es2021",
		platform: "browser",
		clean: false,
		splitting: false,
		dts: true,
		tsconfig: "tsconfig.build.json"
	}
]);
