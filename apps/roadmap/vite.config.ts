import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		viteReact(),
		viteAlepha({
			vercel: {
				projectName: "alepha-roadmap",
			},
			client: {
				precompress: true,
			},
		}),
	],
});
