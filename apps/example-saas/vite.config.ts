import { viteAlepha } from "alepha/vite";

export default {
  plugins: [
    viteAlepha({
      vercel: true,
    }),
  ],
  test: {
    globals: true,
  },
};
