import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		coverage: {
			include: [
				"packages/*/src/**/*.ts",
			],
			exclude: [
				"apps/**",
				"scripts/**",
				"packages/alepha/**",
				"packages/cli/**",
				"packages/protobuf/**"
			],
			reporter: ["cobertura", "text", "html"],
		},
		env: {
			DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
			AZ_STORAGE_CONNECTION_STRING: "DefaultEndpointsProtocol=http;" +
				"AccountName=devstoreaccount1;" +
				"AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
				"BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
		}
	},
});
