import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { ProjectCapabilityController } from "../src/api/controllers/ProjectCapabilityController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { appInstances } from "../src/api/entities/appInstances.ts";
import { estateProjects } from "../src/api/entities/estateProjects.ts";
import { estates } from "../src/api/entities/estates.ts";
import { LoreApi } from "../src/api/index.ts";
import { CredentialSealService } from "../src/api/services/CredentialSealService.ts";
import { LoreAudits } from "../src/api/services/LoreAudits.ts";
import { TeardownService } from "../src/api/services/TeardownService.ts";

/**
 * Removing what a copy's deploys made.
 *
 * ⚠️ **The refusals are the feature.** Every name a deploy provisions is
 * derived from `(project, env)`, so a teardown that recomputed one would be
 * willing to delete a resource on a LENT account that Lore never created. What
 * may go is what a deploy wrote down; everything else is refused by name.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

class TestRows {
  public readonly instances = $repository(appInstances);
  public readonly estates = $repository(estates);
  public readonly grants = $repository(estateProjects);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(TestRows);
  await alepha.start();
  return alepha;
};

describe("tearing a copy's resources down", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const world = async (resources?: Record<string, unknown>) => {
    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = (
      await alepha
        .inject(ProjectController)
        .createProject.fetch(
          { body: { title: `Down ${crypto.randomUUID().slice(0, 8)}` } },
          { user },
        )
    ).data;
    await alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: project.id, key: "apps" },
        body: { enabled: true, options: { deploy: true } },
      },
      { user },
    );
    const instance = (
      await alepha.inject(AppController).createApp.fetch(
        {
          params: { projectId: project.id },
          body: { app: "my-app", env: "production" },
        },
        { user },
      )
    ).data;

    const rows = alepha.inject(TestRows);
    const estate = await rows.estates.create({
      ownerUserId: user.id,
      type: "cloudflare",
      slug: `cf-${crypto.randomUUID().slice(0, 6)}`,
      deployAllowed: true,
      credentialStatus: "valid",
      accountId: "acct",
      // ⚠️ Sealed for real. `destroy` OPENS this, so a literal string fails as
      // "Invalid ciphertext format" - which reads like a teardown bug and is a
      // fixture bug.
      credential: alepha
        .inject(CredentialSealService)
        .seal("cf-token", CredentialSealService.ESTATE_PURPOSE),
    } as never);
    await rows.grants.create({
      estateId: estate.id,
      projectId: project.id,
    } as never);
    await rows.instances.updateById(instance.id, {
      estateId: estate.id,
      ...(resources === undefined
        ? {}
        : { resources: JSON.stringify(resources) }),
    });

    return { user, project, instance, rows };
  };

  const loaded = async (w: { instance: { id: string }; rows: TestRows }) =>
    (await w.rows.instances.findById(w.instance.id))!;

  describe("what it refuses", () => {
    /**
     * ⚠️ The rule the whole design rests on. Every copy deployed before Lore
     * recorded its resources has no record, and recomputing the names would
     * make a lent account's own database a candidate for deletion.
     */
    it("refuses a copy whose resources were never recorded", async ({
      expect,
    }) => {
      const w = await world();

      await expect(
        alepha.inject(TeardownService).destroy(await loaded(w)),
      ).rejects.toThrowError(/no record of what it created/);
    });

    it("answers plainly for a copy that provisioned nothing", async ({
      expect,
    }) => {
      // An empty record is a COMPLETE answer - a deploy ran and made nothing -
      // unlike an absent one, which is a question nobody can answer.
      const w = await world({});

      expect(
        await alepha.inject(TeardownService).destroy(await loaded(w)),
      ).toEqual({ removed: [], kept: [], failed: [] });
    });
  });

  describe("what the record means", () => {
    it("reads an absent record as unknown, not as empty", async ({
      expect,
    }) => {
      const w = await world();
      const service = alepha.inject(TeardownService);

      expect(service.read(await loaded(w))).toBeUndefined();
      expect(service.holdsResources(await loaded(w))).toBe(false);
    });

    it("knows a copy still holds something", async ({ expect }) => {
      const w = await world({ worker: "my-app-production" });

      expect(
        alepha.inject(TeardownService).holdsResources(await loaded(w)),
      ).toBe(true);
    });
  });

  describe("driving the estate", () => {
    /**
     * ⚠️ The case every other test in this file misses, and it is why a broken
     * injection reached production: the refusals return before the adapter is
     * touched, and an empty record returns before it too. Only a copy with
     * something recorded constructs the Cloudflare client at all.
     *
     * The credential is sealed for real rather than stubbed, because opening it
     * is on this path and a literal string fails as "Invalid ciphertext format"
     * - which reads like a teardown bug and is a fixture bug.
     */
    it("reaches Cloudflare, keeps the stores, reports the worker", async ({
      expect,
    }) => {
      const w = await world({
        worker: "w",
        d1: { name: "d", id: "i" },
        r2: "r",
      });

      const result = await alepha
        .inject(TeardownService)
        .destroy(await loaded(w));

      // The account is invented, so the delete cannot succeed - what is being
      // pinned is that it was ATTEMPTED, and that the two stores were not.
      expect(result.kept.sort()).toEqual(["d1:d", "r2:r"]);
      expect(result.failed.map((it) => it.resource)).toEqual(["worker"]);
      expect(result.removed).toEqual([]);
    });
  });

  describe("the record after a partial run", () => {
    /**
     * ⚠️ Struck as it goes, so a retry resumes rather than restarting. A run
     * that retried its own successes would answer "already gone" errors that
     * cannot be told apart from a delete that never worked.
     */
    it("keeps exactly what did not go", async ({ expect }) => {
      const w = await world({
        worker: "my-app-production",
        r2: "my-app-production",
        d1: { name: "my-app-production", id: "db-uuid" },
      });
      const service = alepha.inject(TeardownService);

      // @ts-expect-error reaching the protected striker: the alternative is a
      // fake Cloudflare account for one bookkeeping branch.
      await service.strike(w.instance.id, service.read(await loaded(w)), [
        "worker",
        "r2",
      ]);

      expect(service.read(await loaded(w))).toEqual({
        d1: { name: "my-app-production", id: "db-uuid" },
      });
    });
  });

  describe("deleting the copy itself", () => {
    /**
     * ⚠️ Deleting the row does not orphan the resources - it makes them
     * UNREACHABLE, since the row is the only place their names are written.
     */
    it("refuses while the estate still holds what Lore made", async ({
      expect,
    }) => {
      const w = await world({ worker: "my-app-production" });

      await expect(
        alepha.inject(AppController).deleteApp.fetch(
          {
            params: {
              projectId: w.project.id,
              app: "my-app",
              env: "production",
            },
            body: {},
          },
          { user: w.user },
        ),
      ).rejects.toThrowError(/still has a Worker, database or bucket/);
    });

    it("allows it when asked to forget", async ({ expect }) => {
      const w = await world({ worker: "my-app-production" });

      await alepha.inject(AppController).deleteApp.fetch(
        {
          params: { projectId: w.project.id, app: "my-app", env: "production" },
          body: { forget: true },
        },
        { user: w.user },
      );

      expect(await w.rows.instances.findById(w.instance.id)).toBeUndefined();
    });

    it("allows it for a copy that holds nothing", async ({ expect }) => {
      const w = await world();

      await alepha.inject(AppController).deleteApp.fetch(
        {
          params: { projectId: w.project.id, app: "my-app", env: "production" },
          body: {},
        },
        { user: w.user },
      );

      expect(await w.rows.instances.findById(w.instance.id)).toBeUndefined();
    });
  });

  describe("the endpoint, end to end", () => {
    /**
     * ⚠️ The case that shipped broken. Every other test here drives the
     * SERVICE; nothing drove the controller with a valid confirmation and a
     * real record, so the handler's audit call was never executed - and it
     * named an action the audit did not declare.
     *
     * It threw AFTER the teardown had run, so the endpoint answered 500 for
     * work that had succeeded: a Worker and a database were already gone, and
     * the caller was told the request failed.
     */
    it("answers the result rather than failing on its own bookkeeping", async ({
      expect,
    }) => {
      const w = await world({ worker: "w", d1: { name: "d", id: "i" } });

      const res = await alepha.inject(AppController).destroyAppResources.fetch(
        {
          params: {
            projectId: w.project.id,
            app: "my-app",
            env: "production",
          },
          body: { confirm: "my-app/production" },
        },
        { user: w.user },
      );

      // The account is invented so the worker delete cannot succeed - the
      // point is that the ENDPOINT answered instead of raising.
      expect(res.data.kept).toEqual(["d1:d"]);
      expect(
        res.data.failed.map((it: { resource: string }) => it.resource),
      ).toEqual(["worker"]);
    });

    /**
     * ⚠️ Separate from the case above, and it has to be. The handler no longer
     * lets a bookkeeping failure fail the request, so an undeclared action is
     * now swallowed rather than raised - right for the caller, and it would
     * leave the endpoint test green while nothing was recorded. This asserts
     * the declaration itself.
     *
     * `destroy` is deliberately not `delete`: one removes a Lore row and
     * touches nobody's cloud account, the other removes a Worker.
     */
    it("declares `destroy` as an auditable action", async ({ expect }) => {
      const actions = (
        alepha.inject(LoreAudits).app as unknown as {
          options: { actions: string[] };
        }
      ).options.actions;

      expect(actions).toContain("destroy");
      expect(actions).toContain("delete");
    });
  });

  describe("the confirmation", () => {
    it("refuses anything but the copy's own name", async ({ expect }) => {
      const w = await world({ worker: "my-app-production" });

      await expect(
        alepha.inject(AppController).destroyAppResources.fetch(
          {
            params: {
              projectId: w.project.id,
              app: "my-app",
              env: "production",
            },
            body: { confirm: "yes" },
          },
          { user: w.user },
        ),
      ).rejects.toThrowError(/Type "my-app\/production" to confirm/);
    });
  });
});
