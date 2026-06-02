import { $repository } from "alepha/orm";
import { sigilVitals } from "../entities/sigilVitals.ts";

/**
 * Service responsible for ingesting Web-Vitals histogram events from the
 * Sigils embed bundle into the `sigil_vitals` table.
 *
 * Declaring `$repository(sigilVitals)` here registers the `sigil_vitals`
 * entity in the ORM / migration graph (the migration generator scans
 * instantiated repositories — same pattern as `BeaconIngestService` for
 * `sigil_views`).
 *
 * Full ingestion logic (bucket mapping, upsert, path-cap) lives in the
 * vitals analytics quest and will be added in a subsequent task.
 */
export class VitalsIngestService {
  protected vitals = $repository(sigilVitals);
}
