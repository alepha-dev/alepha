/**
 * Server-only entry point for `@alepha/sigil`.
 *
 * Importable as `@alepha/sigil/server` — unlike the main barrel, this path
 * pulls no React or browser code, so a server bundle (an app's API module) can
 * extend or substitute the sink provider without dragging the client in.
 *
 * The in-process substitution that used to live behind this entry — an app
 * co-located with its own receiver, working around a Worker's inability to
 * fetch its own hostname — is no longer needed: the sink is a different host by
 * construction.
 */

export * from "../shared/schemas/sigilConfig.ts";
export * from "../shared/schemas/sigilEnvelope.ts";
export * from "../shared/sigilClientAtom.ts";
export * from "../shared/sigilFeatures.ts";
export * from "../shared/sigilFingerprint.ts";
export * from "../shared/sigilOptionsAtom.ts";
export * from "../shared/sigilPaths.ts";
export * from "./SigilSinkProvider.ts";
