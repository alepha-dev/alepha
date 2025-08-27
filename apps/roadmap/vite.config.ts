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
				config: {
					crons: [
						{
							path: "/session/cleanup",
							schedule: "0 0 * * *", // Every day at midnight
						},
					],
					headers: [
						{
							source: "/(.*)\\.(js|css)",
							headers: [
								{
									key: "Cache-Control",
									value: "public, max-age=86400, immutable",
								},
							],
						},
					],
				},
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
