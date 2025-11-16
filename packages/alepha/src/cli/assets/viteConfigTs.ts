export const viteConfigTs = (
  serverEntry?: string,
) => `
import { viteAlepha } from "alepha/vite";

export default {
  plugins: [
    viteAlepha(${serverEntry ? `{ serverEntry: "${serverEntry}" }` : ""}),
  ],
  test: {
    globals: true,
  },
};
`.trim()
