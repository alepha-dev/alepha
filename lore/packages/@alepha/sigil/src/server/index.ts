/**
 * Server-only entry point for `@alepha/sigil`.
 *
 * Importable as `@alepha/sigil/server` — unlike the main barrel
 * (`@alepha/sigil`), this path pulls NO React/browser code, so server bundles
 * (an app's API module) can extend or substitute the forward provider without
 * dragging the UI in.
 *
 * The host app substitutes {@link SigilForwardProvider} when it is co-located
 * with the Lore receiver (same process), to resolve + forward in-process
 * instead of over HTTP (a Cloudflare Worker cannot fetch its own hostname).
 */
export * from "../shared/sigilClientAtom.ts";
export * from "../shared/sigilFeatures.ts";
export * from "../shared/sigilOptionsAtom.ts";
export * from "./SigilForwardProvider.ts";
