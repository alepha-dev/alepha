import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		coverage: {
			include: [
				"packages/*/src/**/*.ts",
			],
			exclude: [
				"scripts/**",
				"packages/alepha/**",
				"packages/cli/**",
				"packages/playground/**",
				"packages/testing/**",
				"packages/vite/**",
			],
			reporter: ["cobertura", "text", "html"],
		},
	},
});
