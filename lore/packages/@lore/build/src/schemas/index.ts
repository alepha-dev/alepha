/**
 * The browser-safe schemas of `@lore/build`, Lore's fourth pillar: the code a
 * project holds, and its Quality.
 *
 * What another package, a browser page or an end-to-end spec may import as a
 * runtime value. Nothing here reaches a server-only module.
 *
 * @module
 */
export {
  type BuildCapabilityOptions,
  buildCapabilityOptionsSchema,
} from "../api/schemas/buildCapabilityOptionsSchema.ts";
export { qualityRuns } from "../api/entities/qualityRuns.ts";
export type { QualityRunPush } from "../api/schemas/qualityRunPushSchema.ts";
