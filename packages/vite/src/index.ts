import type { Alepha } from "@alepha/core";
import viteReactPlugin from "@vitejs/plugin-react";

export const viteReact = viteReactPlugin;
export * from "./viteAlepha.ts";
export * from "./viteAlephaBuild.ts";
export * from "./viteAlephaBuildVercel.ts";
export * from "./viteAlephaDev.ts";

declare global {
	var __alepha: Alepha;
}
