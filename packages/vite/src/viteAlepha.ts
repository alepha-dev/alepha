import type { Options } from "@vitejs/plugin-react";
import viteReact from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import {
  type ViteAlephaBuildOptions,
  viteAlephaBuild,
} from "./viteAlephaBuild.ts";
import { type ViteAlephaDevOptions, viteAlephaDev } from "./viteAlephaDev.ts";

export type ViteAlephaOptions = ViteAlephaDevOptions &
  ViteAlephaBuildOptions & {
    react?: false | Options;
  };

export function viteAlepha(
  options: ViteAlephaOptions = {},
): (Plugin | Promise<Plugin>)[] {
  if (process.env.NODE_ENV === "test") {
    return [];
  }

  const plugins: (Plugin | Promise<Plugin>)[] = [];

  if (options.react !== false) {
    plugins.push(viteReact(options.react) as any);
  }

  plugins.push(viteAlephaDev(options), viteAlephaBuild(options));

  return plugins;
}
