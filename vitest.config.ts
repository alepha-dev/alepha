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
				"packages/testing/**",
				"packages/vite/**",
			],
			reporter: ["cobertura", "text", "html"],
		},
		env: {
			DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
		}
	},
});
