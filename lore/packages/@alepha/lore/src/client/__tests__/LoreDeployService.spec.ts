import { Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaLoreClient } from "../index.ts";
import { LoreApiClient } from "../services/LoreApiClient.ts";
import { LoreDeployService } from "../services/LoreDeployService.ts";

/**
 * Deploying a copy from another server.
 *
 * ⚠️ **Two properties carry this file.** A copy that does not exist is a
 * refusal unless the caller explicitly asked to make one, because minting a
 * deploy target as a side effect of a typo in `env` is how a fleet grows a copy
 * nobody meant to make. And a newly created copy inherits its estate rather
 * than taking an id from the caller, because a client that can name an
 * arbitrary estate can deploy into somebody else's cloud account.
 */

/**
 * A recording stand-in for the one class that knows an HTTP path.
 *
 * Substituted through DI rather than mocked - `LoreApiClient` is the seam that
 * exists for this - so the flow under test is the real one and only the wire
 * is fake.
 */
class FakeApi extends LoreApiClient {
  public readonly calls: Array<{ method: string; path: string; body?: any }> =
    [];

  /**
   * `path` to a handler. A path with no handler is a 404, which is what makes
   * "the copy does not exist" the default rather than something each case has
   * to arrange.
   */
  public routes: Record<string, (body?: any) => unknown> = {};

  public override async projectId(): Promise<number> {
    return 1;
  }

  public override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    this.calls.push({ method, path, body });
    const route = this.routes[`${method} ${path}`];
    if (!route) {
      throw new AlephaError(`no route: ${method} ${path}`, {
        cause: { status: 404 } as never,
      });
    }
    return route(body) as T;
  }
}

const setup = (routes: Record<string, (body?: any) => unknown> = {}) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      LORE_URL: "https://lore.example.com",
      LORE_API_KEY: "k",
      LORE_PROJECT: "club",
    },
  })
    .with({ provide: LoreApiClient, use: FakeApi })
    .with(AlephaLoreClient);

  const api = alepha.inject(FakeApi);
  api.routes = routes;
  const service = alepha.inject(LoreDeployService);

  // The clock the poll reads. Owned by the test so `follow` runs to its end,
  // and to its timeout, with no real second passing.
  let clock = 0;
  Object.assign(service as unknown as Record<string, unknown>, {
    dateTime: {
      nowMillis: () => clock,
      wait: async (ms: number) => {
        clock += ms;
      },
    },
  });

  return { alepha, api, service };
};

const anInstance = (over: Record<string, unknown> = {}) => ({
  id: "inst-1",
  app: "club",
  env: "wassup",
  estateId: "est-1",
  ...over,
});

/**
 * The happy path's four routes, with the run already terminal.
 */
const shipped = (over: Record<string, unknown> = {}) => ({
  "GET /api/projects/1/apps/club/wassup": () => anInstance(),
  "POST /api/projects/1/apps/inst-1/deployments": () => ({
    id: "dep-1",
    status: "queued",
  }),
  "GET /api/projects/1/deployments/dep-1": () => ({
    id: "dep-1",
    app: "club",
    tag: "latest",
    status: "succeeded",
    url: "https://wassup.club.example",
    log: [{ text: "live" }],
    ...over,
  }),
});

describe("deploying from another server", () => {
  describe("the copy has to exist", () => {
    it("refuses a copy that does not, and starts nothing", async () => {
      // ⚠️ The default, and the epic's rule: a missing copy is a refusal.
      const { api, service } = setup();

      await expect(
        service.deploy({ app: "club", env: "wassup" }),
      ).rejects.toThrow(/is not a deployed copy of this project/);
      expect(api.calls.filter((it) => it.method === "POST")).toEqual([]);
    });

    it("names `create: true` in the refusal, since that is the way through", async () => {
      const { service } = setup();

      await expect(
        service.deploy({ app: "club", env: "wassup" }),
      ).rejects.toThrow(/create: true/);
    });

    it("deploys an existing copy without creating anything", async () => {
      const { api, service } = setup(shipped());

      const result = await service.deploy({ app: "club", env: "wassup" });

      expect(result.url).toBe("https://wassup.club.example");
      expect(api.calls.map((it) => `${it.method} ${it.path}`)).toEqual([
        "GET /api/projects/1/apps/club/wassup",
        "POST /api/projects/1/apps/inst-1/deployments",
        "GET /api/projects/1/deployments/dep-1",
      ]);
    });
  });

  describe("creating one on purpose", () => {
    it("inherits the estate of the app's production copy", async () => {
      // The call a tenant signup makes: no infrastructure in it at all.
      // ⚠️ No route for `GET .../apps/club/wassup`, so the copy is genuinely
      // absent until this creates it - which is the state under test.
      const { api, service } = setup({
        "GET /api/projects/1/apps": () => ({
          items: [
            anInstance({ id: "i-old", env: "aaa-first", estateId: "est-2" }),
            anInstance({ id: "i-prod", env: "production", estateId: "est-9" }),
          ],
        }),
        "POST /api/projects/1/apps": () => anInstance({ estateId: undefined }),
        "PATCH /api/projects/1/apps/club/wassup": () => anInstance(),
        "POST /api/projects/1/apps/inst-1/deployments": () => ({
          id: "dep-1",
          status: "queued",
        }),
        "GET /api/projects/1/deployments/dep-1": () => ({
          id: "dep-1",
          app: "club",
          tag: "latest",
          status: "succeeded",
          url: "https://wassup.club.example",
          log: [],
        }),
      });

      const result = await service.deploy({
        app: "club",
        env: "wassup",
        create: true,
      });

      expect(result.url).toBe("https://wassup.club.example");
      // ⚠️ `production`, not the first by name - the same rule
      // `defaultAppInstance` applies server-side. `aaa-first` sorts first and
      // is in the list precisely so this cannot pass by taking [0].
      const patch = api.calls.find((it) => it.method === "PATCH");
      expect(patch?.body).toEqual({ estateId: "est-9" });
      // And the create itself carries no estate: two calls, because
      // `createApp` takes none.
      const created = api.calls.find(
        (it) => it.path === "/api/projects/1/apps" && it.method === "POST",
      );
      expect(created?.body).toEqual({ app: "club", env: "wassup" });
    });

    it("carries the address onto the new copy, which is what makes the answer a URL", async () => {
      // ⚠️ `DeployRunner` reads the domain off `app_instances.url`, and the
      // adapter answers a URL only when it put one into effect. A copy created
      // with no address deploys fine and answers nothing to link to.
      const { api, service } = setup({
        "GET /api/projects/1/apps": () => ({
          items: [anInstance({ id: "i-prod", env: "production" })],
        }),
        "POST /api/projects/1/apps": () => anInstance(),
        "PATCH /api/projects/1/apps/club/wassup": () => anInstance(),
        "POST /api/projects/1/apps/inst-1/deployments": () => ({
          id: "dep-1",
          status: "queued",
        }),
        "GET /api/projects/1/deployments/dep-1": () => ({
          id: "dep-1",
          app: "club",
          tag: "latest",
          status: "succeeded",
          url: "https://wassup.club.example",
          log: [],
        }),
      });

      await service.deploy({
        app: "club",
        env: "wassup",
        create: true,
        url: "https://wassup.club.example",
      });

      const created = api.calls.find(
        (it) => it.path === "/api/projects/1/apps" && it.method === "POST",
      );
      expect(created?.body).toEqual({
        app: "club",
        env: "wassup",
        url: "https://wassup.club.example",
      });
    });

    it("refuses an estate slug this project was not lent", async () => {
      // ⚠️ A slug resolved against the LENDING, never an id taken on trust.
      const { service } = setup({
        "GET /api/projects/1/estates": () => ({
          items: [{ id: "est-1", slug: "mine" }],
        }),
      });

      await expect(
        service.deploy({
          app: "club",
          env: "wassup",
          create: true,
          estate: "somebody-elses",
        }),
      ).rejects.toThrow(/No estate called 'somebody-elses' is lent/);
    });

    it("says so when no copy of the app names an estate to inherit", async () => {
      const { service } = setup({
        "GET /api/projects/1/apps": () => ({ items: [] }),
      });

      await expect(
        service.deploy({ app: "club", env: "wassup", create: true }),
      ).rejects.toThrow(/nowhere to inherit from/);
    });
  });

  describe("what goes on the wire", () => {
    it("sends a tag and nothing else to the deploy endpoint", async () => {
      // ⚠️ No estate on this call, ever: the destination is read by Lore from
      // the `app_instances` row. Folio #96 is the hole that closes.
      const { api, service } = setup(shipped());

      await service.deploy({ app: "club", env: "wassup", tag: "1.2.3" });

      const start = api.calls.find((it) => it.path.endsWith("/deployments"));
      expect(start?.body).toEqual({ tag: "1.2.3" });
    });

    it("defaults the tag to latest", async () => {
      const { api, service } = setup(shipped());

      await service.deploy({ app: "club", env: "wassup" });

      const start = api.calls.find((it) => it.path.endsWith("/deployments"));
      expect(start?.body).toEqual({ tag: "latest" });
    });
  });

  describe("following the run", () => {
    it("polls until terminal and answers the log as lines", async () => {
      let reads = 0;
      const { service } = setup({
        "GET /api/projects/1/apps/club/wassup": () => anInstance(),
        "POST /api/projects/1/apps/inst-1/deployments": () => ({
          id: "dep-1",
          status: "queued",
        }),
        "GET /api/projects/1/deployments/dep-1": () => {
          reads++;
          return reads < 3
            ? { id: "dep-1", app: "club", tag: "latest", status: "running" }
            : {
                id: "dep-1",
                app: "club",
                tag: "latest",
                status: "succeeded",
                url: "https://wassup.club.example",
                log: [{ text: "uploading" }, { text: "live" }],
              };
        },
      });

      const result = await service.deploy({ app: "club", env: "wassup" });

      expect(reads).toBe(3);
      expect(result.deployment.log).toEqual(["uploading", "live"]);
    });

    it("throws the run's own error when it fails", async () => {
      const { service } = setup(
        shipped({ status: "failed", error: "The Worker upload was rejected." }),
      );

      await expect(
        service.deploy({ app: "club", env: "wassup" }),
      ).rejects.toThrow(/The Worker upload was rejected\./);
    });

    it("gives up on its own deadline, saying the run continues", async () => {
      const { service } = setup({
        "GET /api/projects/1/apps/club/wassup": () => anInstance(),
        "POST /api/projects/1/apps/inst-1/deployments": () => ({
          id: "dep-1",
          status: "queued",
        }),
        "GET /api/projects/1/deployments/dep-1": () => ({
          id: "dep-1",
          app: "club",
          tag: "latest",
          status: "running",
        }),
      });

      await expect(
        service.deploy({ app: "club", env: "wassup", timeoutMs: 10_000 }),
      ).rejects.toThrow(/still running/);
    });
  });

  describe("telling an absent copy from a broken Lore", () => {
    it("rethrows anything that is not a 404 rather than creating a copy", async () => {
      // ⚠️ A revoked key must not become "the copy is missing", or `create`
      // would mint one to paper over an outage.
      const { api, service } = setup();
      api.routes["GET /api/projects/1/apps/club/wassup"] = () => {
        throw new AlephaError("Forbidden", {
          cause: { status: 403 } as never,
        });
      };

      await expect(
        service.deploy({ app: "club", env: "wassup", create: true }),
      ).rejects.toThrow(/Forbidden/);
      expect(api.calls.filter((it) => it.method === "POST")).toEqual([]);
    });
  });
});
