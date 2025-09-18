import viteReact from "@vitejs/plugin-react";
import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		viteReact(),
		viteAlepha({
			serverEntry: "src/index.server.ts",
		}),
	],
});
