import { viteAlepha, viteReact } from "@alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		viteReact(),
		viteAlepha({
			entry: "./index.ts",
			vercel: true,
		}),
	],
});
