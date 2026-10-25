import {
  DashboardMetricRegistry,
  ProjectMomentumService,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
  type Project,
} from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { dashboardFilterFields } from "@lore/core/web";
import { Alepha, AlephaError } from "alepha";
import { audits } from "alepha/api/audits";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class CoreTileRepositories {
  audits = $repository(audits);
}

/**
 * A momentum read that cannot reach the dataset, as on 2026-08-11.
 */
class UnreachableMomentum extends ProjectMomentumService {
  override async read(): Promise<
    Array<{ projectId: number; counts: number[] }>
  > {
    throw new AlephaError("Analytics Engine unavailable (spec)");
  }
}

/**
 * The core tiles of #E77 (#Q2659): activity feed, momentum and a note.
 */
describe("dashboard core tiles", () => {
  let alepha: Alepha;

  afterEach(async () => {
    await alepha.stop();
  });

  const boot = async (failMomentum = false) => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    // Substituted first, before anything injects it.
    if (failMomentum) {
      alepha.with({
        provide: ProjectMomentumService,
        use: UnreachableMomentum,
      });
    }
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    alepha.with(ReadCounter);
    alepha.inject(TestEntityRepositories);
    const repos = alepha.inject(CoreTileRepositories);
    await alepha.start();
    return repos;
  };

  const projectOf = async (
    shape?: Parameters<typeof createTestProject>[1],
  ): Promise<{ project: Project; user: UserAccountToken }> => {
    const project = await createTestProject(alepha, shape);
    await createTestMember(alepha, project, project.createdBy!);
    return { project, user: { id: project.createdBy!, roles: ["user"] } };
  };

  const resolve = async (
    project: Project,
    user: UserAccountToken,
    metric: string,
    filters: Record<string, unknown> = {},
  ): Promise<DashboardCardValue> =>
    (
      await alepha.inject(DashboardMetricRegistry).resolveForProject(
        [
          {
            id: 1,
            metric,
            scope: { kind: "projects", projectIds: [project.id] },
            filters,
            size: 1,
            position: 0,
          },
        ],
        user,
        project,
      )
    )[0]!;

  describe("activityFeed", () => {
    it("lists the window's writes, narrowed to the enabled capabilities", async ({
      expect,
    }) => {
      const repos = await boot();
      const { project, user } = await projectOf({
        capabilities: [{ key: "work" }],
      });
      const at = alepha.inject(DateTimeProvider).nowISOString();
      for (const [type, description] of [
        ["quest", "accepted a quest"],
        ["folio", "edited a folio"],
      ]) {
        await repos.audits.create({
          scopeType: "project",
          scopeId: String(project.id),
          type: type!,
          action: "update",
          resourceType: type,
          resourceId: "12",
          description,
          userId: user.id,
          createdAt: at,
        });
      }

      const value = await resolve(project, user, "activityFeed");

      // Knowledge is off: its folio row is not this project's activity.
      expect(value.rows?.map((row) => [row.id, row.title])).toEqual([
        ["Q12", "accepted a quest"],
      ]);
    });

    it("is empty with nothing in the window", async ({ expect }) => {
      await boot();
      const { project, user } = await projectOf();

      expect((await resolve(project, user, "activityFeed")).empty).toBe(
        "noActivity",
      );
    });
  });

  describe("momentum", () => {
    it("fails rather than drawing quiet days when the read fails", async ({
      expect,
    }) => {
      await boot(true);
      const { project, user } = await projectOf();

      const value = await resolve(project, user, "momentum");

      expect(value.ok).toBe(false);
      expect(value.series).toBeUndefined();
    });

    it("answers noActivity, not a chart of zeros, for a quiet window", async ({
      expect,
    }) => {
      await boot();
      const { project, user } = await projectOf();

      const value = await resolve(project, user, "momentum");

      expect(value.ok).toBe(true);
      expect(value.empty).toBe("noActivity");
    });
  });

  describe("note", () => {
    it("is empty while blank, and offers a markdown text field", async ({
      expect,
    }) => {
      await boot();
      const { project, user } = await projectOf();
      const catalog = alepha.inject(DashboardMetricCatalog);

      expect((await resolve(project, user, "note")).empty).toBe("noData");
      expect(
        (await resolve(project, user, "note", { markdown: "Read **me**" }))
          .empty,
      ).toBeUndefined();
      expect(
        dashboardFilterFields(catalog.get("note").filters).map((field) => [
          field.name,
          field.text,
        ]),
      ).toEqual([["markdown", true]]);
    });
  });
});
