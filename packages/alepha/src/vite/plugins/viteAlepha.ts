import { createRequire } from "node:module";
import { OPTIONS } from "alepha";
import type { Plugin } from "vite";
import {
  type ViteAlephaBuildOptions,
  viteAlephaBuild,
} from "./viteAlephaBuild.ts";
import { type ViteAlephaDevOptions, viteAlephaDev } from "./viteAlephaDev.ts";
import { viteAlephaPreload } from "./viteAlephaPreload.ts";

export type ViteAlephaOptions = ViteAlephaDevOptions &
  ViteAlephaBuildOptions & {
    react?: false;
    /**
     * Enable SSR module preloading.
     * When enabled, $page lazy imports are analyzed and modulepreload
     * links are injected during SSR streaming.
     *
     * @default true
     */
    preload?: boolean;
  };

export function viteAlepha(
  options: ViteAlephaOptions = {},
): (Plugin | Promise<Plugin>)[] {
  if (process.env.NODE_ENV === "test") {
    return [];
  }

  const plugins: (Plugin | Promise<Plugin>)[] & { [OPTIONS]?: any } = [];

  if (options.react !== false) {
    try {
      const { default: viteReact } = createRequire(import.meta.url)(
        "@vitejs/plugin-react",
      );
      plugins.push(viteReact());
    } catch (e) {}
  }

  // Add preload plugin for SSR module preloading (enabled by default)
  if (options.preload !== false) {
    plugins.push(viteAlephaPreload());
  }

  plugins.push(viteAlephaDev(options), viteAlephaBuild(options));
  plugins[OPTIONS] = options;

  return plugins;
}
