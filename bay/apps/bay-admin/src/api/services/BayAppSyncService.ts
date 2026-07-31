import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { pulseApps } from "../entities/pulseApps.ts";
import { AppKeyService } from "./AppKeyService.ts";
import { BayControlService } from "./BayControlService.ts";

/**
 * Keeps the apps Bay hosts enrolled in Pulse, without anyone typing them in.
 *
 * Bay already knows their names — they are in its registry. Making an operator
 * re-declare each one here would be the same code↔infra drift the derived
 * manifest exists to prevent, one level up.
 *
 * An `external` app is different: nobody but a human knows it exists, so it
 * stays a deliberate enrolment.
 */
export class BayAppSyncService {
  protected readonly log = $logger();
  protected readonly bay = $inject(BayControlService);
  protected readonly keys = $inject(AppKeyService);
  protected readonly apps = $repository(pulseApps);

  /**
   * Ensures every app in Bay's registry has a row here.
   *
   * Idempotent and best-effort: a Bay that cannot be reached leaves the
   * enrolled set exactly as it was, because an observer must keep answering
   * about the apps it already knows when the machine under it goes quiet.
   *
   * Each new row gets its own ingest key. It is never shown — a Bay app is
   * handed its key by the operator through `alepha platform up`, or reads it
   * from its own env; there is no moment where a human needs to copy it.
   */
  async sync(): Promise<number> {
    let created = 0;
    try {
      for (const app of await this.bay.listApps()) {
        const existing = await this.apps.findOne({ where: { slug: app.name } });
        if (existing) {
          continue;
        }
        const key = this.keys.generate();
        await this.apps.create({
          slug: app.name,
          name: app.name,
          kind: "bay",
          ingestKeyHash: key.hash,
          ingestKeyPrefix: key.prefix,
        });
        created++;
      }
    } catch (error) {
      this.log.warn("Could not sync apps from Bay; keeping what is enrolled", {
        error: String((error as Error)?.message ?? error),
      });
    }
    if (created) {
      this.log.info(`Enrolled ${created} app(s) from Bay`);
    }
    return created;
  }
}
