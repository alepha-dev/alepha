/**
 * Server-only entry point for `@alepha/pulse-client`.
 *
 * Importable as `@alepha/pulse-client/server` — unlike the main barrel, this path
 * pulls no React or browser code, so a server bundle (an app's API module) can
 * extend or substitute the sink provider without dragging the client in.
 *
 * The in-process substitution that used to live behind this entry — an app
 * co-located with its own receiver, working around a Worker's inability to
 * fetch its own hostname — is no longer needed: the sink is a different host by
 * construction.
 */

export * from "../shared/pulseClientAtom.ts";
export * from "../shared/pulseFeatures.ts";
export * from "../shared/pulseFingerprint.ts";
export * from "../shared/pulseOptionsAtom.ts";
export * from "../shared/schemas/pulseConfig.ts";
export * from "../shared/schemas/pulseEnvelope.ts";
export * from "./PulseMetricsProvider.ts";
export * from "./PulseSinkProvider.ts";
