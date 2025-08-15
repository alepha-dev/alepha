import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		viteReact(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "Alepha Roadmap",
				short_name: "Roadmap",
				theme_color: "#010409",
				background_color: "#010409",
				display: "standalone",
				start_url: "/",
			},
		}),
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
