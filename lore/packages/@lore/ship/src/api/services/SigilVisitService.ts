import {
  type SigilForwarded,
  sigilNetwork,
  sigilVisitorPeriodAccepted,
  sigilVisitorPeriodEnd,
} from "@alepha/lore/sigil";
import { $repository, sql } from "alepha/orm";

import { sigilSessions } from "../entities/sigilSessions.ts";
import { type SigilVisit, sigilVisits } from "../entities/sigilVisits.ts";

/**
 * One event of a batch as the visit write needs it: when (ISO, already
 * clamped by `eventTime`), where, and, for a view, how it arrived.
 */
export interface SigilVisitEvent {
  at: string;
  path: string;
  kind: "view" | "engagement";
  referrer: string;
  campaign: string;
  entry: boolean;
}

/**
 * The visit fields that describe the visitor rather than an event, already
 * normalised by the ingest (`ZZ`, `desktop`, `human`, `other`, `anon`).
 */
export interface SigilVisitStamp {
  country: string;
  device: string;
  traffic: string;
  browser: string;
  os: string;
  auth: string;
  network?: SigilForwarded["network"];
}

/**
 * Where a batch was filed: the ids the page view log carries.
 */
export interface SigilVisitPlacement {
  sessionId: string;
  visitId: string;
  /**
   * The visit's referrer and campaign after this batch: its entry view's,
   * which the page view log carries on every row.
   */
  referrer: string;
  campaign: string;
  network?: string;
}

/**
 * Sessions and visits: who visited an app in a period, and how each visit
 * went.
 *
 * **A batch is one visitor** (the app's sink provider sends one envelope per
 * stamp, and the stamp holds the visitor hash), so a batch costs one session
 * upsert, one visit read and one visit write, three statements in that
 * order, whatever it holds.
 *
 * **Visits are cut by event time, not arrival time.** A batch joins the
 * visitor's visit whose window it falls in: one whose last event is less than
 * 30 minutes before the batch's first, and whose first event is less than 30
 * minutes after the batch's last. So a late batch lands in the visit it
 * belongs to, and batches arriving in any order build the same visits. A gap
 * inside one batch does not split it: a batch spans seconds.
 *
 * A rare duplicate visit when two batches of one visitor race is accepted; a
 * lost view is not, which is why nothing here locks.
 */
export class SigilVisitService {
  /**
   * The inactivity that closes a visit.
   */
  public static readonly VISIT_GAP_MS = 30 * 60 * 1000;

  protected readonly sessions = $repository(sigilSessions);
  protected readonly visits = $repository(sigilVisits);

  /**
   * Files one batch, or answers `undefined` when it gets no session: no
   * visitor hash, nothing in it, or a declared bot.
   */
  public async record(input: {
    sigilId: string;
    visitor: string | undefined;
    visitorPeriod: string | undefined;
    stamp: SigilVisitStamp;
    events: SigilVisitEvent[];
    now: string;
    /**
     * Runs once the batch is placed, beside the visit write rather than
     * after it: the page view log append needs the ids, not the write.
     */
    placed?: (placement: SigilVisitPlacement) => Promise<void>;
  }): Promise<SigilVisitPlacement | undefined> {
    const { sigilId, visitor, stamp, now } = input;
    if (!visitor || stamp.traffic === "bot" || input.events.length === 0) {
      return undefined;
    }

    const events = [...input.events].sort((a, b) => a.at.localeCompare(b.at));
    const first = events[0].at;
    const last = events[events.length - 1].at;
    const views = events.filter((event) => event.kind === "view");

    const session = await this.sessions.upsert(
      {
        id: crypto.randomUUID(),
        sigilId,
        ...this.period(input.visitorPeriod, now),
        visitorHash: visitor,
        firstSeenAt: first,
        lastSeenAt: last,
      },
      {
        target: ["sigilId", "period", "visitorHash"],
        // A late batch never moves the session's window inwards: the
        // prune and the period-span flag both read it.
        set: {
          firstSeenAt: sql`CASE WHEN ${this.sessions.excluded("firstSeenAt")} < ${this.sessions.table.firstSeenAt} THEN ${this.sessions.excluded("firstSeenAt")} ELSE ${this.sessions.table.firstSeenAt} END`,
          lastSeenAt: sql`CASE WHEN ${this.sessions.excluded("lastSeenAt")} > ${this.sessions.table.lastSeenAt} THEN ${this.sessions.excluded("lastSeenAt")} ELSE ${this.sessions.table.lastSeenAt} END`,
        },
      },
    );

    const gap = SigilVisitService.VISIT_GAP_MS;
    const [visit] = await this.visits.findMany({
      where: {
        sessionId: { eq: session.id },
        lastSeenAt: { gt: new Date(Date.parse(first) - gap).toISOString() },
        startedAt: { lt: new Date(Date.parse(last) + gap).toISOString() },
      },
      orderBy: { column: "lastSeenAt", direction: "desc" },
      limit: 1,
    });

    const entry = views[0] ?? events[0];
    const exit = views[views.length - 1] ?? events[events.length - 1];
    const landing = views.find((view) => view.entry) ?? views[0];
    const engaged = events.some((event) => event.kind === "engagement");

    const network = SigilVisitService.networkLabel(stamp.network);
    const placed = async (
      placement: SigilVisitPlacement,
      write: Promise<unknown>,
    ) => {
      await Promise.all([write, input.placed?.(placement)]);
      return placement;
    };

    if (!visit) {
      const id = crypto.randomUUID();
      const referrer = landing?.referrer ?? "direct";
      const campaign = landing?.campaign ?? "none";
      const write = this.visits.create({
        id,
        sigilId,
        sessionId: session.id,
        startedAt: first,
        lastSeenAt: last,
        views: views.length,
        engaged,
        entryPath: entry.path,
        exitPath: exit.path,
        referrer,
        campaign,
        country: stamp.country,
        device: stamp.device,
        browser: stamp.browser,
        os: stamp.os,
        traffic: stamp.traffic,
        auth: stamp.auth,
        network,
      });
      return placed(
        { sessionId: session.id, visitId: id, referrer, campaign, network },
        write,
      );
    }

    const update = this.merge(visit, {
      first,
      last,
      views: views.length,
      engaged,
      entry: views[0],
      exit: views[views.length - 1],
      landing,
    });
    return placed(
      {
        sessionId: session.id,
        visitId: visit.id,
        referrer: update.referrer ?? visit.referrer,
        campaign: update.campaign ?? visit.campaign,
        network: network ?? visit.network ?? undefined,
      },
      this.visits.updateById(visit.id, update),
    );
  }

  /**
   * What a batch changes on the visit it joins: its window widens, its
   * counts add, and its entry (with where it came from) or exit moves when
   * the batch holds an earlier first or a later last view.
   */
  protected merge(
    visit: SigilVisit,
    batch: {
      first: string;
      last: string;
      views: number;
      engaged: boolean;
      entry?: SigilVisitEvent;
      exit?: SigilVisitEvent;
      landing?: SigilVisitEvent;
    },
  ): Partial<SigilVisit> {
    const update: Partial<SigilVisit> = {
      views: visit.views + batch.views,
      engaged: visit.engaged || batch.engaged,
    };
    if (batch.first < visit.startedAt) {
      update.startedAt = batch.first;
      if (batch.entry) {
        update.entryPath = batch.entry.path;
        update.referrer = batch.landing?.referrer ?? "direct";
        update.campaign = batch.landing?.campaign ?? "none";
      }
    }
    if (batch.last > visit.lastSeenAt) {
      update.lastSeenAt = batch.last;
      if (batch.exit) update.exitPath = batch.exit.path;
    }
    return update;
  }

  /**
   * The period to file the session under, and when it ends.
   *
   * A sender's `visitorPeriod` is believed only when it is of a known shape
   * and names the current or the previous period (`sigilVisitorPeriodAccepted`):
   * the sink takes envelopes from anyone holding the token, and without this
   * a token holder writes sessions into any period. Absent or refused, the
   * session is a daily one, the sender's UTC day, which is what a client
   * older than the field hashed.
   */
  protected period(
    claimed: string | undefined,
    now: string,
  ): { period: string; periodEndsAt: string } {
    const period = sigilVisitorPeriodAccepted(claimed, Date.parse(now))
      ? claimed
      : now.slice(0, 10);
    const end = sigilVisitorPeriodEnd(period) as number;
    return { period, periodEndsAt: new Date(end).toISOString() };
  }

  /**
   * `AS13335 Cloudflare, Inc.`, normalised again here rather than trusted:
   * the value on the wire is whatever the token holder put there.
   */
  public static networkLabel(value: unknown): string | undefined {
    const network = sigilNetwork(value);
    if (!network) return undefined;
    return network.name
      ? `AS${network.number} ${network.name}`
      : `AS${network.number}`;
  }
}
