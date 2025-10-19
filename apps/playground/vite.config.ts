import { viteAlepha } from "@alepha/vite";
import viteTailwind from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		viteReact(),
		viteTailwind(),
		viteAlepha({
			serverEntry: "src/index.server.ts",
		}),
	],
});
