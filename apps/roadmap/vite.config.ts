import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		viteReact(),
		viteAlepha({
			serverEntry: "./src/index.server.ts",
			vercel: {
				projectName: "alepha-roadmap",
			},
			client: {
				precompress: true,
			},
			onReload: () => {
				console.clear();
			},
		}),
	],
});
