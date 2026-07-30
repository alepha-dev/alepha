# @alepha/sigil

Lore Sigil is the telemetry and user-feedback module for Alepha apps. It provides an embeddable widget that lets end-users submit annotated screenshots (blights) and feedback directly from your app to a Lore campaign, with optional session telemetry (beacon) for crash and usage tracking.

## Integration

1. Add `imports: [AlephaSigil]` to your `WebModule` (or `ServerModule`) definition.
2. Add `@import "@alepha/sigil/styles"` to your main CSS entry point.
3. Set the `SIGIL_ID` server environment variable to the Lore sigil identifier that targets your campaign (required; the widget is a no-op when absent). Optionally set `LORE_URL` to point at a self-hosted Lore instance (defaults to `https://lore.alepha.dev`).
