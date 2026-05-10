import { type Static, t } from "alepha";
import { beacons } from "../entities/beacons.ts";

/**
 * Beacon entity exposed to the owner-facing API.
 *
 * Adds a computed `screenshotUrl` derived from `screenshotFileId`. Kept as a
 * simple `/files/:id` shape for now — the actual file-serving convention can
 * be tightened in a follow-up when the screenshot upload endpoint lands.
 */
export const beaconResourceSchema = t.extend(beacons.schema, {
  screenshotUrl: t.optional(t.string()),
});

export type BeaconResource = Static<typeof beaconResourceSchema>;
