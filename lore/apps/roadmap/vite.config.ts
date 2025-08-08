import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react-oxc";
import { defineConfig } from "rolldown-vite";

export default defineConfig({
	plugins: [
		viteReact(),
		viteAlepha({
			debug: true,
			vercel: {
				projectName: "alepha-roadmap",
			},
			client: {
				precompress: true,
			},
		}),
	],
});
