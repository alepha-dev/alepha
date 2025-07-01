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
				// experimental packages
				"packages/cli/**",
				"packages/protobuf/**",
				"packages/react/**",
				"packages/react-auth/**",
				"packages/server-metrics/**",
				"packages/vite/**",
			],
			reporter: ["cobertura", "text", "html"],
		},
		env: {
			DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
		}
	},
});
