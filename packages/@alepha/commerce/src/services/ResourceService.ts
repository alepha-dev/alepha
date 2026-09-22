import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import {
  type ResourceReservationEntity,
  resourceReservations,
} from "../entities/resourceReservations.ts";
import {
  CommerceError,
  InvalidIntervalError,
  ResourceUnavailableError,
} from "../errors/CommerceError.ts";
import { ClaimLock } from "./ClaimLock.ts";
import { StockService } from "./StockService.ts";

/**
 * A half-open interval `[startsAt, endsAt)` of absolute instants.
 */
export interface ResourceWindow {
  startsAt: string;
  endsAt: string;
}

/**
 * One claim on one resource, as a kind handler describes it: which resource,
 * over which interval, out of how much room.
 *
 * `capacity` travels with every claim because commerce never stores it: a
 * court is 1, a course session 12, a train coach 60, and only the caller knows
 * which one this is.
 */
export interface ResourceClaim extends ResourceWindow {
  resourceId: string;
  capacity: number;
  /**
   * How much of the capacity this claim takes. Defaults to 1 here; a kind
   * handler defaults it to the order line's quantity.
   */
  quantity?: number;
}

/**
 * Inventory as claims on a named resource over an interval: court 3 on
 * Saturday from 18:00, seat 12A on the Lyon leg, room 204 on the night of the
 * 4th. The interval twin of {@link StockService}.
 *
 * ### Two inventory shapes
 *
 * - **Fungible stock** ({@link StockService}): a quantity on a product. Three
 *   padel balls, a t-shirt in size M. Any unit will do, so a count is enough.
 * - **An interval claim on a named resource** (this service): what is sold is
 *   a particular thing for a particular time, and two sales collide only when
 *   they name the same resource over overlapping intervals.
 *
 * A counter on a product cannot express the second: one product ("Padel, 90
 * minutes") sells many courts at many times, and one seat sold from A to C
 * over a train running A to B to C consumes capacity on both legs. So the
 * claim lives on the resource, and the product never learns about slots.
 *
 * ### The rules
 *
 * - `resourceId` is opaque. Commerce holds no resource registry.
 * - Intervals are half-open, `[startsAt, endsAt)`: two claims overlap when
 *   `a.startsAt < b.endsAt && b.startsAt < a.endsAt`, so back-to-back slots do
 *   not collide.
 * - Instants are absolute and normalised to `toISOString()` on the way in, and
 *   an instant with no offset is refused: `2026-09-26T18:00` means a
 *   different moment on every server it runs on.
 * - Capacity is an argument on every call, never a column.
 * - A claim is **live** when it is `consumed`, or `held` with an `expiresAt`
 *   still ahead. Expired holds are excluded inline from every read, not only
 *   by the sweep, so a late sweep delays tidying, it never oversells.
 *
 * ### How the race is closed
 *
 * Exactly as for stock, through {@link ClaimLock}: every claim holds the lock
 * on its resource on Postgres, where its check is the decision and is exact;
 * elsewhere it writes first and replays, keeping its claim only if the claims
 * ranked before it by `(createdAt, id)` leave room across its whole interval.
 *
 * The replay is **conservative**, and only the replay: an earlier-ranked claim
 * that will itself lose a moment later still counts against this one, so a
 * claim can be refused that would, in the end, have fit. It never lets two
 * claims share room that is not there. Under the Postgres lock no such claim
 * exists, since a loser never writes.
 */
export class ResourceService {
  /**
   * First key of the per-resource advisory lock on Postgres; the second is the
   * resource id. Its own key space, apart from stock's, so a resource and a
   * product that happen to share an id never share a lock.
   */
  public static readonly LOCK_NAMESPACE = "alepha:commerce:resource";

  protected readonly log = $logger();
  protected readonly lock = $inject(ClaimLock);
  protected readonly claims = $repository(resourceReservations);
  protected readonly dateTime = $inject(DateTimeProvider);

  // -------------------------------------------------------------------------
  // Claiming

  /**
   * Hold a resource over an interval for an order, refusing to exceed its
   * capacity anywhere in that interval.
   *
   * The hold expires on its own after `ttlMinutes` (by default
   * {@link StockService.RESERVATION_TTL_MINUTES}, kept equal to the payment
   * intent's expiry), and {@link commit} turns it into a sale.
   *
   * @throws ResourceUnavailableError when there is no room.
   * @throws InvalidIntervalError when the interval cannot be claimed as given.
   */
  public async reserve(
    resourceId: string,
    options: ResourceWindow & {
      capacity: number;
      quantity?: number;
      orderId?: string;
      orderItemId?: string;
      ttlMinutes?: number;
    },
  ): Promise<ResourceReservationEntity> {
    const window = this.interval(options);
    const quantity = this.amount(options.quantity ?? 1, "quantity");
    const capacity = this.amount(options.capacity, "capacity");
    const ttl = options.ttlMinutes ?? StockService.RESERVATION_TTL_MINUTES;

    return this.lock.run(this.lockKey(resourceId), (locked) =>
      this.place(locked, resourceId, window, capacity, quantity, {
        status: "held",
        orderId: options.orderId,
        orderItemId: options.orderItemId,
        expiresAt: new Date(
          this.dateTime.nowMillis() + ttl * 60_000,
        ).toISOString(),
      }),
    );
  }

  /**
   * Turn an order line's claim into a sale.
   *
   * Consumes the line's live hold on that claim when there is one. When there
   * is none - a counter sale created `paid` never held anything, and a hold can
   * expire before its capture lands - the claim is placed and consumed in one
   * step, through the same fit check as {@link reserve}, and loses the same
   * way when somebody took the room meanwhile. A dead hold is never trusted:
   * the room it held may have been sold since.
   *
   * Idempotent on `orderItemId`: a claim already consumed for that line is
   * returned as it is, which is what makes a re-delivered payment webhook
   * harmless here.
   *
   * @throws ResourceUnavailableError when there is no hold and no room.
   */
  public async commit(
    claim: ResourceClaim,
    context: { orderId: string; orderItemId: string },
  ): Promise<ResourceReservationEntity> {
    const window = this.interval(claim);
    const quantity = this.amount(claim.quantity ?? 1, "quantity");
    const capacity = this.amount(claim.capacity, "capacity");

    return this.lock.run(this.lockKey(claim.resourceId), async (locked) => {
      const mine = await this.claims.findMany({
        where: {
          orderItemId: { eq: context.orderItemId },
          resourceId: { eq: claim.resourceId },
          startsAt: { eq: window.startsAt },
          endsAt: { eq: window.endsAt },
          status: { inArray: ["held", "consumed"] },
        },
      });

      const consumed = mine.find((it) => it.status === "consumed");
      if (consumed) {
        return consumed;
      }

      const now = this.dateTime.nowISOString();
      const hold = mine.find((it) => it.expiresAt && it.expiresAt >= now);
      if (hold) {
        return this.claims.updateById(hold.id, {
          status: "consumed",
          expiresAt: null,
        });
      }

      // Whatever is left is a hold past its expiry that the sweep has not
      // reached yet. Tidied here, so the line never carries two claims.
      await this.releaseAll(mine);

      return this.place(locked, claim.resourceId, window, capacity, quantity, {
        status: "consumed",
        orderId: context.orderId,
        orderItemId: context.orderItemId,
      });
    });
  }

  /**
   * Write one claim, unless the resource has no room for it.
   *
   * Under the lock the check before the write is the decision. Without it the
   * check only turns away the obviously impossible before anything is
   * written: two racers can both pass it, and {@link replayFits} decides.
   */
  protected async place(
    locked: boolean,
    resourceId: string,
    window: ResourceWindow,
    capacity: number,
    quantity: number,
    fields: Pick<
      ResourceReservationEntity,
      "status" | "orderId" | "orderItemId" | "expiresAt" | "label"
    >,
  ): Promise<ResourceReservationEntity> {
    const live = await this.live([resourceId], window);
    if (!this.fits(live, window, quantity, capacity)) {
      throw new ResourceUnavailableError(
        resourceId,
        window,
        quantity,
        capacity,
      );
    }

    const claim = await this.claims.create({
      resourceId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      quantity,
      ...fields,
    });

    if (!locked && !(await this.replayFits(claim, capacity))) {
      await this.claims.updateById(claim.id, { status: "released" });
      throw new ResourceUnavailableError(
        resourceId,
        window,
        quantity,
        capacity,
      );
    }

    return claim;
  }

  /**
   * Whether a claim just written is one the resource can actually back, on a
   * database where {@link ClaimLock} holds no lock.
   *
   * Every live claim overlapping it is read back in the order it was written,
   * and only the ones ranked strictly before it count: the claim survives if
   * they leave room for it across its whole interval. N racers for a
   * capacity-N interval therefore leave exactly N claims, and the ones that
   * lose are the ones that arrived last. For capacity 1 this is Club's
   * `rank(b) < mine`.
   *
   * `(createdAt, id)` is the order of writing only because these databases
   * have one writer; see `StockService.holdFits` for why, and why Postgres
   * locks instead.
   *
   * A claim that is no longer in the list at all (released between the write
   * and this read) loses: it is no longer claiming anything.
   */
  protected async replayFits(
    claim: ResourceReservationEntity,
    capacity: number,
  ): Promise<boolean> {
    const ranked = await this.live([claim.resourceId], claim);
    const index = ranked.findIndex((it) => it.id === claim.id);
    if (index < 0) {
      return false;
    }
    return this.fits(ranked.slice(0, index), claim, claim.quantity, capacity);
  }

  // -------------------------------------------------------------------------
  // Closures

  /**
   * Take a resource out of sale over an interval for a reason that is not a
   * sale: maintenance, a private event, a course session holding a court, a
   * coach off sick, a train set withdrawn.
   *
   * A closure is a claim like any other (`consumed`, no expiry, no order, a
   * `label` saying why) and goes through the same claim path as
   * {@link reserve}, so a closure and a sale racing for one court leave
   * exactly one standing. That is what a check-then-write guard in front of a
   * separate closures table cannot promise.
   *
   * `quantity` defaults to `capacity`: a closure normally takes the whole
   * resource. There is no "exclusive" flag, because capacity is already the
   * caller's contract and a flag would be a second way to say the same thing.
   *
   * **A closure loses to earlier claims like anything else.** Closing a court
   * somebody has booked is refused with `ResourceUnavailableError`, and
   * displacing those sales (cancelling or refunding their orders, then
   * closing) is the application's job, not this package's: {@link occupancy}
   * lists what is in the way.
   *
   * @throws ResourceUnavailableError when a live claim is in the way.
   */
  public async claim(
    resourceId: string,
    options: ResourceWindow & {
      capacity: number;
      quantity?: number;
      label: string;
    },
  ): Promise<ResourceReservationEntity> {
    const window = this.interval(options);
    const capacity = this.amount(options.capacity, "capacity");
    const quantity = this.amount(options.quantity ?? capacity, "quantity");

    return this.lock.run(this.lockKey(resourceId), (locked) =>
      this.place(locked, resourceId, window, capacity, quantity, {
        status: "consumed",
        label: options.label,
      }),
    );
  }

  /**
   * Lift a closure, giving its interval back.
   *
   * Idempotent: a closure already lifted is left alone. Refuses a claim that
   * belongs to an order, whose room comes back through the order itself
   * (cancelled, or refunded) and never by deleting the booking under it.
   */
  public async lift(claimId: string): Promise<void> {
    const claim = await this.claims.getById(claimId);
    if (claim.orderId) {
      throw new CommerceError(
        `Claim ${claimId} belongs to order ${claim.orderId}: release it by cancelling or refunding the order, not by lifting it.`,
      );
    }
    if (claim.status !== "released") {
      await this.claims.updateById(claimId, { status: "released" });
    }
  }

  // -------------------------------------------------------------------------
  // Releasing

  /**
   * Give up an order's holds: the payment failed, the buyer walked away, the
   * order was cancelled. A claim already consumed stays sold.
   *
   * Idempotent: a claim already released, by the sweep or by an earlier call,
   * is left alone.
   */
  public async releaseFor(orderId: string): Promise<void> {
    await this.releaseAll(
      await this.claims.findMany({
        where: { orderId: { eq: orderId }, status: { eq: "held" } },
      }),
    );
  }

  /**
   * Give back every claim an order took, held or sold: the order was refunded
   * in full, or its creation failed where no transaction could undo it.
   *
   * Idempotent, like {@link releaseFor}.
   */
  public async releaseOrder(orderId: string): Promise<void> {
    await this.releaseAll(
      await this.claims.findMany({
        where: {
          orderId: { eq: orderId },
          status: { inArray: ["held", "consumed"] },
        },
      }),
    );
  }

  /**
   * Give back every claim an order line took, held or consumed: what a kind
   * handler calls to undo its own line when one of several claims loses, so an
   * item that needs two legs never keeps one.
   *
   * Idempotent, like {@link releaseFor}.
   */
  public async releaseItem(orderItemId: string): Promise<void> {
    await this.releaseAll(
      await this.claims.findMany({
        where: {
          orderItemId: { eq: orderItemId },
          status: { inArray: ["held", "consumed"] },
        },
      }),
    );
  }

  /**
   * Mark expired holds as released, and report how many.
   *
   * A plain method, not a `$job`, for the same reason as
   * `StockService.releaseExpiredReservations`: scheduling it would drag
   * `alepha/api/jobs` into this package. `@alepha/commerce/checkout` runs both
   * on the same tick.
   *
   * Nothing depends on this running promptly: every read already excludes
   * expired holds.
   */
  public async releaseExpiredReservations(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const stale = await this.claims.findMany({
      where: { status: { eq: "held" }, expiresAt: { lt: now } },
    });

    await this.releaseAll(stale);

    if (stale.length > 0) {
      this.log.info(`Released ${stale.length} expired resource hold(s)`);
    }
    return stale.length;
  }

  protected async releaseAll(
    found: ResourceReservationEntity[],
  ): Promise<void> {
    for (const claim of found) {
      await this.claims.updateById(claim.id, { status: "released" });
    }
  }

  // -------------------------------------------------------------------------
  // Reading

  /**
   * @public A read for applications and for tests: every claim an order took,
   * whatever became of it. Covered by `resourceReservation.spec.ts`.
   */
  public async claimsOf(orderId: string): Promise<ResourceReservationEntity[]> {
    return this.claims.findMany({
      where: { orderId: { eq: orderId } },
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
  }

  /**
   * Every claim one order line took, whatever became of it: what a kind
   * handler reads to stay idempotent on `item.id`.
   */
  public async claimsOfItem(
    orderItemId: string,
  ): Promise<ResourceReservationEntity[]> {
    return this.claims.findMany({
      where: { orderItemId: { eq: orderItemId } },
    });
  }

  /**
   * Every live claim on a resource over a window, and what each one is: the
   * order that bought it, or the label of the closure that took it.
   *
   * The staff read, for a planning screen or for the refusal a closure met.
   * Never hand it to a storefront: it names orders. The public read is
   * {@link availability}, which says how much is left and nothing about who
   * took the rest.
   */
  public async occupancy(
    resourceId: string,
    window: ResourceWindow,
  ): Promise<ResourceReservationEntity[]> {
    return this.live([resourceId], this.interval(window));
  }

  /**
   * The free intervals of each resource over a window, with the room left in
   * each: what a storefront renders as a calendar.
   *
   * An interval is listed when at least `quantity` (default 1) is left across
   * all of it; adjacent stretches with the same room left are one interval.
   * Capacity comes with each resource, as on every claim: what is free on a
   * course session depends on its 12.
   *
   * **Anonymous on purpose.** The result carries no order, claim or label: a
   * public storefront renders it. Who holds what, and why a window is closed,
   * is {@link occupancy}, a staff read.
   *
   * Read through the very code {@link reserve} decides with ({@link live} and
   * {@link profile}), so a live hold counts until the instant it expires,
   * sweep or no sweep. What it shows is a snapshot: a slot free now can be
   * taken before it is reserved, and {@link reserve} is still the decision.
   *
   * @returns every requested resource, with an empty list when it is full.
   */
  public async availability(
    resources: Array<{ resourceId: string; capacity: number }>,
    window: ResourceWindow,
    options: { quantity?: number } = {},
  ): Promise<Map<string, Array<ResourceWindow & { remaining: number }>>> {
    const clipped = this.interval(window);
    const quantity = this.amount(options.quantity ?? 1, "quantity");
    const capacityOf = new Map(
      resources.map((it) => [
        it.resourceId,
        this.amount(it.capacity, "capacity"),
      ]),
    );

    const byResource = new Map<string, ResourceReservationEntity[]>();
    for (const claim of await this.live([...capacityOf.keys()], clipped)) {
      const list = byResource.get(claim.resourceId) ?? [];
      list.push(claim);
      byResource.set(claim.resourceId, list);
    }

    const result = new Map<
      string,
      Array<ResourceWindow & { remaining: number }>
    >();
    for (const [resourceId, capacity] of capacityOf) {
      const free: Array<ResourceWindow & { remaining: number }> = [];
      for (const segment of this.profile(
        byResource.get(resourceId) ?? [],
        clipped,
      )) {
        const remaining = capacity - segment.taken;
        if (remaining < quantity) {
          continue;
        }
        const last = free.at(-1);
        if (last?.endsAt === segment.startsAt && last.remaining === remaining) {
          last.endsAt = segment.endsAt;
        } else {
          free.push({
            startsAt: segment.startsAt,
            endsAt: segment.endsAt,
            remaining,
          });
        }
      }
      result.set(resourceId, free);
    }
    return result;
  }

  /**
   * The bookable slots of each resource on a grid: what a booking UI lays out
   * as buttons.
   *
   * Slots start every `granularityMinutes` from the window's own start (the
   * caller chooses the anchor by choosing the window) and last
   * `durationMinutes`; a slot is listed when it lies inside a stretch of
   * {@link availability} with at least `quantity` left all along, and ends
   * within the window. Built on {@link availability}, never beside it.
   */
  public async slots(
    resources: Array<{ resourceId: string; capacity: number }>,
    window: ResourceWindow,
    options: {
      granularityMinutes: number;
      durationMinutes: number;
      quantity?: number;
    },
  ): Promise<Map<string, ResourceWindow[]>> {
    const step = this.amount(options.granularityMinutes, "granularityMinutes");
    const duration = this.amount(options.durationMinutes, "durationMinutes");
    const clipped = this.interval(window);
    const free = await this.availability(resources, clipped, {
      quantity: options.quantity,
    });

    const first = Date.parse(clipped.startsAt);
    const last = Date.parse(clipped.endsAt);
    const result = new Map<string, ResourceWindow[]>();
    for (const [resourceId, intervals] of free) {
      // Every interval here already has room for the quantity, so contiguous
      // ones are one bookable run whatever room each has left.
      const runs: Array<[number, number]> = [];
      for (const it of intervals) {
        const [startsAt, endsAt] = [
          Date.parse(it.startsAt),
          Date.parse(it.endsAt),
        ];
        const run = runs.at(-1);
        if (run && run[1] === startsAt) {
          run[1] = endsAt;
        } else {
          runs.push([startsAt, endsAt]);
        }
      }

      const slots: ResourceWindow[] = [];
      for (
        let startsAt = first;
        startsAt + duration * 60_000 <= last;
        startsAt += step * 60_000
      ) {
        const endsAt = startsAt + duration * 60_000;
        if (runs.some(([from, to]) => from <= startsAt && endsAt <= to)) {
          slots.push({
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
          });
        }
      }
      result.set(resourceId, slots);
    }
    return result;
  }

  /**
   * Every live claim on these resources overlapping the window, in the order
   * they were written.
   *
   * ⚠️ Unbounded on purpose, and it must stay so: never a `paginate()`, never
   * a `limit`. Every claim this read drops is one the fit test cannot see, so a
   * page ceiling would declare a claim the winner by default. Club's own
   * booking check was bitten by exactly that, twice. One query for the whole
   * set of resources, clipped to the window by the overlap test itself.
   */
  protected async live(
    resourceIds: string[],
    window: ResourceWindow,
  ): Promise<ResourceReservationEntity[]> {
    if (resourceIds.length === 0) {
      return [];
    }
    const now = this.dateTime.nowISOString();
    return this.claims.findMany({
      where: {
        resourceId: { inArray: resourceIds },
        // Half-open overlap: a.startsAt < b.endsAt && b.startsAt < a.endsAt.
        startsAt: { lt: window.endsAt },
        endsAt: { gt: window.startsAt },
        or: [
          { status: { eq: "consumed" } },
          { status: { eq: "held" }, expiresAt: { gte: now } },
        ],
      },
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
  }

  /**
   * Whether `quantity` more still fits under `capacity` across the whole
   * window, given the claims that count.
   *
   * A sweep over the claims' endpoints, clipped to the window: the peak of
   * their concurrency is the room already taken at the busiest instant. Three
   * claims that overlap pairwise but never all at once peak at two, which is
   * why a plain sum of the overlapping claims would be wrong for any capacity
   * above one. An end and a start at the same instant do not stack: the end is
   * counted first, as the half-open interval says.
   */
  protected fits(
    claims: Array<ResourceWindow & { quantity: number }>,
    window: ResourceWindow,
    quantity: number,
    capacity: number,
  ): boolean {
    return this.peak(claims, window) + quantity <= capacity;
  }

  /**
   * The most room taken at any one instant of the window.
   */
  protected peak(
    claims: Array<ResourceWindow & { quantity: number }>,
    window: ResourceWindow,
  ): number {
    return Math.max(0, ...this.profile(claims, window).map((it) => it.taken));
  }

  /**
   * How much room the claims take over the window, as consecutive segments
   * that cover it end to end: the sweep both {@link fits} and
   * {@link availability} read, so a storefront and a claim can never disagree
   * about what is free.
   *
   * Each claim is clipped to the window and adds its quantity at its start and
   * takes it back at its end. Deltas at one instant are summed before the
   * segment is cut, which is the half-open rule: a claim ending at 10:00 and
   * one starting at 10:00 never stack.
   */
  protected profile(
    claims: Array<ResourceWindow & { quantity: number }>,
    window: ResourceWindow,
  ): Array<ResourceWindow & { taken: number }> {
    const deltas = new Map<string, number>([
      [window.startsAt, 0],
      [window.endsAt, 0],
    ]);
    for (const claim of claims) {
      const startsAt =
        claim.startsAt > window.startsAt ? claim.startsAt : window.startsAt;
      const endsAt =
        claim.endsAt < window.endsAt ? claim.endsAt : window.endsAt;
      if (startsAt < endsAt) {
        deltas.set(startsAt, (deltas.get(startsAt) ?? 0) + claim.quantity);
        deltas.set(endsAt, (deltas.get(endsAt) ?? 0) - claim.quantity);
      }
    }

    const points = [...deltas.keys()].sort();
    const segments: Array<ResourceWindow & { taken: number }> = [];
    let taken = 0;
    for (let i = 0; i < points.length - 1; i++) {
      taken += deltas.get(points[i]!)!;
      segments.push({ startsAt: points[i]!, endsAt: points[i + 1]!, taken });
    }
    return segments;
  }

  // -------------------------------------------------------------------------
  // Normalising

  /**
   * Normalise an interval to `toISOString()`'s shape, refusing one that cannot
   * be claimed.
   *
   * Every stored instant goes through here, because the ledger compares them
   * as strings: `2026-09-26T18:00:00+02:00` and `2026-09-26T16:00:00.000Z` are
   * the same instant and sort nowhere near each other. An instant without an
   * offset is refused rather than read in the server's time zone.
   *
   * @throws InvalidIntervalError
   */
  public interval(window: ResourceWindow): ResourceWindow {
    const startsAt = this.instant(window.startsAt, "startsAt");
    const endsAt = this.instant(window.endsAt, "endsAt");
    if (endsAt <= startsAt) {
      throw new InvalidIntervalError(
        `An interval must end after it starts: [${startsAt}, ${endsAt}).`,
      );
    }
    return { startsAt, endsAt };
  }

  protected instant(value: string, field: string): string {
    const iso =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
    const ms =
      typeof value === "string" && iso.test(value) ? Date.parse(value) : NaN;
    if (Number.isNaN(ms)) {
      throw new InvalidIntervalError(
        `${field} must be an ISO 8601 instant with an offset, such as 2026-09-26T16:00:00.000Z; got '${value}'.`,
      );
    }
    return new Date(ms).toISOString();
  }

  protected amount(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 1) {
      throw new InvalidIntervalError(
        `${field} must be a whole number of at least 1; got ${value}.`,
      );
    }
    return value;
  }

  protected lockKey(resourceId: string) {
    return { namespace: ResourceService.LOCK_NAMESPACE, key: resourceId };
  }
}
