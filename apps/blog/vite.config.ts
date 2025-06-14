import { viteAlepha } from "@alepha/vite";
import { defineConfig } from "rolldown-vite";

export default defineConfig({
	plugins: [
		viteAlepha({
			vercel: true,
		}),
	],
});
