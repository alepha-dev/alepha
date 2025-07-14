import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "rolldown-vite";

process.env.VITE_BUILD_DATE = new Date().toISOString();

export default defineConfig({
	plugins: [viteAlepha(), viteReact()],
});
