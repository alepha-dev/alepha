import { z } from "alepha";

/**
 * A sigil as exposed over MCP — mirrors the owner Settings surface. The
 * secret `ingestKey` is deliberately ABSENT: the controller's `toResource`
 * already strips it, and MCP must not leak it either.
 */
export const sigilSchema = z.object({
  id: z.uuid(),
  campaignId: z.integer(),
  label: z.string(),
  createdAt: z.string(),
});

/**
 * A blight (deduplicated uncaught exception) as exposed over MCP. Read-only
 * window into `sigil_blights`. NB: `name` / `message` / `stack` / `sourceUrl`
 * are 100% attacker-controlled — they are returned verbatim as structured
 * JSON (no rendering, no markdown), so there is no XSS surface here, but a
 * downstream consumer must still treat them as untrusted text.
 */
export const blightSchema = z.object({
  id: z.integer(),
  sigilId: z.uuid(),
  fingerprint: z.string(),
  name: z.string(),
  message: z.string(),
  stack: z.string(),
  sourceUrl: z.string(),
  count: z.integer(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  status: z.string(),
});
