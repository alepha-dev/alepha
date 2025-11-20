import { viteAlepha } from "alepha/vite";

export default {
  plugins: [
    viteAlepha({
      cloudflare: true,
      docker: true,
      vercel: true,
    }),
  ],
  test: {
    globals: true,
  },
};
