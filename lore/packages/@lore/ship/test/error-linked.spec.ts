import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  LoreShipApi,
  ProjectErrorController,
  SigilIngestService,
} from "../src/api/index.ts";
import { projectErrors, type Sigil, sigils } from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repos {
  sigils = $repository(sigils);
  errors = $repository(projectErrors);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);
  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repos);
  await alepha.start();
  const created = await entities.users.create({});
  const owner: UserAccountToken = { id: created.id, roles: ["user"] };
  const project = await createTestProject(alepha, { createdBy: owner.id });
  const sigil: Sigil = await repos.sigils.create({
    projectId: project.id,
    name: "acme/production",
    tokenHash: "hash-linked",
    tokenPrefix: "sg_linked",
    kinds: ["errors"],
  });
  return {
    alepha,
    repos,
    owner,
    projectId: project.id,
    sigil,
    controller: alepha.inject(ProjectErrorController),
    ingest: alepha.inject(SigilIngestService),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

/**
 * What a browser sends for a failed `$client` action: no stack worth the
 * name, the action, its route and the response's request id.
 */
const browserFailure = (w: World, action: string, requestId: string) =>
  w.ingest.absorb(w.sigil, {
    errors: [
      {
        name: "INTERNAL_SERVER_ERROR",
        message: `${action}: Internal Server Error`,
        stack: "",
        sourceUrl: "https://acme.example/acme/epics",
        origin: "client",
        action,
        route: `GET /api/${action}`,
        requestId,
      },
    ],
  } as never);

const serverFailure = (w: World, frame: string, requestId?: string) =>
  w.ingest.absorb(w.sigil, {
    errors: [
      {
        name: "SCHEMA_VALIDATION",
        message: "Invalid value at /settleSeconds",
        stack: `SchemaValidationError: x\n    at ${frame} (worker.js:1:1)`,
        sourceUrl: "/api/prompts",
        origin: "server",
        ...(requestId ? { requestId } : {}),
      },
    ],
  } as never);

const list = (w: World) =>
  w.controller.listProjectErrors.run(
    { params: { projectId: w.projectId }, query: { includeResolved: true } },
    { user: w.owner },
  );

/**
 * A browser report of a failed action names it, and links to the server
 * error of the same request (#Q4404).
 */
describe("a browser error of a failed action", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("is one group per action, not one per page", async ({ expect }) => {
    await browserFailure(w, "listPrompts", "req-1");
    await browserFailure(w, "getEpics", "req-2");
    await browserFailure(w, "listPrompts", "req-3");

    const { items } = await list(w);
    const byAction = Object.fromEntries(
      items.map((it) => [it.action, it.count]),
    );
    expect(byAction).toEqual({ listPrompts: 2, getEpics: 1 });
    const prompts = items.find((it) => it.action === "listPrompts");
    expect(prompts?.route).toBe("GET /api/listPrompts");
    expect(prompts?.message).toBe("listPrompts: Internal Server Error");
    // The newest request is the one kept.
    expect(prompts?.requestId).toBe("req-3");
  });

  it("links to the server error of the same request, and back", async ({
    expect,
  }) => {
    await serverFailure(w, "listPrompts", "req-9");
    await browserFailure(w, "listPrompts", "req-9");
    await browserFailure(w, "getEpics", "req-10");

    const { items } = await list(w);
    const server = items.find((it) => it.origin === "server");
    const browser = items.find((it) => it.action === "listPrompts");
    const unrelated = items.find((it) => it.action === "getEpics");
    expect(browser?.linkedError).toEqual({ id: server?.id, origin: "server" });
    expect(server?.linkedError).toEqual({ id: browser?.id, origin: "client" });
    expect(unrelated?.linkedError).toBeUndefined();
  });

  it("pairs by route when two actions failed in one batch request", async ({
    expect,
  }) => {
    await w.ingest.absorb(w.sigil, {
      errors: [
        {
          name: "SCHEMA_VALIDATION",
          message: "bad prompts",
          stack: "E\n    at listPrompts (worker.js:1:1)",
          sourceUrl: "/api/listPrompts",
          origin: "server",
          requestId: "batch-1",
        },
        {
          name: "DB_ERROR",
          message: "bad epics",
          stack: "E\n    at getEpics (worker.js:1:1)",
          sourceUrl: "/api/getEpics",
          origin: "server",
          requestId: "batch-1",
        },
      ],
    } as never);
    await browserFailure(w, "listPrompts", "batch-1");
    await browserFailure(w, "getEpics", "batch-1");

    const { items } = await list(w);
    const id = (pick: (it: (typeof items)[number]) => boolean) =>
      items.find(pick)?.id;
    expect(
      items.find((it) => it.action === "listPrompts")?.linkedError?.id,
    ).toBe(id((it) => it.message === "bad prompts"));
    expect(items.find((it) => it.action === "getEpics")?.linkedError?.id).toBe(
      id((it) => it.message === "bad epics"),
    );
    expect(
      items.find((it) => it.message === "bad epics")?.linkedError?.id,
    ).toBe(id((it) => it.action === "getEpics"));
  });

  it("keeps a group's request when a report names none", async ({ expect }) => {
    await serverFailure(w, "listPrompts", "req-5");
    await serverFailure(w, "listPrompts");

    const { items } = await list(w);
    expect(items[0]?.count).toBe(2);
    expect(items[0]?.requestId).toBe("req-5");
  });
});
