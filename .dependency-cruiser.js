module.exports = {
	forbidden: [
		{
			name: "no-circular",
			severity: "error",
			from: {},
			to: { circular: true }
		},
		{
			name: "no-deep-module-imports",
			comment: "Import a core module only through its index.ts",
			severity: "error",
			from: { path: "^core/src/([^/]+)/" },
			to: { path: "^core/src/([^/]+)/(?!index\\.ts$)", pathNot: "^core/src/$1/" }
		},
		{
			name: "local-imports-core-via-index-only",
			comment: "local/ imports core only through core/src/index.ts or a module's index.ts",
			severity: "error",
			from: { path: "^local/" },
			to: { path: "^core/src/(?!index\\.ts$|[^/]+/index\\.ts$)" }
		},
		{
			name: "worker-imports-core-via-index-only",
			comment: "worker/ imports core only through core/src/index.ts or a module's index.ts",
			severity: "error",
			from: { path: "^worker/" },
			to: { path: "^core/src/(?!index\\.ts$|[^/]+/index\\.ts$)" }
		},
		{
			name: "contracts-is-a-leaf",
			severity: "error",
			from: { path: "^contracts/" },
			to: { path: "^core/" }
		}
	],
	options: {
		doNotFollow: { path: "node_modules" },
		tsConfig: { fileName: "tsconfig.json" },
		combinedDependencies: true
	}
};
