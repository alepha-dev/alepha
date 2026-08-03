import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { outpostApps } from "../entities/outpostApps.ts";
import { outpostEvents } from "../entities/outpostEvents.ts";
import { type Outpost, outposts } from "../entities/outposts.ts";
import type { OutpostReport } from "../schemas/outpostReport.ts";

/**
 * Absorbs one report from one machine.
 *
 * Two very different write shapes, and keeping them apart is the design:
 *
 * - **Apps are a snapshot.** Upserted on `(outpostId, app, environment)` and
 *   overwritten wholesale, because the row means "what is true now". Rows for
 *   instances the machine no longer mentions are deleted, so an app removed on
 *   the host disappears from Lore rather than lingering as a healthy-looking
 *   ghost.
 * - **Events are an append.** Refused on conflict rather than updated, because
 *   a thing that happened does not happen differently later. The uniqueness
 *   index is the delivery guarantee: the machine resends its whole history
 *   every minute and the table keeps one copy.
 */
export class OutpostIngestService {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly outposts = $repository(outposts);
  protected readonly apps = $repository(outpostApps);
  protected readonly events = $repository(outpostEvents);

  async absorb(outpost: Outpost, report: OutpostReport): Promise<void> {
    const now = new Date(this.dateTime.nowMillis()).toISOString();

    await this.absorbApps(outpost, report, now);
    await this.absorbEvents(outpost, report);

    // Stamped last, and only after the writes landed. `lastSeenAt` is what the
    // "silent" badge reads, so it has to mean "a report was accepted", not "a
    // request arrived" — a machine whose payloads keep failing is exactly the
    // one that must stop looking alive.
    await this.outposts.updateMany(
      { id: { eq: outpost.id } },
      { lastSeenAt: now, agent: report.agent, baseDomain: report.baseDomain },
    );
  }

  protected async absorbApps(
    outpost: Outpost,
    report: OutpostReport,
    now: string,
  ): Promise<void> {
    for (const app of report.apps) {
      await this.apps.upsert(
        {
          outpostId: outpost.id,
          app: app.app,
          environment: app.environment,
          domains: app.domains ?? [],
          release: app.release,
          running: app.running,
          memoryBytes: app.memoryBytes,
          restarts: app.restarts ?? 0,
          lastRequestAt: app.lastRequestAt,
          updatedAt: now,
        },
        {
          target: ["outpostId", "app", "environment"],
          set: {
            domains: app.domains ?? [],
            release: app.release,
            running: app.running,
            memoryBytes: app.memoryBytes,
            restarts: app.restarts ?? 0,
            lastRequestAt: app.lastRequestAt,
            updatedAt: now,
          },
        },
      );
    }

    // Anything the machine stopped mentioning is gone from the machine. Removed
    // rather than flagged: a row that says "running: true" about an app that no
    // longer exists is worse than no row, and the deploy events for it survive
    // in their own table either way.
    const known = new Set(report.apps.map((a) => `${a.app}/${a.environment}`));
    const stored = await this.apps.findMany({
      where: { outpostId: { eq: outpost.id } },
    });
    for (const row of stored) {
      if (!known.has(`${row.app}/${row.environment}`)) {
        await this.apps.deleteMany({ id: { eq: row.id } });
      }
    }
  }

  protected async absorbEvents(
    outpost: Outpost,
    report: OutpostReport,
  ): Promise<void> {
    for (const event of report.events ?? []) {
      try {
        await this.events.create({
          outpostId: outpost.id,
          app: event.app,
          environment: event.environment,
          kind: event.kind,
          release: event.release,
          occurredAt: event.occurredAt,
        });
      } catch (error) {
        // A duplicate is the expected case, not an error: the machine resends
        // its whole history every minute by design. Swallowed at debug rather
        // than warn, because logging it at any louder level would fill the log
        // with the system working correctly.
        this.log.debug("outpost event already stored", {
          outpost: outpost.id,
          app: event.app,
          kind: event.kind,
          error,
        });
      }
    }
  }
}
