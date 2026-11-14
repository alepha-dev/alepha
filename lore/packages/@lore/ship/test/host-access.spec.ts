import { ProjectSecurityService } from "@lore/core/api";
import { projectCapabilities } from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { Alepha } from "alepha";
import {
  MemberService,
  organizationConfigAtom,
  RankService,
} from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  BackupController,
  HostCommandController,
  HostController,
  HostExpiryJobs,
  HostService,
  LoreShipApi,
  ProjectHostController,
} from "../src/api/index.ts";
import { hosts } from "../src/schemas/index.ts";
import { createTestHost } from "../src/testing/hosts.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  DeployTestEntities,
} from "../src/testing/index.ts";

class Repositories {
  hosts = $repository(hosts);
  capabilities = $repository(projectCapabilities);
}

/**
 * Host access is the home project's rank (#Q3279, epic #E126): every act
 * on `/hosts/:hostId` goes through `$ownsProject` on the host row, so
 * the people who can act on a host are the members of its project whose
 * rank allows it, and nobody else.
 *
 * The cast, in one project owned by Owner: Reader (a plain Member, which
 * holds `host:read` and nothing more), Manager (a rank with
 * `host:create`, `host:update` and `host:delete`), and Stranger, in no
 * project of Owner's.
 */
describe("host access by the home project's rank", () => {
  let alepha: Alepha;
  let entities: DeployTestEntities;
  let repos: Repositories;
  let hostsApi: HostController;
  let commandsApi: HostCommandController;
  let lending: ProjectHostController;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        DATABASE_URL: ":memory:",
        APP_SECRET: "host-access-spec-secret",
      },
    });
    alepha
      .with(AlephaOrm)
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaEmail)
      .with(AlephaApiUsers)
      .with(LoreShipApi)
      .with(ReadCounter);
    entities = alepha.inject(DeployTestEntities);
    repos = alepha.inject(Repositories);
    await alepha.start();
    hostsApi = alepha.inject(HostController);
    commandsApi = alepha.inject(HostCommandController);
    lending = alepha.inject(ProjectHostController);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const person = async (name: string): Promise<UserAccountToken> => {
    const user = await entities.users.create({
      username: name,
      email: `${name}@example.com`,
    });
    return { id: user.id, roles: ["user"] };
  };

  /**
   * Owner's project with a host in it, Reader as a plain Member and
   * Manager on a rank that manages hosts.
   */
  const world = async () => {
    const owner = await person("owner");
    const reader = await person("reader");
    const manager = await person("manager");
    const stranger = await person("stranger");
    const project = await createTestProject(alepha, { createdBy: owner.id });
    const organizationId = await alepha
      .inject(ProjectSecurityService)
      .organizationIdOf(project.id);
    const floor = alepha.store.get(organizationConfigAtom).floor;
    await alepha.inject(RankService).save(
      organizationId,
      {
        key: "host-manager",
        name: "Host manager",
        permissions: [
          ...floor,
          "host:read",
          "host:create",
          "host:update",
          "host:delete",
        ],
      },
      owner,
    );
    await createTestMemberByProjectId(alepha, project.id, reader.id);
    await createTestMemberByProjectId(alepha, project.id, manager.id, {
      rank: "host-manager",
    });
    const host = await createTestHost(
      alepha,
      owner,
      { slug: "ovh-1" },
      { projectId: project.id },
    );
    return {
      owner,
      reader,
      manager,
      stranger,
      project,
      organizationId,
      host,
    };
  };

  it("lets each act through for the permission the table names, and refuses the rest", async ({
    expect,
  }) => {
    const w = await world();
    const params = { hostId: w.host.id };

    // Reads: `host:read`, which a plain Member holds.
    for (const user of [w.owner, w.reader, w.manager]) {
      await expect(
        hostsApi.getHost({ params }, { user }),
      ).resolves.toMatchObject({ id: w.host.id });
      await expect(
        hostsApi.getHostInventory({ params }, { user }),
      ).resolves.toBeDefined();
      await expect(
        hostsApi.getHostStats({ params, query: {} }, { user }),
      ).resolves.toBeDefined();
      await expect(
        commandsApi.listHostCommands({ params, query: {} }, { user }),
      ).resolves.toBeDefined();
      await expect(
        alepha
          .inject(BackupController)
          .listHostEvents({ params, query: {} }, { user }),
      ).resolves.toBeDefined();
    }
    await expect(
      hostsApi.getHost({ params }, { user: w.stranger }),
    ).rejects.toThrow(ForbiddenError);

    // Writes: `host:update`. The refusal names the rank and the permission.
    await expect(
      hostsApi.updateHost(
        { params, body: { label: "Paris" } },
        { user: w.reader },
      ),
    ).rejects.toThrow(/Member.*host:update|host:update/);
    await expect(
      hostsApi.rotateHost({ params }, { user: w.reader }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      hostsApi.createHostEnrolment({ params }, { user: w.reader }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      hostsApi.updateHost(
        { params, body: { label: "Paris" } },
        { user: w.stranger },
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      hostsApi.updateHost(
        { params, body: { label: "Paris" } },
        { user: w.manager },
      ),
    ).resolves.toMatchObject({ label: "Paris" });
    const rotated = await hostsApi.rotateHost({ params }, { user: w.owner });
    expect(rotated.secret).toBeDefined();

    // Delete: `host:delete`.
    await expect(
      hostsApi.checkHostDeletable({ params }, { user: w.reader }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      hostsApi.checkHostDeletable({ params }, { user: w.manager }),
    ).resolves.toEqual({ ok: true });

    // Create: `host:create` in the project.
    await expect(
      lending.createProjectHost(
        { params: { projectId: w.project.id }, body: { slug: "ovh-2" } },
        { user: w.reader },
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      lending.createProjectHost(
        { params: { projectId: w.project.id }, body: { slug: "ovh-2" } },
        { user: w.manager },
      ),
    ).resolves.toMatchObject({ slug: "ovh-2", isHome: true });

    await expect(
      hostsApi.deleteHost({ params }, { user: w.manager }),
    ).resolves.toEqual({ ok: true });
  });

  it("says what each reader may do, server-side", async ({ expect }) => {
    const w = await world();
    const params = { hostId: w.host.id };

    const asReader = await hostsApi.getHost({ params }, { user: w.reader });
    expect(asReader.can).toEqual(["host:read"]);
    expect(asReader.project).toMatchObject({ id: w.project.id });
    const asManager = await hostsApi.getHost({ params }, { user: w.manager });
    expect(asManager.can.sort()).toEqual(
      ["host:create", "host:delete", "host:read", "host:update"].sort(),
    );
    expect(
      (await hostsApi.listMyHosts({}, { user: w.reader })).items.map(
        (item) => item.id,
      ),
    ).toEqual([w.host.id]);
    expect(
      (await hostsApi.listMyHosts({}, { user: w.stranger })).items,
    ).toEqual([]);
  });

  it("keeps a member-created host when that member leaves, managed by the owner", async ({
    expect,
  }) => {
    const w = await world();
    const made = await lending.createProjectHost(
      { params: { projectId: w.project.id }, body: { slug: "built" } },
      { user: w.manager },
    );
    const row = await repos.hosts.getById(made.id);
    // The anchor is the project's owner, the creator is recorded apart.
    expect(row.ownerUserId).toBe(w.owner.id);
    expect(row.createdBy).toBe(w.manager.id);

    await alepha
      .inject(MemberService)
      .remove(w.organizationId, w.manager.id, w.owner);

    await expect(
      hostsApi.getHost({ params: { hostId: made.id } }, { user: w.manager }),
    ).rejects.toThrow(ForbiddenError);
    const rotated = await hostsApi.rotateHost(
      { params: { hostId: made.id } },
      { user: w.owner },
    );
    expect(rotated.secret).toBeDefined();
    expect(await repos.hosts.findById(made.id)).toBeDefined();
  });

  it("lets a borrowing project deploy, and keeps its members off the console", async ({
    expect,
  }) => {
    const w = await world();
    const borrower = await person("borrower");
    // Owner's second project, which the borrower is a plain member of. The
    // owner holds `host:lend` on both sides, so the loan goes through.
    const other = await createTestProject(alepha, { createdBy: w.owner.id });
    await createTestMemberByProjectId(alepha, other.id, borrower.id);
    await lending.attachHost(
      { params: { projectId: other.id }, body: { hostId: w.host.id } },
      { user: w.owner },
    );

    const seen = await lending.listProjectHosts(
      { params: { projectId: other.id } },
      { user: borrower },
    );
    expect(seen.items.map((item) => item.id)).toEqual([w.host.id]);
    expect(seen.items[0]).toMatchObject({ isHome: false, can: [] });
    await expect(
      hostsApi.getHost({ params: { hostId: w.host.id } }, { user: borrower }),
    ).rejects.toThrow(ForbiddenError);
    // The console's URL names the home project: under the borrowing project
    // the slug is not found, even for the owner of both.
    await expect(
      lending.getHomeHost(
        { params: { projectId: other.id, hostSlug: "ovh-1" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("opens the console by its home project and slug, for that project's members only", async ({
    expect,
  }) => {
    const w = await world();
    const params = { projectId: w.project.id, hostSlug: "ovh-1" };

    for (const user of [w.owner, w.reader, w.manager]) {
      await expect(
        lending.getHomeHost({ params }, { user }),
      ).resolves.toMatchObject({ id: w.host.id, slug: "ovh-1" });
    }
    await expect(
      lending.getHomeHost({ params }, { user: w.stranger }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      lending.getHomeHost(
        { params: { ...params, hostSlug: "nope" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("needs host:lend on both sides to lend", async ({ expect }) => {
    const w = await world();
    const borrower = await person("borrower");
    const other = await createTestProject(alepha, { createdBy: borrower.id });

    // The borrower holds `host:lend` in their project, not in the home.
    await expect(
      lending.attachHost(
        { params: { projectId: other.id }, body: { hostId: w.host.id } },
        { user: borrower },
      ),
    ).rejects.toThrow(ForbiddenError);
    // The home's owner is not a member of the borrowing project.
    await expect(
      lending.attachHost(
        { params: { projectId: other.id }, body: { hostId: w.host.id } },
        { user: w.owner },
      ),
    ).rejects.toThrow(ForbiddenError);
    // Somebody holding it on both sides lends.
    await createTestMemberByProjectId(alepha, other.id, w.owner.id, {
      rank: "owner",
    });
    await expect(
      lending.attachHost(
        { params: { projectId: other.id }, body: { hostId: w.host.id } },
        { user: w.owner },
      ),
    ).resolves.toMatchObject({ isHome: false });
  });

  it("refuses to create a host in a project with Apps off, and still lets it be read", async ({
    expect,
  }) => {
    const w = await world();
    await repos.capabilities.deleteMany({
      projectId: { eq: w.project.id },
      key: { eq: "apps" },
    });

    await expect(
      lending.createProjectHost(
        { params: { projectId: w.project.id }, body: { slug: "ovh-9" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(BadRequestError);
    await expect(
      hostsApi.updateHost(
        { params: { hostId: w.host.id }, body: { label: "x" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(BadRequestError);
    // Disabling hides and never refuses a read.
    await expect(
      hostsApi.getHost({ params: { hostId: w.host.id } }, { user: w.owner }),
    ).resolves.toMatchObject({ id: w.host.id });
  });

  it("lists the commands to a reader, and keeps a log tail's result for host:update", async ({
    expect,
  }) => {
    const w = await world();
    const listed = await commandsApi.listHostCommands(
      { params: { hostId: w.host.id }, query: {} },
      { user: w.reader },
    );
    expect(listed.items).toEqual([]);
    const commandId = crypto.randomUUID();

    await expect(
      commandsApi.getHostCommandResult(
        { params: { hostId: w.host.id, commandId } },
        { user: w.reader },
      ),
    ).rejects.toThrow(ForbiddenError);
    // Through the gate: no such command, which is the next refusal.
    await expect(
      commandsApi.getHostCommandResult(
        { params: { hostId: w.host.id, commandId } },
        { user: w.manager },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("tells the people who can fix a host, and a host with no home its anchor", async ({
    expect,
  }) => {
    const w = await world();
    const service = alepha.inject(HostService);
    const row = await repos.hosts.getById(w.host.id);

    expect((await service.recipientsOf(row)).sort()).toEqual(
      [w.owner.id, w.manager.id].sort(),
    );

    const loose = await repos.hosts.create({
      ownerUserId: w.stranger.id,
      createdBy: w.stranger.id,
      type: "bay",
      slug: "loose",
    });
    expect(await service.recipientsOf(loose)).toEqual([w.stranger.id]);

    // The overdue notice: once per host, to each person who can act.
    const dateTime = alepha.inject(DateTimeProvider);
    await repos.hosts.updateById(w.host.id, {
      expiresAt: new Date(dateTime.nowMillis() - 1000).toISOString(),
    });
    const sweep = alepha.inject(HostExpiryJobs);
    expect(await sweep.sweep()).toBe(1);
    expect(await sweep.sweep()).toBe(0);
    const mail = alepha.inject(MemoryEmailProvider);
    const deadline = Date.now() + 5000;
    while (mail.records.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mail.records.map((record) => record.to).sort()).toEqual([
      "manager@example.com",
      "owner@example.com",
    ]);
  });

  it("pins the reads one host action costs", async ({ expect }) => {
    const w = await world();
    const counter = alepha.inject(ReadCounter);
    counter.reset();

    await hostsApi.getHostInventory(
      { params: { hostId: w.host.id } },
      { user: w.reader },
    );

    // The host row once, then its project and the membership, as the gate
    // reads any row that belongs to a project.
    expect(counter.of("hosts")).toBe(1);
    expect(counter.of("organization_members")).toBeLessThanOrEqual(1);
  });
});
