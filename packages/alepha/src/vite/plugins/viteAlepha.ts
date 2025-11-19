import { createRequire } from "node:module";
import type { Plugin } from "vite";
import {
  type ViteAlephaBuildOptions,
  viteAlephaBuild,
} from "./viteAlephaBuild.ts";
import { type ViteAlephaDevOptions, viteAlephaDev } from "./viteAlephaDev.ts";

export type ViteAlephaOptions = ViteAlephaDevOptions &
  ViteAlephaBuildOptions & {
    react?: false;
  };

export function viteAlepha(
  options: ViteAlephaOptions = {},
): (Plugin | Promise<Plugin>)[] {
  if (process.env.NODE_ENV === "test") {
    return [];
  }

  const plugins: (Plugin | Promise<Plugin>)[] = [];

  if (options.react !== false) {
    try {
      const { default: viteReact } = createRequire(import.meta.url)(
        "@vitejs/plugin-react",
      );
      plugins.push(viteReact());
    } catch (e) {}
  }

  plugins.push(viteAlephaDev(options), viteAlephaBuild(options));

  return plugins;
}
