import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteBundleAnalyzer from "vite-bundle-analyzer";

process.env.VITE_BUILD_DATE = new Date().toISOString();

export default defineConfig({
	plugins: [
		viteReact(),
		viteAlepha({
			client: {
				precompress: true,
				prerender: true,
			},
		}),
		viteBundleAnalyzer({
			analyzerMode: "static",
		}),
	],
});
