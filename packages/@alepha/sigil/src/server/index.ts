/**
 * Server-only entry point for `@alepha/sigil`.
 *
 * Importable as `@alepha/sigil/server` — unlike the main barrel, this path
 * pulls no React or browser code, so a server bundle (an app's API module) can
 * extend or substitute the sink provider without dragging the client in.
 *
 * Substituting {@link SigilSinkProvider} is the supported way for an app that
 * hosts its own receiver to report to itself. A Worker cannot fetch its own
 * hostname, so an app co-located with its sink has to hand the envelope to the
 * receiving code in-process instead of over HTTP — Lore does exactly that with
 * `LoreSigilSinkProvider`, wired in its `main.server.ts`.
 *
 * (This docstring used to claim that substitution was "no longer needed"
 * because the sink is always a different host. That was never true for the one
 * app doing it, and the provider it described as retired is still in use.)
 */

export * from "../shared/schemas/sigilConfig.ts";
export * from "../shared/schemas/sigilEnvelope.ts";
export * from "../shared/sigilClientAtom.ts";
export * from "../shared/sigilFeatures.ts";
export * from "../shared/sigilFingerprint.ts";
export * from "../shared/sigilOptionsAtom.ts";
export * from "../shared/sigilPaths.ts";
export * from "./SigilSinkProvider.ts";
