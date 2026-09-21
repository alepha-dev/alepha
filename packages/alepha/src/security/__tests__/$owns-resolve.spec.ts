import { $inject, $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $owns } from "../primitives/$owns.ts";
import { OwnedResourceProvider } from "../providers/OwnedResourceProvider.ts";

// The shape this option exists for: a deployment holding exactly ONE of
// something, whose routes therefore name it nowhere.
const clubs = $entity({
  name: "resolve_clubs",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const members = $entity({
  name: "resolve_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    clubId: z.text(),
    userId: z.text(),
  }),
});

const owner: UserAccountToken = { id: "u1", realm: "default", roles: [] };
const member: UserAccountToken = { id: "u2", realm: "default", roles: [] };
const stranger: UserAccountToken = { id: "u3", realm: "default", roles: [] };

const createApp = (resolve: () => string | undefined | Promise<string>) => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });

  class ClubService {
    clubs = $repository(clubs);
    members = $repository(members);
    owned = $inject(OwnedResourceProvider);

    read = $pipeline({
      use: [
        $owns({
          repository: () => this.clubs,
          // No `param`: nothing in the request names the club.
          resolve: () => resolve() as string,
          owner: "createdBy",
          via: {
            repository: () => this.members,
            resource: "clubId",
            user: "userId",
          },
        }),
      ],
      handler: async () => this.owned.get<{ title: string }>().title,
    });
  }

  return { alepha, service: alepha.inject(ClubService) };
};

const seed = async (service: { clubs: any; members: any }) => {
  await service.clubs.create({ id: "c1", createdBy: "u1", title: "Padel" });
  await service.members.create({ id: "m1", clubId: "c1", userId: "u2" });
};

const as = (alepha: Alepha, user: UserAccountToken) => {
  alepha.set("alepha.http.request", {
    params: {},
    query: {},
    user,
  } as any);
};

describe("$owns resolve", () => {
  it("gates a resource the request never names", async ({ expect }) => {
    const { alepha, service } = createApp(() => "c1");
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner);
      expect(await service.read()).toBe("Padel");
    });
  });

  it("awaits an async resolver", async ({ expect }) => {
    const { alepha, service } = createApp(async () => "c1");
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, member);
      expect(await service.read()).toBe("Padel");
    });
  });

  it("still denies a caller who is neither owner nor member", async ({
    expect,
  }) => {
    const { alepha, service } = createApp(() => "c1");
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, stranger);
      await expect(service.read()).rejects.toThrow(ForbiddenError);
    });
  });

  it("throws rather than denying when the resolver finds nothing", async ({
    expect,
  }) => {
    // The distinction the option turns on: an unwired deployment is a
    // configuration fault, and reporting it as a 403 sends whoever reads the
    // log looking for a permission that was never the problem.
    const { alepha, service } = createApp(() => undefined);
    await alepha.start();
    await seed(service);

    await alepha.context.run(async () => {
      as(alepha, owner);
      await expect(service.read()).rejects.toThrow(
        /`resolve` returned no resource id/,
      );
      await expect(service.read()).rejects.not.toThrow(ForbiddenError);
    });
  });

  it("refuses a gate naming both param and resolve, at declaration time", ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });

    expect(() =>
      alepha.inject(
        class {
          clubs = $repository(clubs);
          read = $pipeline({
            use: [
              $owns({
                repository: () => this.clubs,
                param: "clubId",
                resolve: () => "c1",
                owner: "createdBy",
              }),
            ],
            handler: async () => true,
          });
        },
      ),
    ).toThrow(/both name the resource id/);
  });

  it("refuses a gate naming neither", ({ expect }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });

    expect(() =>
      alepha.inject(
        class {
          clubs = $repository(clubs);
          read = $pipeline({
            use: [
              $owns({
                repository: () => this.clubs,
                owner: "createdBy",
              } as any),
            ],
            handler: async () => true,
          });
        },
      ),
    ).toThrow(/a gate needs a resource id/);
  });

  it("refuses from and cast beside a resolver rather than ignoring them", ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });

    expect(() =>
      alepha.inject(
        class {
          clubs = $repository(clubs);
          read = $pipeline({
            use: [
              $owns({
                repository: () => this.clubs,
                resolve: () => "c1",
                from: "body",
                owner: "createdBy",
              }),
            ],
            handler: async () => true,
          });
        },
      ),
    ).toThrow(/`from` and `cast` describe reading the id off the request/);
  });
});
