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
	},
});
