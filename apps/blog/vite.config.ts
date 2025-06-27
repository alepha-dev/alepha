import { viteAlepha } from "@alepha/vite";
import { defineConfig } from "rolldown-vite";
import { analyzer } from "vite-bundle-analyzer";

export default defineConfig({
	plugins: [
		analyzer({
			analyzerMode: "static",
		}),
		viteAlepha({
			client: false,
			entry: "src/index.server.ts",
			vercel: true,
		}),
	],
});
