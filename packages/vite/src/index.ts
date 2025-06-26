import type { Alepha } from "@alepha/core";

export * from "./viteAlepha.ts";
export * from "./viteAlephaBuild.ts";
export * from "./viteAlephaBuildVercel.ts";
export * from "./viteAlephaDev.ts";
export * from "./viteCompress.ts";

declare global {
	var __alepha: Alepha;
}
