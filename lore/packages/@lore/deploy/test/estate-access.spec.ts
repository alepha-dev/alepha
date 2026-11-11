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
  EstateCommandController,
  EstateController,
  EstateExpiryJobs,
  EstateService,
  LoreDeployApi,
  ProjectEstateController,
} from "../src/api/index.ts";
import { estates } from "../src/schemas/index.ts";
import { createTestEstate } from "../src/testing/estates.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  DeployTestEntities,
} from "../src/testing/index.ts";

class Repositories {
  estates = $repository(estates);
  capabilities = $repository(projectCapabilities);
}

/**
 * Estate access is the home project's rank (#Q3279, epic #E126): every act
 * on `/estates/:estateId` goes through `$ownsProject` on the estate row, so
 * the people who can act on an estate are the members of its project whose
 * rank allows it, and nobody else.
 *
 * The cast, in one project owned by Owner: Reader (a plain Member, which
 * holds `estate:read` and nothing more), Manager (a rank with
 * `estate:create`, `estate:update` and `estate:delete`), and Stranger, in no
 * project of Owner's.
 */
describe("estate access by the home project's rank", () => {
  let alepha: Alepha;
  let entities: DeployTestEntities;
  let repos: Repositories;
  let estatesApi: EstateController;
  let commandsApi: EstateCommandController;
  let lending: ProjectEstateController;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        DATABASE_URL: ":memory:",
        APP_SECRET: "estate-access-spec-secret",
      },
    });
    alepha
      .with(AlephaOrm)
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaEmail)
      .with(AlephaApiUsers)
      .with(LoreDeployApi)
      .with(ReadCounter);
    entities = alepha.inject(DeployTestEntities);
    repos = alepha.inject(Repositories);
    await alepha.start();
    estatesApi = alepha.inject(EstateController);
    commandsApi = alepha.inject(EstateCommandController);
    lending = alepha.inject(ProjectEstateController);
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
   * Owner's project with an estate in it, Reader as a plain Member and
   * Manager on a rank that manages estates.
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
        key: "estate-manager",
        name: "Estate manager",
        permissions: [
          ...floor,
          "estate:read",
          "estate:create",
          "estate:update",
          "estate:delete",
        ],
      },
      owner,
    );
    await createTestMemberByProjectId(alepha, project.id, reader.id);
    await createTestMemberByProjectId(alepha, project.id, manager.id, {
      rank: "estate-manager",
    });
    const estate = await createTestEstate(
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
      estate,
    };
  };

  it("lets each act through for the permission the table names, and refuses the rest", async ({
    expect,
  }) => {
    const w = await world();
    const params = { estateId: w.estate.id };

    // Reads: `estate:read`, which a plain Member holds.
    for (const user of [w.owner, w.reader, w.manager]) {
      await expect(
        estatesApi.getEstate({ params }, { user }),
      ).resolves.toMatchObject({ id: w.estate.id });
      await expect(
        estatesApi.getEstateInventory({ params }, { user }),
      ).resolves.toBeDefined();
      await expect(
        estatesApi.getEstateStats({ params, query: {} }, { user }),
      ).resolves.toBeDefined();
      await expect(
        commandsApi.listEstateCommands({ params, query: {} }, { user }),
      ).resolves.toBeDefined();
      await expect(
        alepha
          .inject(BackupController)
          .listEstateEvents({ params, query: {} }, { user }),
      ).resolves.toBeDefined();
    }
    await expect(
      estatesApi.getEstate({ params }, { user: w.stranger }),
    ).rejects.toThrow(ForbiddenError);

    // Writes: `estate:update`. The refusal names the rank and the permission.
    await expect(
      estatesApi.updateEstate(
        { params, body: { label: "Paris" } },
        { user: w.reader },
      ),
    ).rejects.toThrow(/Member.*estate:update|estate:update/);
    await expect(
      estatesApi.rotateEstate({ params }, { user: w.reader }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      estatesApi.createEstateEnrolment({ params }, { user: w.reader }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      estatesApi.updateEstate(
        { params, body: { label: "Paris" } },
        { user: w.stranger },
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      estatesApi.updateEstate(
        { params, body: { label: "Paris" } },
        { user: w.manager },
      ),
    ).resolves.toMatchObject({ label: "Paris" });
    const rotated = await estatesApi.rotateEstate(
      { params },
      { user: w.owner },
    );
    expect(rotated.secret).toBeDefined();

    // Delete: `estate:delete`.
    await expect(
      estatesApi.checkEstateDeletable({ params }, { user: w.reader }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      estatesApi.checkEstateDeletable({ params }, { user: w.manager }),
    ).resolves.toEqual({ ok: true });

    // Create: `estate:create` in the project.
    await expect(
      lending.createProjectEstate(
        { params: { projectId: w.project.id }, body: { slug: "ovh-2" } },
        { user: w.reader },
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      lending.createProjectEstate(
        { params: { projectId: w.project.id }, body: { slug: "ovh-2" } },
        { user: w.manager },
      ),
    ).resolves.toMatchObject({ slug: "ovh-2", isHome: true });

    await expect(
      estatesApi.deleteEstate({ params }, { user: w.manager }),
    ).resolves.toEqual({ ok: true });
  });

  it("says what each reader may do, server-side", async ({ expect }) => {
    const w = await world();
    const params = { estateId: w.estate.id };

    const asReader = await estatesApi.getEstate({ params }, { user: w.reader });
    expect(asReader.can).toEqual(["estate:read"]);
    expect(asReader.project).toMatchObject({ id: w.project.id });
    const asManager = await estatesApi.getEstate(
      { params },
      { user: w.manager },
    );
    expect(asManager.can.sort()).toEqual(
      ["estate:create", "estate:delete", "estate:read", "estate:update"].sort(),
    );
    expect(
      (await estatesApi.listMyEstates({}, { user: w.reader })).items.map(
        (item) => item.id,
      ),
    ).toEqual([w.estate.id]);
    expect(
      (await estatesApi.listMyEstates({}, { user: w.stranger })).items,
    ).toEqual([]);
  });

  it("keeps a member-created estate when that member leaves, managed by the owner", async ({
    expect,
  }) => {
    const w = await world();
    const made = await lending.createProjectEstate(
      { params: { projectId: w.project.id }, body: { slug: "built" } },
      { user: w.manager },
    );
    const row = await repos.estates.getById(made.id);
    // The anchor is the project's owner, the creator is recorded apart.
    expect(row.ownerUserId).toBe(w.owner.id);
    expect(row.createdBy).toBe(w.manager.id);

    await alepha
      .inject(MemberService)
      .remove(w.organizationId, w.manager.id, w.owner);

    await expect(
      estatesApi.getEstate(
        { params: { estateId: made.id } },
        { user: w.manager },
      ),
    ).rejects.toThrow(ForbiddenError);
    const rotated = await estatesApi.rotateEstate(
      { params: { estateId: made.id } },
      { user: w.owner },
    );
    expect(rotated.secret).toBeDefined();
    expect(await repos.estates.findById(made.id)).toBeDefined();
  });

  it("lets a borrowing project deploy, and keeps its members off the console", async ({
    expect,
  }) => {
    const w = await world();
    const borrower = await person("borrower");
    // Owner's second project, which the borrower is a plain member of. The
    // owner holds `estate:lend` on both sides, so the loan goes through.
    const other = await createTestProject(alepha, { createdBy: w.owner.id });
    await createTestMemberByProjectId(alepha, other.id, borrower.id);
    await lending.attachEstate(
      { params: { projectId: other.id }, body: { estateId: w.estate.id } },
      { user: w.owner },
    );

    const seen = await lending.listProjectEstates(
      { params: { projectId: other.id } },
      { user: borrower },
    );
    expect(seen.items.map((item) => item.id)).toEqual([w.estate.id]);
    expect(seen.items[0]).toMatchObject({ isHome: false, can: [] });
    await expect(
      estatesApi.getEstate(
        { params: { estateId: w.estate.id } },
        { user: borrower },
      ),
    ).rejects.toThrow(ForbiddenError);
    // The console's URL names the home project: under the borrowing project
    // the slug is not found, even for the owner of both.
    await expect(
      lending.getHomeEstate(
        { params: { projectId: other.id, estateSlug: "ovh-1" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("opens the console by its home project and slug, for that project's members only", async ({
    expect,
  }) => {
    const w = await world();
    const params = { projectId: w.project.id, estateSlug: "ovh-1" };

    for (const user of [w.owner, w.reader, w.manager]) {
      await expect(
        lending.getHomeEstate({ params }, { user }),
      ).resolves.toMatchObject({ id: w.estate.id, slug: "ovh-1" });
    }
    await expect(
      lending.getHomeEstate({ params }, { user: w.stranger }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      lending.getHomeEstate(
        { params: { ...params, estateSlug: "nope" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("needs estate:lend on both sides to lend", async ({ expect }) => {
    const w = await world();
    const borrower = await person("borrower");
    const other = await createTestProject(alepha, { createdBy: borrower.id });

    // The borrower holds `estate:lend` in their project, not in the home.
    await expect(
      lending.attachEstate(
        { params: { projectId: other.id }, body: { estateId: w.estate.id } },
        { user: borrower },
      ),
    ).rejects.toThrow(ForbiddenError);
    // The home's owner is not a member of the borrowing project.
    await expect(
      lending.attachEstate(
        { params: { projectId: other.id }, body: { estateId: w.estate.id } },
        { user: w.owner },
      ),
    ).rejects.toThrow(ForbiddenError);
    // Somebody holding it on both sides lends.
    await createTestMemberByProjectId(alepha, other.id, w.owner.id, {
      rank: "owner",
    });
    await expect(
      lending.attachEstate(
        { params: { projectId: other.id }, body: { estateId: w.estate.id } },
        { user: w.owner },
      ),
    ).resolves.toMatchObject({ isHome: false });
  });

  it("refuses to create an estate in a project with Apps off, and still lets it be read", async ({
    expect,
  }) => {
    const w = await world();
    await repos.capabilities.deleteMany({
      projectId: { eq: w.project.id },
      key: { eq: "apps" },
    });

    await expect(
      lending.createProjectEstate(
        { params: { projectId: w.project.id }, body: { slug: "ovh-9" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(BadRequestError);
    await expect(
      estatesApi.updateEstate(
        { params: { estateId: w.estate.id }, body: { label: "x" } },
        { user: w.owner },
      ),
    ).rejects.toThrow(BadRequestError);
    // Disabling hides and never refuses a read.
    await expect(
      estatesApi.getEstate(
        { params: { estateId: w.estate.id } },
        { user: w.owner },
      ),
    ).resolves.toMatchObject({ id: w.estate.id });
  });

  it("lists the commands to a reader, and keeps a log tail's result for estate:update", async ({
    expect,
  }) => {
    const w = await world();
    const listed = await commandsApi.listEstateCommands(
      { params: { estateId: w.estate.id }, query: {} },
      { user: w.reader },
    );
    expect(listed.items).toEqual([]);
    const commandId = crypto.randomUUID();

    await expect(
      commandsApi.getEstateCommandResult(
        { params: { estateId: w.estate.id, commandId } },
        { user: w.reader },
      ),
    ).rejects.toThrow(ForbiddenError);
    // Through the gate: no such command, which is the next refusal.
    await expect(
      commandsApi.getEstateCommandResult(
        { params: { estateId: w.estate.id, commandId } },
        { user: w.manager },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("tells the people who can fix an estate, and an estate with no home its anchor", async ({
    expect,
  }) => {
    const w = await world();
    const service = alepha.inject(EstateService);
    const row = await repos.estates.getById(w.estate.id);

    expect((await service.recipientsOf(row)).sort()).toEqual(
      [w.owner.id, w.manager.id].sort(),
    );

    const loose = await repos.estates.create({
      ownerUserId: w.stranger.id,
      createdBy: w.stranger.id,
      type: "bay",
      slug: "loose",
    });
    expect(await service.recipientsOf(loose)).toEqual([w.stranger.id]);

    // The overdue notice: once per estate, to each person who can act.
    const dateTime = alepha.inject(DateTimeProvider);
    await repos.estates.updateById(w.estate.id, {
      expiresAt: new Date(dateTime.nowMillis() - 1000).toISOString(),
    });
    const sweep = alepha.inject(EstateExpiryJobs);
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

  it("pins the reads one estate action costs", async ({ expect }) => {
    const w = await world();
    const counter = alepha.inject(ReadCounter);
    counter.reset();

    await estatesApi.getEstateInventory(
      { params: { estateId: w.estate.id } },
      { user: w.reader },
    );

    // The estate row once, then its project and the membership, as the gate
    // reads any row that belongs to a project.
    expect(counter.of("estates")).toBe(1);
    expect(counter.of("organization_members")).toBeLessThanOrEqual(1);
  });
});
