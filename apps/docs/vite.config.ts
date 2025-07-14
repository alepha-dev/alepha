import { viteAlepha } from "@alepha/vite";
import { defineConfig } from "rolldown-vite";

process.env.VITE_BUILD_DATE = new Date().toISOString();

export default defineConfig({
	plugins: [
		viteAlepha({
			client: {
				precompress: true,
				prerender: true,
			},
		}),
	],
});
