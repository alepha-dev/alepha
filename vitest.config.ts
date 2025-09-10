import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		coverage: {
			include: [
				"packages/*/src/**/*.ts",
				"packages/*/src/**/*.tsx",
			],
			exclude: [
				"apps/**",
				"scripts/**",
				// experimental packages
				"packages/react-i18n",
				"packages/cli",
				"packages/thread",
			],
			reporter: ["cobertura", "text", "html"],
		},
		env: {
			DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
			AZ_STORAGE_CONNECTION_STRING: "DefaultEndpointsProtocol=http;" +
				"AccountName=devstoreaccount1;" +
				"AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
				"BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
			BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_mock_token_123456789"
		},
		projects: [
			{
				// node.js tests
				extends: true,
				test: {
					name: { label: 'node', color: 'green' },
					include: ['**/test/**/*.spec.{ts,tsx}'],
					exclude: ['**/test/**/*.browser.spec.{ts,tsx}', 'node_modules'],
					environment: 'node'
				}
			},
			{
				// browser tests
				extends: true,
				test: {
					include: ['**/test/**/*.browser.spec.{ts,tsx}'],
					name: { label: 'browser', color: 'cyan' },
					environment: 'jsdom'
				},
				resolve: {
					conditions: ['browser', 'module', 'import', 'default'],
					mainFields: ['browser', 'module', 'main']
				}
			}
		]
	},
});
