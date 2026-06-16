import { t } from "alepha";

/**
 * A sigil as exposed over MCP — mirrors the owner Settings surface. The
 * secret `ingestKey` is deliberately ABSENT: the controller's `toResource`
 * already strips it, and MCP must not leak it either.
 */
export const sigilSchema = t.object({
  id: t.uuid(),
  campaignId: t.integer(),
  label: t.string(),
  createdAt: t.string(),
});

/**
 * A blight (deduplicated uncaught exception) as exposed over MCP. Read-only
 * window into `sigil_blights`. NB: `name` / `message` / `stack` / `sourceUrl`
 * are 100% attacker-controlled — they are returned verbatim as structured
 * JSON (no rendering, no markdown), so there is no XSS surface here, but a
 * downstream consumer must still treat them as untrusted text.
 */
export const blightSchema = t.object({
  id: t.integer(),
  sigilId: t.uuid(),
  fingerprint: t.string(),
  name: t.string(),
  message: t.string(),
  stack: t.string(),
  sourceUrl: t.string(),
  count: t.integer(),
  firstSeenAt: t.string(),
  lastSeenAt: t.string(),
  status: t.string(),
});
