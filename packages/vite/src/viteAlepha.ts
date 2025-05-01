import type { Plugin } from "vite";
import {
	type ViteAlephaBuildOptions,
	viteAlephaBuild,
} from "./viteAlephaBuild.ts";
import { type ViteAlephaDevOptions, viteAlephaDev } from "./viteAlephaDev.ts";

export type ViteAlephaOptions = ViteAlephaDevOptions & ViteAlephaBuildOptions;

export function viteAlepha(options: ViteAlephaOptions = {}): Plugin[] {
	return [
		//
		viteAlephaDev(options),
		viteAlephaBuild(options),
	];
}
