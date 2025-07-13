import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "rolldown-vite";

export default defineConfig({
	plugins: [viteAlepha(), viteReact()],
});
