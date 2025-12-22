import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";

const env = loadEnv();

export default defineConfig({
	test: {
		globals: true,
		coverage: {
      reporter: ["cobertura", "html"],
      include: [
				"packages/*/src/**/*.ts",
				"packages/*/src/**/*.tsx",
			],
			exclude: [
				"apps/**",
				"scripts/**",
				// ignore experimental packages
				"packages/ui",
				"packages/devtools",
				"packages/create-alepha",
				"packages/alepha/src/vite",
				"packages/alepha/src/cli",
				"packages/alepha/src/bin",
				"packages/alepha/src/thread",
			],
		},
		env: {
      // for testing, let's use Paris timezone as default :)
      TZ: "Europe/Paris",
      // database connection string for tests, installed via docker-compose
			DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
      // azure blob storage connection string for tests, using azurite via docker-compose
			AZ_STORAGE_CONNECTION_STRING: "DefaultEndpointsProtocol=http;" +
				"AccountName=devstoreaccount1;" +
				"AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
				"BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
      // used for testing @bucket/vercel
			BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN ?? "vercel_blob_rw_mock_token_123456789",
      // S3-compatible storage (MinIO via docker-compose) for testing @alepha/bucket-s3
      S3_ENDPOINT: "http://127.0.0.1:9090",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "mock",
      S3_SECRET_ACCESS_KEY: "mock"
		},
		projects: [
			{
				// node.js tests
				extends: true,
				test: {
					name: { label: 'node', color: 'green' },
          environment: 'node',
          include: ['**/test/**/*.spec.{ts,tsx}'],
					exclude: ['**/test/**/*.browser.spec.{ts,tsx}', 'node_modules'],
				}
			},
			{
				// browser tests
				extends: true,
				test: {
					include: ['**/test/**/*.browser.spec.{ts,tsx}'],
					name: { label: 'jsdom', color: 'cyan' },
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

function loadEnv(): Record<string, string> {
	// if .env, read and load to var "env"
	if (existsSync(".env")) {
		return  readFileSync(".env", "utf-8")
			.split("\n")
			.map(e => e.trim().split("="))
			.filter(e => e.length === 2)
			.reduce((acc, cur) => {
				acc[cur[0].trim()] = cur[1].trim();
				return acc;
			}, {} as Record<string, string>);
	}

	return {}
}
