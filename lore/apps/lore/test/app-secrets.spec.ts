import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { AppSecretController } from "../src/api/controllers/AppSecretController.ts";
import { ProjectCapabilityController } from "../src/api/controllers/ProjectCapabilityController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { appInstances } from "../src/api/entities/appInstances.ts";
import { appSecrets } from "../src/api/entities/appSecrets.ts";
import { artifacts } from "../src/api/entities/artifacts.ts";
import { deployments } from "../src/api/entities/deployments.ts";
import { estateProjects } from "../src/api/entities/estateProjects.ts";
import { estates } from "../src/api/entities/estates.ts";
import { LoreApi } from "../src/api/index.ts";
import { AppSecretService } from "../src/api/services/AppSecretService.ts";
import { AppService } from "../src/api/services/AppService.ts";
import { CredentialSealService } from "../src/api/services/CredentialSealService.ts";
import { DeployService } from "../src/api/services/DeployService.ts";

/**
 * What one deployed copy runs with.
 *
 * ⚠️ **The property the whole quest turns on is that no read path answers a
 * value** - not to a member, not to the owner, not on the way back out of the
 * write that set it. Everything else here is a refusal, and the refusals are
 * the feature: a `DATABASE_URL` stored under that name would either be
 * overwritten silently or, worse, win and point a fresh deploy at somebody
 * else's database.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({ username: z.string(), email: z.email() });

class TestRows {
  public readonly secrets = $repository(appSecrets);
  public readonly estates = $repository(estates);
  public readonly grants = $repository(estateProjects);
  public readonly instances = $repository(appInstances);
  public readonly artifacts = $repository(artifacts);
  public readonly deployments = $repository(deployments);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      // ⚠️ Required, not decoration. `CredentialSealService` refuses the
      // published default secret in EVERY environment, tests included, so a
      // spec that seals without setting this fails at the first `set`.
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

describe("a deployed copy's environment", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  /**
   * An owner, a project with Apps and `deploy` on, and one copy.
   */
  const world = async () => {
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
          { body: { title: `Env ${crypto.randomUUID().slice(0, 8)}` } },
          { user },
        )
    ).data;

    // ⚠️ `deploy`, not `track`. The write endpoints take that option, and a
    // project with telemetry on and deploys off must not reach them.
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
          body: { app: "my-app", env: "b14-preview" },
        },
        { user },
      )
    ).data;

    return { user, project, instance };
  };

  const set = async (
    world: {
      user: { id: string };
      project: { id: number };
      instance: { id: string };
    },
    key: string,
    value: string,
  ) =>
    await alepha.inject(AppSecretController).setAppSecret.fetch(
      {
        params: { projectId: world.project.id, instanceId: world.instance.id },
        body: { key, value },
      },
      { user: world.user },
    );

  const list = async (world: {
    user: { id: string };
    project: { id: number };
    instance: { id: string };
  }) =>
    (
      await alepha.inject(AppSecretController).listAppSecrets.fetch(
        {
          params: {
            projectId: world.project.id,
            instanceId: world.instance.id,
          },
        },
        { user: world.user },
      )
    ).data;

  describe("what a read path may say", () => {
    it("never answers a value, on the write or on the list", async ({
      expect,
    }) => {
      const w = await world();

      const written = await set(w, "STRIPE_SECRET_KEY", "sk_live_abcdefghijkl");
      const listed = await list(w);

      // The response schema is a `pick` allowlist, so the sealed column is not
      // merely absent from the object - it cannot be added by being forgotten.
      const keys = Object.keys(written.data).sort();
      expect(keys).not.toContain("valueSealed");
      expect(JSON.stringify(listed)).not.toContain("sk_live_abcdefghijkl");
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].key).toBe("STRIPE_SECRET_KEY");
    });

    it("masks to a prefix, and says nothing at all about a short value", async ({
      expect,
    }) => {
      // ⚠️ Four characters of a six-character secret is not a hint, it is most
      // of the secret. The threshold is what makes the mask honest.
      const w = await world();

      await set(w, "LONG_ONE", "sk_live_abcdefghijkl");
      await set(w, "SHORT_ONE", "hunter2");

      const items = (await list(w)).items;
      const byKey = Object.fromEntries(items.map((it) => [it.key, it]));
      expect(byKey.LONG_ONE.valuePrefix).toBe("sk_l");
      expect(byKey.SHORT_ONE.valuePrefix).toBe("");
    });
  });

  describe("what is stored", () => {
    it("seals the value under its own label, never in cleartext", async ({
      expect,
    }) => {
      const w = await world();
      await set(w, "STRIPE_SECRET_KEY", "sk_live_abcdefghijkl");

      const [row] = await alepha.inject(TestRows).secrets.findMany({});
      expect(row.valueSealed).not.toContain("sk_live_abcdefghijkl");
      expect(row.keyVersion).toBe(CredentialSealService.KEY_VERSION);

      const seal = alepha.inject(CredentialSealService);
      // Opens under this quest's label...
      expect(
        seal.open(row.valueSealed, CredentialSealService.APP_SECRETS_PURPOSE),
      ).toBe("sk_live_abcdefghijkl");
      // ...and not under the estate's, which is the whole point of having two.
      expect(() =>
        seal.open(row.valueSealed, CredentialSealService.ESTATE_PURPOSE),
      ).toThrow();
    });

    it("replaces rather than duplicating when a name is set twice", async ({
      expect,
    }) => {
      const w = await world();
      await set(w, "TOKEN", "first-value-here");
      await set(w, "TOKEN", "second-value-here");

      const rows = await alepha.inject(TestRows).secrets.findMany({});
      expect(rows).toHaveLength(1);
      expect(
        alepha
          .inject(CredentialSealService)
          .open(rows[0].valueSealed, CredentialSealService.APP_SECRETS_PURPOSE),
      ).toBe("second-value-here");
    });

    it("normalises the name, so a reserved one cannot arrive in lower case", async ({
      expect,
    }) => {
      const w = await world();

      await expect(set(w, "database_url", "postgres://x")).rejects.toThrow(
        /set by the deploy, not here/,
      );
    });
  });

  describe("the derived names", () => {
    it.each(["DATABASE_URL", "R2_BUCKET_NAME"])(
      "refuses %s, naming why rather than storing it",
      async (key) => {
        // Folio #1209: the deploy provisions first and derives both from the
        // ids it just got, then regenerates the config. A value here would be
        // overwritten silently - or would win, and point a fresh deploy at
        // somebody else's database.
        const w = await world();

        await expect(set(w, key, "anything")).rejects.toThrow(
          /set by the deploy, not here/,
        );
      },
    );

    it("refuses a name that is not an environment variable at all", async ({
      expect,
    }) => {
      const w = await world();

      await expect(set(w, "not a key", "x")).rejects.toThrow(
        /is not an environment variable name/,
      );
    });
  });

  describe("opening the set for a deploy", () => {
    it("hands back every value, and is the only thing that does", async ({
      expect,
    }) => {
      const w = await world();
      await set(w, "A_KEY", "value-one-here");
      await set(w, "B_KEY", "value-two-here");

      expect(await alepha.inject(AppSecretService).open(w.instance.id)).toEqual(
        { A_KEY: "value-one-here", B_KEY: "value-two-here" },
      );
    });

    it("refuses the whole deploy when a row cannot be opened", async ({
      expect,
    }) => {
      // ⚠️ A gap in the set is worse than no deploy: the app boots half
      // configured and fails as whatever that variable was holding together.
      // This is what a rotated APP_SECRET looks like from in here.
      const w = await world();
      await set(w, "A_KEY", "value-one-here");

      const [row] = await alepha.inject(TestRows).secrets.findMany({});
      await alepha
        .inject(TestRows)
        .secrets.updateById(row.id, { valueSealed: "00:00:deadbeef" });

      await expect(
        alepha.inject(AppSecretService).open(w.instance.id),
      ).rejects.toThrow(/could not be opened/);
    });
  });

  describe("the variable a deploy mints for itself", () => {
    /**
     * ⚠️ The refusal it exists to prevent lands AFTER D1 and R2 are
     * provisioned and the migrations are applied, so a copy nobody set one on
     * deployed "successfully" and then answered 500 from five layers away.
     */
    it("mints APP_SECRET for a copy that has none", async ({ expect }) => {
      const w = await world();
      const secrets = alepha.inject(AppSecretService);

      expect(await secrets.open(w.instance.id)).toEqual({});
      await secrets.ensureGenerated(w.instance.id);

      const set = await secrets.open(w.instance.id);
      expect(Object.keys(set)).toEqual(["APP_SECRET"]);
      expect(set.APP_SECRET!.length).toBe(AppSecretService.GENERATED_LENGTH);
    });

    /**
     * ⚠️ The property that makes it durable state rather than a derived value.
     * Regenerating it signs out every session and makes anything the app
     * sealed with it unreadable, so a second deploy must read the row rather
     * than mint beside it.
     */
    it("mints once and never again", async ({ expect }) => {
      const w = await world();
      const secrets = alepha.inject(AppSecretService);

      await secrets.ensureGenerated(w.instance.id);
      const first = (await secrets.open(w.instance.id)).APP_SECRET;
      await secrets.ensureGenerated(w.instance.id);
      await secrets.ensureGenerated(w.instance.id);

      expect((await secrets.open(w.instance.id)).APP_SECRET).toBe(first);
      const rows = await alepha
        .inject(TestRows)
        .secrets.findMany({ where: { key: { eq: "APP_SECRET" } } });
      expect(rows.length).toBe(1);
    });

    /**
     * ⚠️ A copy replacing an existing deployment has to keep the value whose
     * sessions and sealed data are already out there, so generation fills a
     * gap rather than owning the name.
     */
    it("leaves an operator's own value alone", async ({ expect }) => {
      const w = await world();
      const secrets = alepha.inject(AppSecretService);
      await set(w, "APP_SECRET", "the-one-already-in-production");

      await secrets.ensureGenerated(w.instance.id);

      expect((await secrets.open(w.instance.id)).APP_SECRET).toBe(
        "the-one-already-in-production",
      );
    });

    it("survives two deploys of one copy racing to mint it", async ({
      expect,
    }) => {
      // ⚠️ Both find nothing and both insert; the unique index fails the
      // loser, whose deploy must not die over a value the winner already
      // stored correctly for both.
      const w = await world();
      const secrets = alepha.inject(AppSecretService);

      await Promise.all([
        secrets.ensureGenerated(w.instance.id),
        secrets.ensureGenerated(w.instance.id),
      ]);

      const rows = await alepha
        .inject(TestRows)
        .secrets.findMany({ where: { key: { eq: "APP_SECRET" } } });
      expect(rows.length).toBe(1);
    });
  });

  describe("the sigil a copy is given at creation", () => {
    /**
     * ⚠️ The whole reason this is one operation. `sigils` keeps a `tokenHash`
     * and a `tokenPrefix`, never the token, so Lore holds the plaintext for
     * the length of the mint and cannot produce it for anybody afterwards -
     * itself included. Minting and storing therefore cannot be two calls.
     */
    it("mints one and seals its key into the copy's environment", async ({
      expect,
    }) => {
      const w = await world();
      const apps = alepha.inject(AppService);

      const result = await apps.provisionSigil(w.instance as never, {
        createdBy: w.user.id,
      });

      expect(result.minted).toBe(true);
      const stored = await alepha.inject(AppSecretService).open(w.instance.id);
      expect(stored.SIGIL_KEY).toMatch(/^sg_/);
    });

    it("never puts the token in a response", async ({ expect }) => {
      // The value exists, and no read path answers it - the property the whole
      // of this file is about, held for a credential Lore minted itself. The
      // four-character prefix is the same mask every variable gets, and it is
      // what `sigils.tokenPrefix` already shows so a page can name a key.
      const w = await world();
      await alepha
        .inject(AppService)
        .provisionSigil(w.instance as never, { createdBy: w.user.id });

      const rows = (await list(w)).items;
      const row = rows.find(
        (it: { key: string }) => it.key === "SIGIL_KEY",
      ) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.value).toBeUndefined();
      expect(String(row.valuePrefix).length).toBe(
        AppSecretService.PREFIX_LENGTH,
      );

      const full = (await alepha.inject(AppSecretService).open(w.instance.id))
        .SIGIL_KEY as string;
      expect(JSON.stringify(row)).not.toContain(full);
    });

    /**
     * ⚠️ A `--sigil` left in a CI command must not fail every run after the
     * first, so a copy already carrying its key is answered rather than
     * refused - and no second credential is minted, which would split its
     * analytics history in two.
     */
    it("is a no-op for a copy already carrying its key", async ({ expect }) => {
      const w = await world();
      const apps = alepha.inject(AppService);
      await apps.provisionSigil(w.instance as never, { createdBy: w.user.id });
      const first = (await alepha.inject(AppSecretService).open(w.instance.id))
        .SIGIL_KEY;

      const again = await apps.provisionSigil(
        { ...w.instance, sigilId: "set" } as never,
        { createdBy: w.user.id },
      );

      expect(again.minted).toBe(false);
      expect(
        (await alepha.inject(AppSecretService).open(w.instance.id)).SIGIL_KEY,
      ).toBe(first);
    });

    /**
     * ⚠️ The case that cannot be repaired, and must say so rather than
     * silently rotating: an app reporting happily with a key its operator
     * pasted would stop the moment a new one was minted underneath it.
     */
    it("refuses a copy whose sigil exists with no stored key", async ({
      expect,
    }) => {
      const w = await world();

      await expect(
        alepha
          .inject(AppService)
          .provisionSigil({ ...w.instance, sigilId: "already" } as never, {
            createdBy: w.user.id,
          }),
      ).rejects.toThrow(/only a hash is kept/);
    });
  });

  describe("removing one", () => {
    it("removes it, and 404s a name that was never there", async ({
      expect,
    }) => {
      const w = await world();
      await set(w, "A_KEY", "value-one-here");

      await alepha.inject(AppSecretController).deleteAppSecret.fetch(
        {
          params: {
            projectId: w.project.id,
            instanceId: w.instance.id,
            key: "A_KEY",
          },
        },
        { user: w.user },
      );
      expect((await list(w)).items).toEqual([]);

      await expect(
        alepha.inject(AppSecretController).deleteAppSecret.fetch(
          {
            params: {
              projectId: w.project.id,
              instanceId: w.instance.id,
              key: "A_KEY",
            },
          },
          { user: w.user },
        ),
      ).rejects.toThrow(/No variable named/);
    });
  });

  describe("the deploy log", () => {
    it("carries no secret, on the path where a deploy fails", async ({
      expect,
    }) => {
      // ⚠️ The log is a `deployments` row every member of the project can
      // read, and a failure path writes more of it than a success does: the
      // fetch line, the error, and whatever the adapter said on the way down.
      // This drives a real run to a real failure with a real secret set and
      // reads the row back.
      const w = await world();
      const rows = alepha.inject(TestRows);
      const secret = "sk_live_donotleakthisvalue";
      await set(w, "STRIPE_SECRET_KEY", secret);

      const estate = await rows.estates.create({
        ownerUserId: w.user.id,
        slug: "an-account",
        type: "cloudflare",
        deployAllowed: true,
        accountId: "acct-1",
        credential: alepha
          .inject(CredentialSealService)
          .seal("cf-token", CredentialSealService.ESTATE_PURPOSE),
        credentialKeyVersion: CredentialSealService.KEY_VERSION,
      } as never);
      await rows.grants.create({
        estateId: estate.id,
        projectId: w.project.id,
      } as never);
      await rows.instances.updateById(w.instance.id, { estateId: estate.id });

      await rows.artifacts.create({
        projectId: w.project.id,
        app: "my-app",
        tag: "latest",
        runtime: "workerd",
        sha256: "a".repeat(64),
        size: 10,
        // A file id nothing stored, so the run fails at the fetch - after the
        // gate has passed and after the secret set has been opened.
        fileId: crypto.randomUUID(),
      } as never);

      const deploys = alepha.inject(DeployService);
      const queued = await deploys.queue({
        projectId: w.project.id,
        instanceId: w.instance.id,
        tag: "latest",
      });
      await expect(deploys.run(queued)).rejects.toThrow();

      const row = await rows.deployments.findById(queued.id);
      expect(row?.status).toBe("failed");
      // ⚠️ The log must be non-empty, or every assertion below passes for the
      // wrong reason. This is the line the runner writes after opening the
      // secret set and before failing on the bytes.
      expect(JSON.stringify(row?.log ?? [])).toContain("Fetching");
      expect(JSON.stringify(row?.log ?? [])).not.toContain(secret);
      expect(row?.error ?? "").not.toContain(secret);
      // ...and the key NAME is not a secret, so this is not asserting that
      // nothing about the environment is visible - only that no value is.
      expect(JSON.stringify(row)).not.toContain(secret);
    });
  });

  describe("the cross-project guard", () => {
    it("refuses an instance id from another project", async ({ expect }) => {
      // ⚠️ `$ownsProject` proves the caller owns `:projectId`; `:instanceId` is
      // a second, unrelated identifier from the same request. Without this
      // check an owner could read or write anybody's secret set by pairing
      // their own project id with somebody else's instance id.
      const mine = await world();
      const theirs = await world();

      await expect(
        alepha.inject(AppSecretController).listAppSecrets.fetch(
          {
            params: {
              projectId: mine.project.id,
              instanceId: theirs.instance.id,
            },
          },
          { user: mine.user },
        ),
      ).rejects.toThrow(/No such deployed copy/);
    });
  });
});
