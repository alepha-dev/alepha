import { viteAlepha } from "alepha/vite";

export default {
  plugins: [viteAlepha()],
  test: {
    globals: true,
  },
};
