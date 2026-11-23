import { DashboardMetricRegistry } from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
  type Project,
  hostProjects,
  hosts,
} from "@lore/core/schemas";
import { monitors } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class ShipRepositories {
  hosts = $repository(hosts);
  loans = $repository(hostProjects);
  monitors = $repository(monitors);
}

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * The Hosts and Uptime cards of the Add card panel (#Q3781): what each
 * lists, and what gates it (Ship, its `uptime` option, `host:read`).
 */
describe("dashboard hosts and uptime cards", () => {
  let alepha: Alepha;
  let repos: ShipRepositories;
  let entities: TestEntityRepositories;
  let dateTime: DateTimeProvider;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: ":memory:" } });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    repos = alepha.inject(ShipRepositories);
    await alepha.start();
    dateTime = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const resolve = async (
    project: Project,
    metric: string,
    user: UserAccountToken = token(project.createdBy!),
  ): Promise<DashboardCardValue> =>
    (
      await alepha.inject(DashboardMetricRegistry).resolveForProject(
        [
          {
            id: 1,
            metric,
            scope: { kind: "projects", projectIds: [project.id] },
            filters: {},
            size: 1,
            position: 0,
          },
        ],
        user,
        project,
      )
    )[0]!;

  it("both are offered in the Add card panel: hosts in core's group, uptime in apps", ({
    expect,
  }) => {
    const catalog = alepha.inject(DashboardMetricCatalog);
    // Hosts are core's since #E166: the card needs no capability.
    expect(catalog.get("hosts")).toMatchObject({
      group: "core",
      boards: ["project"],
      requires: "host:read",
    });
    expect(catalog.get("hosts")?.needs).toBeUndefined();
    expect(catalog.get("uptime")).toMatchObject({
      group: "apps",
      boards: ["project"],
      needs: { capability: "ship", option: "uptime" },
    });
  });

  describe("hosts", () => {
    it("lists the project's own and lent hosts with their state, linking its own Bay console", async ({
      expect,
    }) => {
      const project = await createTestProject(alepha);
      const home = await createTestProject(alepha);
      const now = dateTime.nowISOString();
      await repos.hosts.create({
        projectId: project.id,
        ownerUserId: project.createdBy!,
        type: "bay",
        slug: "alpha",
        connectedAt: now,
        lastSeenAt: now,
      });
      await repos.hosts.create({
        projectId: project.id,
        ownerUserId: project.createdBy!,
        type: "bay",
        slug: "beta",
      });
      const lent = await repos.hosts.create({
        projectId: home.id,
        ownerUserId: home.createdBy!,
        type: "bay",
        slug: "gamma",
        connectedAt: now,
        lastSeenAt: now,
      });
      await repos.loans.create({ hostId: lent.id, projectId: project.id });

      const value = await resolve(project, "hosts");

      expect(value.ok).toBe(true);
      expect(value.value).toBe(2);
      expect(
        (value.rows ?? []).map((row) => [row.id, row.badge, row.state]),
      ).toEqual([
        ["alpha", "online", "ok"],
        ["beta", "offline", "bad"],
        ["gamma", "online", "ok"],
      ]);
      expect(value.rows?.[0]?.link).toEqual({
        route: "bay",
        params: { projectSlug: project.slug, hostSlug: "alpha" },
      });
      // A lent host's console is its home project's.
      expect(value.rows?.[2]?.link).toBeUndefined();
      expect(value.link?.route).toBe("projectSettingsHosts");
    });

    it("lists a host homed and lent here once, as a home host (#Q3821)", async ({
      expect,
    }) => {
      const project = await createTestProject(alepha);
      const now = dateTime.nowISOString();
      const host = await repos.hosts.create({
        projectId: project.id,
        ownerUserId: project.createdBy!,
        type: "bay",
        slug: "home-server",
        connectedAt: now,
        lastSeenAt: now,
      });
      // Its home project is also granted it, which makes it a deploy target.
      await repos.loans.create({ hostId: host.id, projectId: project.id });

      const value = await resolve(project, "hosts");

      expect((value.rows ?? []).map((row) => row.id)).toEqual(["home-server"]);
      expect(value.value).toBe(1);
      expect(value.detail).toEqual({ hosts: 1 });
      expect(value.rows?.[0]?.link).toEqual({
        route: "bay",
        params: { projectSlug: project.slug, hostSlug: "home-server" },
      });
    });

    it("answers noData with no host", async ({ expect }) => {
      const project = await createTestProject(alepha);
      expect((await resolve(project, "hosts")).empty).toBe("noData");
    });

    it("answers noAccess to a member without host:read", async ({ expect }) => {
      const project = await createTestProject(alepha);
      const reader = token(crypto.randomUUID());
      await entities.users.create({ id: reader.id });
      await alepha.context.run(() =>
        alepha.inject(RankService).save(
          project.organizationId!,
          {
            key: "no-hosts",
            name: "No hosts",
            permissions: ["project:read", "app:read"],
          },
          token(project.createdBy!),
        ),
      );
      await createTestMemberByProjectId(alepha, project.id, reader.id, {
        rank: "no-hosts",
      });

      const value = await resolve(project, "hosts", reader);

      expect(value.empty).toBe("noAccess");
      expect(value.rows).toBeUndefined();
    });
  });

  describe("uptime", () => {
    const monitor = (project: Project, name: string, status: string) =>
      repos.monitors.create({
        projectId: project.id,
        name,
        kind: "http",
        target: "https://example.test/health",
        status: status as "up",
        statusSince: dateTime.nowISOString(),
        nextCheckAt: dateTime.nowISOString(),
      });

    it("lists each monitor with its state, down first, linking its monitor", async ({
      expect,
    }) => {
      // `uptime` is off unless turned on, so the spec turns it on.
      const project = await createTestProject(alepha, {
        capabilities: [
          { key: "plan" },
          { key: "ship", options: { track: true, uptime: true } },
        ],
      });
      const site = await monitor(project, "Site", "up");
      await monitor(project, "Api", "down");

      const value = await resolve(project, "uptime");

      expect(value).toMatchObject({ ok: true, value: 1 });
      expect(
        (value.rows ?? []).map((row) => [row.title, row.badge, row.state]),
      ).toEqual([
        ["Api", "down", "bad"],
        ["Site", "up", "ok"],
      ]);
      expect(value.rows?.[1]?.link).toEqual({
        route: "projectMonitor",
        params: { projectSlug: project.slug, monitorId: site.id },
      });
      // Nothing measured yet: no bar rather than an empty one reading 0%.
      expect(value.rows?.[1]?.progress).toBeUndefined();
    });

    it("answers noData once Ship's uptime option is off", async ({
      expect,
    }) => {
      const project = await createTestProject(alepha, {
        capabilities: [
          { key: "plan" },
          { key: "ship", options: { uptime: false } },
        ],
      });
      await monitor(project, "Site", "up");

      const value = await resolve(project, "uptime");

      expect(value.empty).toBe("noData");
      expect(value.rows).toBeUndefined();
    });
  });
});
