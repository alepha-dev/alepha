/**
 * `cn` is shadcn's own engine for Tailwind class merging: the same API and
 * output as `clsx` + `tailwind-merge`, with zero dependencies. This module is
 * the one import path for it, hand-maintained blocks and stock primitives
 * alike; `scripts/sync.ts` rewrites the registry's direct `"cn"` import back
 * through here.
 */
export { cn } from "cn";
