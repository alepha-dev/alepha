import { viteAlepha } from "@alepha/vite";
import { defineConfig } from "rolldown-vite";

export default defineConfig({
	plugins: [
		viteAlepha({
			serverEntry: "src/index.server.ts",
			vercel: true,
		}),
	],
});
