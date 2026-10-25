import { $inject, AlephaError, $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $owns } from "../primitives/$owns.ts";
import { OwnedResourceProvider } from "../providers/OwnedResourceProvider.ts";

const projects = $entity({
  name: "from_projects",
  schema: z.object({
    // An INTEGER key on purpose: it is what makes the difference between a
    // path segment (text) and a decoded body value (number) observable.
    id: db.primaryKey(z.integer()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const members = $entity({
  name: "from_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.integer(),
    userId: z.text(),
  }),
});

const owner: UserAccountToken = { id: "u1", realm: "default", roles: [] };
const member: UserAccountToken = { id: "u2", realm: "default", roles: [] };
const stranger: UserAccountToken = { id: "u3", realm: "default", roles: [] };

const gate = (from?: "params" | "query" | "body") => ({
  param: "projectId",
  from,
  owner: "createdBy",
});

const createApp = () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });

  class ProjectService {
    projects = $repository(projects);
    members = $repository(members);
    owned = $inject(OwnedResourceProvider);

    protected owns(from?: "params" | "query" | "body") {
      return $owns({
        ...gate(from),
        repository: () => this.projects,
        via: {
          repository: () => this.members,
          resource: "projectId",
          user: "userId",
        },
      });
    }

    fromParams = $pipeline({
      use: [this.owns()],
      handler: async () => this.owned.get<{ title: string }>().title,
    });

    fromQuery = $pipeline({
      use: [this.owns("query")],
      handler: async () => this.owned.get<{ title: string }>().title,
    });

    fromBody = $pipeline({
      use: [this.owns("body")],
      handler: async () => this.owned.get<{ title: string }>().title,
    });
  }

  return { alepha, service: alepha.inject(ProjectService) };
};

const seed = async (service: ReturnType<typeof createApp>["service"]) => {
  await service.projects.create({ id: 1, createdBy: "u1", title: "Alpha" });
  await service.members.create({ id: "m1", projectId: 1, userId: "u2" });
};

const as = (
  alepha: Alepha,
  user: UserAccountToken,
  request: Record<string, unknown>,
) => {
  alepha.set("alepha.http.request", {
    params: {},
    query: {},
    ...request,
    user,
  } as any);
};

describe("$owns from", () => {
  it("reads a path segment, which is still text", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner, { params: { projectId: "1" } });
      expect(await service.fromParams()).toBe("Alpha");
    });
  });

  it("reads the query string", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner, { query: { projectId: "1" } });
      expect(await service.fromQuery()).toBe("Alpha");
    });
  });

  it("reads the body", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      // A number, not a string: `validateRequest` has already decoded the
      // body against its schema by the time a guard runs. This is the case
      // `cast: (raw: string) => unknown` used to misdescribe.
      as(alepha, owner, { body: { projectId: 1 } });
      expect(await service.fromBody()).toBe("Alpha");
    });
  });

  it("gates a body value like any other, membership included", async ({
    expect,
  }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, member, { body: { projectId: 1 } });
      expect(await service.fromBody()).toBe("Alpha");
    });
  });

  it("refuses a caller who names a project they are not in", async ({
    expect,
  }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      // The point of the body source: the id is caller-controlled, and the
      // gate is what makes that harmless.
      as(alepha, stranger, { body: { projectId: 1 } });
      await expect(service.fromBody()).rejects.toThrow(ForbiddenError);
    });
  });

  it("names the source it searched when the value is missing", async ({
    expect,
  }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner, { body: {} });
      // Not "declare it in the path": that sends the reader hunting through a
      // route definition for a value that was never going to be there.
      await expect(service.fromBody()).rejects.toThrow(
        /'projectId' is not present in the body/,
      );
    });
  });

  it("still points at the path when params is the source", async ({
    expect,
  }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner, { params: {} });
      await expect(service.fromParams()).rejects.toThrow(
        /is not present in the params of this handler\. Declare it in the path/,
      );
    });
  });

  it("treats an explicit null as absent", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      // An optional column left empty. Querying for `id = null` would 404
      // with a message about a missing row, hiding the real fault.
      as(alepha, owner, { body: { projectId: null } });
      await expect(service.fromBody()).rejects.toThrow(AlephaError);
    });
  });

  it("refuses a non-scalar id rather than handing it to the query", async ({
    expect,
  }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      // What an UNDECLARED body field can carry: request validation only
      // covers what the schema names, and `from: "body"` is the source a
      // caller controls.
      as(alepha, owner, { body: { projectId: { gt: 0 } } });
      await expect(service.fromBody()).rejects.toThrow(
        /is a object, not an id/,
      );
    });
  });

  it("survives a handler with no body at all", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner, {});
      await expect(service.fromBody()).rejects.toThrow(AlephaError);
    });
  });
});
