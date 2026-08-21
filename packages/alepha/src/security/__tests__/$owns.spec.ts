import { $inject, $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { ForbiddenError } from "alepha/server";
import { describe, test } from "vitest";

import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $owns } from "../primitives/$owns.ts";
import { OwnedResourceProvider } from "../providers/OwnedResourceProvider.ts";

const projects = $entity({
  name: "owns_projects",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const members = $entity({
  name: "owns_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    userId: z.text(),
  }),
});

const owner: UserAccountToken = {
  id: "u1",
  realm: "default",
  roles: [],
};

const stranger: UserAccountToken = {
  id: "u2",
  realm: "default",
  roles: [],
};

const createApp = () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });

  class ProjectService {
    projects = $repository(projects);
    members = $repository(members);
    owned = $inject(OwnedResourceProvider);

    read = $pipeline({
      use: [
        $owns({
          repository: () => this.projects,
          param: "id",
          owner: "createdBy",
          via: {
            repository: () => this.members,
            resource: "projectId",
            user: "userId",
          },
        }),
      ],
      handler: async () => {
        return this.owned.get<{ id: string; title: string }>().title;
      },
    });
  }

  return { alepha, service: alepha.inject(ProjectService) };
};

describe("$owns", () => {
  test("allows the owner and exposes the loaded row", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await service.projects.create({
      id: "p1",
      createdBy: "u1",
      title: "Alpha",
    });

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        params: { id: "p1" },
        user: owner,
      } as any);

      expect(await service.read()).toBe("Alpha");
    });
  });

  test("denies a stranger", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await service.projects.create({
      id: "p1",
      createdBy: "u1",
      title: "Alpha",
    });

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        params: { id: "p1" },
        user: stranger,
      } as any);

      await expect(service.read()).rejects.toThrowError(ForbiddenError);
    });
  });

  test("allows a member via the join entity", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await service.projects.create({
      id: "p1",
      createdBy: "u1",
      title: "Alpha",
    });
    await service.members.create({ id: "m1", projectId: "p1", userId: "u2" });

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        params: { id: "p1" },
        user: stranger,
      } as any);

      expect(await service.read()).toBe("Alpha");
    });
  });

  test("denies once the membership row is gone", async ({ expect }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await service.projects.create({
      id: "p1",
      createdBy: "u1",
      title: "Alpha",
    });
    await service.members.create({ id: "m1", projectId: "p1", userId: "u2" });
    await service.members.deleteById("m1");

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        params: { id: "p1" },
        user: stranger,
      } as any);

      await expect(service.read()).rejects.toThrowError(ForbiddenError);
    });
  });

  test("lets a privileged identity through without a membership row", async ({
    expect,
  }) => {
    const { alepha, service } = createApp();
    await alepha.start();
    await service.projects.create({
      id: "p1",
      createdBy: "u1",
      title: "Alpha",
    });

    await alepha.context.run(async () => {
      // `ownership: false` is the privileged-identity marker $secure already
      // uses — an admin whose grant is not narrowed to rows they own.
      alepha.set("alepha.http.request", {
        params: { id: "p1" },
        user: { ...stranger, ownership: false },
      } as any);

      expect(await service.read()).toBe("Alpha");
    });
  });
});
