/**
 * Server-only entry point for `@alepha/telemetry`.
 *
 * Importable as `@alepha/telemetry/server` — unlike the main barrel, this path
 * pulls no React or browser code, so a server bundle (an app's API module) can
 * extend or substitute the sink provider without dragging the client in.
 *
 * The in-process substitution that used to live behind this entry — an app
 * co-located with its own receiver, working around a Worker's inability to
 * fetch its own hostname — is no longer needed: the sink is a different host by
 * construction.
 */
export * from "../shared/schemas/telemetryConfig.ts";
export * from "../shared/schemas/telemetryEnvelope.ts";
export * from "../shared/telemetryClientAtom.ts";
export * from "../shared/telemetryFeatures.ts";
export * from "../shared/telemetryFingerprint.ts";
export * from "../shared/telemetryOptionsAtom.ts";
export * from "./TelemetryMetricsProvider.ts";
export * from "./TelemetrySinkProvider.ts";
