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
			name: "api-imports-core-and-contracts-via-index-only",
			comment: "api/ imports core and contracts only through their index.ts files",
			severity: "error",
			from: { path: "^api/" },
			to: { path: "^(core|contracts)/src/(?!index\\.ts$|[^/]+/index\\.ts$|api/index\\.ts$)" }
		},
		{
			name: "sdk-imports-contracts-only",
			comment: "sdk/ is server-agnostic: it imports contracts, never core, api, worker or other services",
			severity: "error",
			from: { path: "^sdk/" },
			to: { path: "^(core|api|worker|functions|local|scripts)/" }
		},
		{
			name: "sdk-browser-is-self-contained",
			comment: "sdk/src/browser ships to browsers: it imports only its own files, and type-only imports are erased",
			severity: "error",
			from: { path: "^sdk/src/browser/" },
			to: { pathNot: "^sdk/src/browser/", dependencyTypesNot: ["type-only"] }
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
