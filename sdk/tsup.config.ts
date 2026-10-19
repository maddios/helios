import { defineConfig } from "tsup";

export default defineConfig({
	entry: { index: "src/index.ts", admin: "src/admin.ts" },
	format: ["esm", "cjs"],
	outDir: "dist",
	target: "node18",
	platform: "node",
	clean: true,
	splitting: true,
	dts: true,
	tsconfig: "tsconfig.build.json",
	noExternal: [/@helios\/contracts/]
});
