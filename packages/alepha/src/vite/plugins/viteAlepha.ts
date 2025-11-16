import type { Plugin } from "vite";
import {
  type ViteAlephaBuildOptions,
  viteAlephaBuild,
} from "./viteAlephaBuild.ts";
import { type ViteAlephaDevOptions, viteAlephaDev } from "./viteAlephaDev.ts";

export type ViteAlephaOptions = ViteAlephaDevOptions & ViteAlephaBuildOptions;

export function viteAlepha(
  options: ViteAlephaOptions = {},
): (Plugin | Promise<Plugin>)[] {
  if (process.env.NODE_ENV === "test") {
    return [];
  }

  const plugins: (Plugin | Promise<Plugin>)[] = [];

  plugins.push(viteAlephaDev(options), viteAlephaBuild(options));

  return plugins;
}
