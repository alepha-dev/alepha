import type { Alepha } from "alepha";
import { $repositories } from "alepha/orm";
import { currentTenantAtom } from "alepha/security";
import { beforeEach, describe, expect, it } from "vitest";
import { tenantRelations } from "./relations.ts";

/**
 * Tenant isolation across relations.
 *
 * The sharpest tests in this suite, because being wrong here is a data breach
 * rather than a bug. `apps/club` runs one pooled worker for every tenant and
 * marks 47 of its entities with `db.organization()` — so a relation that
 * resolves without the tenant predicate hands one paying customer another's
 * rows.
 *
 * The fixture is built so nothing below can pass by accident: `courts` is
 * shared, and both tenants book the same court. Every foreign key here
 * legitimately matches rows from both tenants, so a relation that forgot to
 * scope would visibly return them.
 */
export class TenantApp {
  db = $repositories(tenantRelations);
}

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";

/**
 * Every dialect runs the same body: the predicate is the repository's, but
 * where it lands in the statement is not — a correlated subquery on SQLite and
 * D1, a lateral join on Postgres. A leak would be dialect-specific.
 */
export const tenancyTests = (
  label: string,
  open: () => Promise<{ alepha: Alepha; app: TenantApp }>,
) => {
  describe(`tenant isolation through relations (${label})`, () => {
    let alepha: Alepha;
    let app: TenantApp;

    /**
     * Scope everything that follows to a tenant — or to none, which is what a
     * background job or a platform-level read looks like.
     */
    const asTenant = (tenant?: string) => {
      alepha.store.set(currentTenantAtom, tenant ? { id: tenant } : undefined);
    };

    /**
     * One shared court, booked by both tenants, each booking carrying its own
     * participant and invoice.
     */
    const seed = async () => {
      // Written with no tenant resolved, which is how a row ends up global:
      // nothing stamps the column, so it stays NULL.
      asTenant(undefined);
      const court = await app.db.courts.create({ data: { name: "Court 1" } });

      const make = async (tenant: string, label: string) => {
        asTenant(tenant);
        const booking = await app.db.bookings.create({
          data: { label, courtId: court.id },
        });
        await app.db.participants.create({
          data: { name: `${label} player`, bookingId: booking.id },
        });
        await app.db.invoices.create({
          data: { amount: 100, bookingId: booking.id },
        });
        return booking;
      };

      const alphaBooking = await make(ALPHA, "alpha");
      const betaBooking = await make(BETA, "beta");

      return { court, alphaBooking, betaBooking };
    };

    beforeEach(async () => {
      ({ alepha, app } = await open());
    });

    describe("the fixture itself", () => {
      /**
       * Without this, every isolation assertion below could pass vacuously —
       * there would simply be nothing to leak.
       */
      it("really put both tenants' rows on the same court", async () => {
        const { court } = await seed();
        asTenant(undefined);

        const all = await app.db.bookings.base.findMany({
          where: { courtId: { eq: court.id } },
        });

        expect(all.map((b) => b.label).sort()).toEqual(["alpha", "beta"]);
      });
    });

    describe("reading down a relation", () => {
      /**
       * The call site the translation exists to protect: a relation included
       * with a bare `true` carries no filter of its own, so the predicate is
       * pushed in by the translation or not at all.
       */
      it("a relation included as `true` still sees only its own tenant", async () => {
        const { court } = await seed();
        asTenant(ALPHA);

        const found = await app.db.courts.findOne({
          where: { id: { eq: court.id } },
          include: { bookings: true },
        });

        expect(found?.bookings.map((b) => b.label)).toEqual(["alpha"]);
      });

      it("and the other tenant sees only theirs", async () => {
        const { court } = await seed();
        asTenant(BETA);

        const found = await app.db.courts.findOne({
          where: { id: { eq: court.id } },
          include: { bookings: true },
        });

        expect(found?.bookings.map((b) => b.label)).toEqual(["beta"]);
      });

      /**
       * Depth is where a predicate pushed onto the root alone would leak: the
       * participants are two levels down.
       */
      it("scopes every level of a nested include", async () => {
        const { court } = await seed();
        asTenant(ALPHA);

        const found = await app.db.courts.findOne({
          where: { id: { eq: court.id } },
          include: { bookings: { include: { participants: true } } },
        });

        expect(found?.bookings).toHaveLength(1);
        expect(found?.bookings[0]?.participants.map((p) => p.name)).toEqual([
          "alpha player",
        ]);
      });

      /**
       * A caller's own relation filter is added to the tenant predicate, never
       * substituted for it — the filter below matches both tenants' rows.
       */
      it("keeps scoping when the caller adds its own relation filter", async () => {
        const { court } = await seed();
        asTenant(ALPHA);

        const found = await app.db.courts.findOne({
          where: { id: { eq: court.id } },
          include: { bookings: { where: { label: { like: "%a%" } } } },
        });

        expect(found?.bookings.map((b) => b.label)).toEqual(["alpha"]);
      });

      /**
       * Reading *up* from a scoped row to a shared one still works: the global
       * court stays visible to both, which is what non-strict tenancy means.
       */
      it("still reaches a shared parent from a scoped child", async () => {
        const { court } = await seed();
        asTenant(ALPHA);

        const found = await app.db.bookings.findOne({
          where: { label: { eq: "alpha" } },
          include: { court: true },
        });

        expect(found?.court?.id).toBe(court.id);
      });
    });

    describe("agreement with the plain repository", () => {
      /**
       * The relational engine must not be more permissive than the repository
       * the rest of the application already trusts.
       */
      it("returns exactly what the plain repository returns", async () => {
        const { alphaBooking } = await seed();
        asTenant(ALPHA);

        const viaRelation = await app.db.courts.findMany({
          include: { bookings: true },
        });
        const viaRepository = await app.db.bookings.base.findMany({});

        expect(viaRelation.flatMap((c) => c.bookings).map((b) => b.id)).toEqual(
          viaRepository.map((b) => b.id),
        );
        expect(viaRepository.map((b) => b.id)).toEqual([alphaBooking.id]);
      });
    });

    describe("strict tenancy", () => {
      /**
       * A strict entity has no global-row escape. Read with no resolved tenant
       * it must refuse: returning every tenant's invoices is the exact failure
       * the flag exists to prevent, and returning none would hide it.
       */
      it("refuses a relation to a strict entity with no resolved tenant", async () => {
        await seed();
        asTenant(undefined);

        await expect(
          app.db.bookings.findMany({ include: { invoices: true } }),
        ).rejects.toThrow(/tenant/i);
      });

      it("refuses it as the root of the query too", async () => {
        await seed();
        asTenant(undefined);

        await expect(
          app.db.invoices.findMany({ include: { booking: true } }),
        ).rejects.toThrow(/tenant/i);
      });

      it("resolves normally once a tenant is set", async () => {
        await seed();
        asTenant(ALPHA);

        const rows = await app.db.bookings.findMany({
          include: { invoices: true },
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]!.invoices).toHaveLength(1);
      });

      it("shows one tenant nothing of another's strict rows", async () => {
        await seed();
        asTenant(BETA);

        const rows = await app.db.bookings.findMany({
          include: { invoices: true },
        });

        expect(rows.map((b) => b.label)).toEqual(["beta"]);
        expect(rows.flatMap((b) => b.invoices)).toHaveLength(1);
      });
    });

    describe("counting and paging", () => {
      it("counts only the tenant's rows behind a relational page", async () => {
        await seed();
        asTenant(ALPHA);

        const page = await app.db.bookings.paginate(
          { size: 10 },
          { include: { participants: true } },
          { count: true },
        );

        expect(page.page.totalElements).toBe(1);
        expect(page.content.map((b) => b.label)).toEqual(["alpha"]);
        expect(page.content[0]!.participants).toHaveLength(1);
      });
    });

    describe("writes", () => {
      /**
       * A nested create stamps the tenant on every row it writes, not only the
       * root — an unstamped child would be a global row visible to everyone.
       */
      it("stamps the tenant on nested children", async () => {
        const { court } = await seed();

        asTenant(ALPHA);
        await app.db.bookings.create({
          data: {
            label: "nested",
            courtId: court.id,
            participants: { create: [{ name: "nested player" }] },
          },
        });

        asTenant(BETA);
        const rows = await app.db.bookings.findMany({
          include: { participants: true },
        });

        expect(rows.flatMap((b) => b.participants).map((p) => p.name)).toEqual([
          "beta player",
        ]);
      });
    });
  });
};
