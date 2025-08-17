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
				crons: [
					{
						path: "/session/cleanup",
						schedule: "0 0 * * *", // Every day at midnight
					},
				],
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
