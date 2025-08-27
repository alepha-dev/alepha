import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteAnalyser from "vite-bundle-analyzer";

export default defineConfig({
	plugins: [
		viteReact(),
		viteAnalyser({ analyzerMode: "static" }),
		viteAlepha({
			serverEntry: "src/index.ts",
		}),
	],
});
