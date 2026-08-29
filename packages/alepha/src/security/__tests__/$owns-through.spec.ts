import { $inject, $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { ForbiddenError, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";

import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $owns } from "../primitives/$owns.ts";
import { OwnedResourceProvider } from "../providers/OwnedResourceProvider.ts";

const projects = $entity({
  name: "through_projects",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const quests = $entity({
  name: "through_quests",
  schema: z.object({
    id: db.primaryKey(z.text()),
    // Deliberately NOT `db.ref(...)`: the null-FK case below has to be
    // insertable, and a real foreign key would refuse the orphan row.
    projectId: z.text().optional(),
    title: z.text(),
  }),
});

const comments = $entity({
  name: "through_comments",
  schema: z.object({
    id: db.primaryKey(z.text()),
    // No projectId: this is the shape that forces a chain - a comment knows
    // its quest, and only the quest knows the project.
    questId: z.text().optional(),
    body: z.text(),
  }),
});

const members = $entity({
  name: "through_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    userId: z.text(),
  }),
});

const owner: UserAccountToken = { id: "u1", realm: "default", roles: [] };
const member: UserAccountToken = { id: "u2", realm: "default", roles: [] };
const stranger: UserAccountToken = { id: "u3", realm: "default", roles: [] };

const createApp = () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });

  class QuestService {
    projects = $repository(projects);
    quests = $repository(quests);
    comments = $repository(comments);
    members = $repository(members);
    owned = $inject(OwnedResourceProvider);

    read = $pipeline({
      use: [
        $owns({
          repository: () => this.quests,
          param: "id",
          through: { column: "projectId", repository: () => this.projects },
          owner: "createdBy",
          via: {
            repository: () => this.members,
            resource: "projectId",
            user: "userId",
          },
        }),
      ],
      handler: async () => ({
        resource: this.owned.get<{ title: string }>().title,
        authority: this.owned.authority<{ title: string }>().title,
      }),
    });

    /**
     * The owner-only variant: no `via`, so the hop lands on the project and
     * the creator check is all that is left.
     */
    readAsOwner = $pipeline({
      use: [
        $owns({
          repository: () => this.quests,
          param: "id",
          through: { column: "projectId", repository: () => this.projects },
          owner: "createdBy",
        }),
      ],
      handler: async () => this.owned.authority<{ title: string }>().title,
    });

    /**
     * Two hops: comment to quest to project.
     */
    readComment = $pipeline({
      use: [
        $owns({
          repository: () => this.comments,
          param: "id",
          through: [
            { column: "questId", repository: () => this.quests },
            { column: "projectId", repository: () => this.projects },
          ],
          owner: "createdBy",
          via: {
            repository: () => this.members,
            resource: "projectId",
            user: "userId",
          },
        }),
      ],
      handler: async () => ({
        resource: this.owned.get<{ body: string }>().body,
        authority: this.owned.authority<{ title: string }>().title,
      }),
    });
  }

  return { alepha, service: alepha.inject(QuestService) };
};

const seed = async (service: ReturnType<typeof createApp>["service"]) => {
  await service.projects.create({ id: "p1", createdBy: "u1", title: "Alpha" });
  await service.quests.create({ id: "q1", projectId: "p1", title: "Ship it" });
  await service.members.create({ id: "m1", projectId: "p1", userId: "u2" });
  await service.comments.create({ id: "c1", questId: "q1", body: "Nice" });
};

const as = (
  alepha: Alepha,
  user: UserAccountToken,
  params: Record<string, string>,
) => {
  alepha.set("alepha.http.request", { params, user } as any);
};

describe("$owns through", () => {
  it("allows the owner of the authority row", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner, { id: "q1" });
      expect(await service.read()).toEqual({
        resource: "Ship it",
        authority: "Alpha",
      });
    });
  });

  it("allows a member of the authority row", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, member, { id: "q1" });
      expect((await service.read()).resource).toBe("Ship it");
    });
  });

  it("denies a stranger", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, stranger, { id: "q1" });
      await expect(service.read()).rejects.toThrow(ForbiddenError);
    });
  });

  it("denies a member of a DIFFERENT project", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);
    // The join row exists, just not for the project this quest belongs to. A
    // gate that matched membership against the quest id rather than the
    // resolved foreign key would find nothing here and deny by luck; one that
    // ignored the hop entirely would allow.
    await service.projects.create({ id: "p2", createdBy: "u1", title: "Beta" });
    await service.members.create({ id: "m2", projectId: "p2", userId: "u3" });

    await alepha.context.run(async () => {
      as(alepha, stranger, { id: "q1" });
      await expect(service.read()).rejects.toThrow(ForbiddenError);
    });
  });

  it("404s on a missing resource row", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner, { id: "nope" });
      await expect(service.read()).rejects.toThrow(NotFoundError);
    });
  });

  it("404s when the authority row is gone", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);
    await service.projects.deleteById("p1");

    await alepha.context.run(async () => {
      as(alepha, owner, { id: "q1" });
      await expect(service.read()).rejects.toThrow(NotFoundError);
    });
  });

  it("DENIES a null foreign key rather than letting it through", async ({
    expect,
  }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);
    await service.quests.create({ id: "orphan", title: "Nobody's" });

    await alepha.context.run(async () => {
      // The project's own creator, so this is not "denied because stranger":
      // an orphan is refused to everyone.
      as(alepha, owner, { id: "orphan" });
      await expect(service.read()).rejects.toThrow(ForbiddenError);
    });
  });

  it("denies an orphan even on the owner-only variant", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);
    await service.quests.create({ id: "orphan", title: "Nobody's" });

    await alepha.context.run(async () => {
      as(alepha, owner, { id: "orphan" });
      await expect(service.readAsOwner()).rejects.toThrow(ForbiddenError);
    });
  });

  it("lets a privileged identity through the hop", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, { ...stranger, ownership: false }, { id: "q1" });
      expect((await service.read()).authority).toBe("Alpha");
    });
  });

  it("publishes the authority row even without through", async ({ expect }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });

    class ProjectService {
      projects = $repository(projects);
      owned = $inject(OwnedResourceProvider);

      read = $pipeline({
        use: [
          $owns({
            repository: () => this.projects,
            param: "id",
            owner: "createdBy",
          }),
        ],
        // Without a hop the two carry the same row, which is what lets a call
        // site read `authority()` whether its endpoint hops or not. Equal,
        // not identical: every atom write is revalidated through its schema,
        // so the two accessors hand back separate objects.
        handler: async () => ({
          resource: this.owned.get<{ title: string }>(),
          authority: this.owned.authority<{ title: string }>(),
        }),
      });
    }

    const service = alepha.inject(ProjectService);
    await alepha.start();
    await service.projects.create({ id: "p1", createdBy: "u1", title: "A" });

    await alepha.context.run(async () => {
      as(alepha, owner, { id: "p1" });
      const { resource, authority } = await service.read();
      expect(authority).toEqual(resource);
      expect(authority).toMatchObject({ id: "p1", title: "A" });
    });
  });

  describe("chained hops", () => {
    it("walks comment to quest to project", async ({ expect }) => {
      const { alepha, service } = createApp();
      await alepha.start();
      await seed(service);

      await alepha.context.run(async () => {
        as(alepha, member, { id: "c1" });
        expect(await service.readComment()).toEqual({
          resource: "Nice",
          // The LAST hop is the authority, not the first one: a chain that
          // stopped at the quest would gate on `quests.createdBy` and match
          // membership rows against a quest id.
          authority: "Alpha",
        });
      });
    });

    it("refuses a stranger across the chain", async ({ expect }) => {
      const { alepha, service } = createApp();
      await alepha.start();
      await seed(service);

      await alepha.context.run(async () => {
        as(alepha, stranger, { id: "c1" });
        await expect(service.readComment()).rejects.toThrow(ForbiddenError);
      });
    });

    it("denies a null FK on the FIRST hop, not just the last", async ({
      expect,
    }) => {
      const { alepha, service } = createApp();
      await alepha.start();
      await seed(service);
      await service.comments.create({ id: "orphan", body: "Nobody's" });

      await alepha.context.run(async () => {
        as(alepha, owner, { id: "orphan" });
        await expect(service.readComment()).rejects.toThrow(ForbiddenError);
      });
    });

    it("404s when a row midway through the chain is gone", async ({
      expect,
    }) => {
      const { alepha, service } = createApp();
      await alepha.start();
      await seed(service);
      await service.quests.deleteById("q1");

      await alepha.context.run(async () => {
        as(alepha, owner, { id: "c1" });
        await expect(service.readComment()).rejects.toThrow(NotFoundError);
      });
    });
  });
});
