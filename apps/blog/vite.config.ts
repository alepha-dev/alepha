import { viteAlepha, viteReact } from "@alepha/vite";

export default {
	plugins: [
		viteReact(),
		viteAlepha({
			vercel: true,
		}),
	],
	resolve: {
		alias: {
			"pg-cloudflare": "pg",
		},
	},
};
