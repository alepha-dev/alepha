import {
  ProjectCapabilityController,
  ProjectDeletionService,
  ProjectMergeService,
  ProjectSecurityService,
} from "@lore/core/api";
import { projectCapabilities, projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { organizationConfigAtom, RankService } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  AdminEstateController,
  EstateController,
  LoreDeployApi,
  ProjectEstateController,
} from "../src/api/index.ts";
import { appInstances, estateProjects, estates } from "../src/schemas/index.ts";
import { createTestEstate } from "../src/testing/estates.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  DeployTestEntities,
} from "../src/testing/index.ts";

class Repositories {
  estates = $repository(estates);
  loans = $repository(estateProjects);
  instances = $repository(appInstances);
  projects = $repository(projects);
  capabilities = $repository(projectCapabilities);
}

const admin: UserAccountToken = {
  id: "00000000-0000-4000-8000-0000000000ad",
  roles: ["admin"],
};

/**
 * An estate changes home (#Q3280, epic #E126): moved by its managers,
 * assigned by the admin when it has none, carried by a project merge, and
 * never left behind by a project that is deleted or loses Apps.
 */
describe("an estate's home project changes", () => {
  let alepha: Alepha;
  let entities: DeployTestEntities;
  let repos: Repositories;
  let estatesApi: EstateController;
  let lending: ProjectEstateController;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        DATABASE_URL: ":memory:",
        APP_SECRET: "estate-move-spec-secret",
      },
    });
    alepha
      .with(AlephaOrm)
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaEmail)
      .with(AlephaApiUsers)
      .with(LoreDeployApi);
    entities = alepha.inject(DeployTestEntities);
    repos = alepha.inject(Repositories);
    await alepha.start();
    estatesApi = alepha.inject(EstateController);
    lending = alepha.inject(ProjectEstateController);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const person = async (name: string): Promise<UserAccountToken> => {
    const user = await entities.users.create({ username: name });
    return { id: user.id, roles: ["user"] };
  };

  const appsOff = (projectId: number) =>
    repos.capabilities.deleteMany({
      projectId: { eq: projectId },
      key: { eq: "apps" },
    });

  describe("moving", () => {
    it("needs estate:delete in the home and estate:create in a target with Apps on", async ({
      expect,
    }) => {
      const owner = await person("owner");
      const reader = await person("reader");
      const stranger = await person("stranger");
      const home = await createTestProject(alepha, { createdBy: owner.id });
      const target = await createTestProject(alepha, { createdBy: owner.id });
      const foreign = await createTestProject(alepha, {
        createdBy: stranger.id,
      });
      await createTestMemberByProjectId(alepha, home.id, reader.id);
      await createTestMemberByProjectId(alepha, target.id, reader.id);
      const estate = await createTestEstate(
        alepha,
        owner,
        { slug: "ovh-1" },
        { projectId: home.id },
      );
      const params = { estateId: estate.id };

      // A plain member holds neither half.
      await expect(
        estatesApi.moveEstate(
          { params, body: { projectId: target.id } },
          { user: reader },
        ),
      ).rejects.toThrow(ForbiddenError);
      // The owner of the home is not a member of a stranger's project.
      await expect(
        estatesApi.moveEstate(
          { params, body: { projectId: foreign.id } },
          { user: owner },
        ),
      ).rejects.toThrow(ForbiddenError);
      // Into the project it is already in.
      await expect(
        estatesApi.moveEstate(
          { params, body: { projectId: home.id } },
          { user: owner },
        ),
      ).rejects.toThrow(BadRequestError);
      // A target with Apps off could manage it through no page.
      await appsOff(target.id);
      await expect(
        estatesApi.moveEstate(
          { params, body: { projectId: target.id } },
          { user: owner },
        ),
      ).rejects.toThrow(/Apps/);
      expect((await repos.estates.getById(estate.id)).projectId).toBe(home.id);
    });

    it("refuses a slug the target holds, and never rewrites one", async ({
      expect,
    }) => {
      const owner = await person("owner");
      const home = await createTestProject(alepha, { createdBy: owner.id });
      const target = await createTestProject(alepha, { createdBy: owner.id });
      const estate = await createTestEstate(
        alepha,
        owner,
        { slug: "ovh-1" },
        { projectId: home.id },
      );
      await createTestEstate(
        alepha,
        owner,
        { slug: "ovh-1" },
        { projectId: target.id },
      );

      await expect(
        estatesApi.moveEstate(
          { params: { estateId: estate.id }, body: { projectId: target.id } },
          { user: owner },
        ),
      ).rejects.toThrow(ConflictError);
      const row = await repos.estates.getById(estate.id);
      expect(row.slug).toBe("ovh-1");
      expect(row.projectId).toBe(home.id);
    });

    it("keeps the loans, the secret and the copies, and moves the anchor with the home", async ({
      expect,
    }) => {
      const owner = await person("owner");
      const other = await person("other");
      const borrowerOwner = await person("borrower");
      const home = await createTestProject(alepha, { createdBy: owner.id });
      // The target belongs to somebody else, who lets the owner create there.
      const target = await createTestProject(alepha, { createdBy: other.id });
      const organizationId = await alepha
        .inject(ProjectSecurityService)
        .organizationIdOf(target.id);
      await alepha.inject(RankService).save(
        organizationId,
        {
          key: "builder",
          name: "Builder",
          permissions: [
            ...alepha.store.get(organizationConfigAtom).floor,
            "estate:read",
            "estate:create",
          ],
        },
        other,
      );
      await createTestMemberByProjectId(alepha, target.id, owner.id, {
        rank: "builder",
      });
      const borrower = await createTestProject(alepha, {
        createdBy: borrowerOwner.id,
      });
      const estate = await createTestEstate(
        alepha,
        owner,
        { slug: "ovh-1" },
        { projectId: home.id },
      );
      await repos.loans.create({ estateId: estate.id, projectId: borrower.id });
      const copy = await repos.instances.create({
        projectId: borrower.id,
        app: "api",
        env: "production",
        estateId: estate.id,
      });
      const before = await repos.estates.getById(estate.id);

      const result = await estatesApi.moveEstate(
        { params: { estateId: estate.id }, body: { projectId: target.id } },
        { user: owner },
      );

      expect(result.estate.project?.id).toBe(target.id);
      expect(result.loans.map((loan) => loan.id)).toEqual([
        home.id,
        borrower.id,
      ]);
      const after = await repos.estates.getById(estate.id);
      expect(after.projectId).toBe(target.id);
      // The anchor follows the home, in the same statement.
      expect(after.ownerUserId).toBe(other.id);
      expect(after.slug).toBe(before.slug);
      expect(after.secretHash).toBe(before.secretHash);
      expect(after.createdBy).toBe(owner.id);
      // The borrower still deploys there: its loan and its copy are intact.
      const lent = await lending.listProjectEstates(
        { params: { projectId: borrower.id } },
        { user: borrowerOwner },
      );
      expect(lent.items.map((item) => item.id)).toEqual([estate.id]);
      expect((await repos.instances.getById(copy.id)).estateId).toBe(estate.id);
      // The new home's owner, who created nothing, opens it.
      await expect(
        estatesApi.getEstate(
          { params: { estateId: estate.id } },
          { user: other },
        ),
      ).resolves.toMatchObject({ id: estate.id });
    });
  });

  describe("the admin's assign", () => {
    it("homes an estate the migration left with none, its loan kept, its anchor the new owner", async ({
      expect,
    }) => {
      // What the migration leaves: a member who owns no project lent their
      // estate to somebody else's project, which deploys a copy onto it.
      const dan = await person("dan");
      const borrowerOwner = await person("borrower");
      const borrower = await createTestProject(alepha, {
        createdBy: borrowerOwner.id,
      });
      const estate = await repos.estates.create({
        ownerUserId: dan.id,
        createdBy: dan.id,
        type: "bay",
        slug: "loose",
        secretHash: "hash-loose",
      });
      await repos.loans.create({ estateId: estate.id, projectId: borrower.id });
      const copy = await repos.instances.create({
        projectId: borrower.id,
        app: "api",
        env: "production",
        estateId: estate.id,
      });

      for (const user of [dan, borrowerOwner]) {
        await expect(
          estatesApi.getEstate({ params: { estateId: estate.id } }, { user }),
        ).rejects.toThrow(ForbiddenError);
      }
      expect((await repos.instances.getById(copy.id)).estateId).toBe(estate.id);

      const assigned = await alepha
        .inject(AdminEstateController)
        .assignEstate(
          { params: { id: estate.id }, body: { projectId: borrower.id } },
          { user: admin },
        );
      expect(assigned.project.id).toBe(borrower.id);
      expect(assigned.loans.map((loan) => loan.id)).toEqual([borrower.id]);
      // No credential crosses, the admin included.
      expect(JSON.stringify(assigned)).not.toContain("hash-loose");

      const row = await repos.estates.getById(estate.id);
      expect(row.projectId).toBe(borrower.id);
      expect(row.ownerUserId).toBe(borrowerOwner.id);
      const managed = await estatesApi.rotateEstate(
        { params: { estateId: estate.id } },
        { user: borrowerOwner },
      );
      expect(managed.secret).toBeDefined();
      expect(await repos.loans.count({ estateId: { eq: estate.id } })).toBe(1);

      // Its creator leaving no longer takes it.
      await alepha.inject(UserService).deleteUser(dan.id);
      expect(await repos.estates.findById(estate.id)).toBeDefined();
      expect((await repos.instances.getById(copy.id)).estateId).toBe(estate.id);
    });

    it("refuses a target with Apps off, and needs admin:estate:update", async ({
      expect,
    }) => {
      const dan = await person("dan");
      const owner = await person("owner");
      const project = await createTestProject(alepha, { createdBy: owner.id });
      const estate = await repos.estates.create({
        ownerUserId: dan.id,
        type: "bay",
        slug: "loose",
      });
      const assign = alepha.inject(AdminEstateController).assignEstate;

      await expect(
        assign(
          { params: { id: estate.id }, body: { projectId: project.id } },
          { user: owner },
        ),
      ).rejects.toThrow(ForbiddenError);
      await appsOff(project.id);
      await expect(
        assign(
          { params: { id: estate.id }, body: { projectId: project.id } },
          { user: admin },
        ),
      ).rejects.toThrow(/Apps/);
    });
  });

  describe("a project that is the home of an estate", () => {
    it("is not deleted, keeps its slug, and names the estate", async ({
      expect,
    }) => {
      const owner = await person("owner");
      const home = await createTestProject(alepha, { createdBy: owner.id });
      await createTestEstate(
        alepha,
        owner,
        { slug: "ovh-1" },
        { projectId: home.id },
      );
      const deletion = alepha.inject(ProjectDeletionService);

      await expect(deletion.deleteProject(home.id)).rejects.toThrow(/ovh-1/);
      const still = await repos.projects.getById(home.id);
      expect(still.slug).toBe(home.slug);
      expect(still.deletedAt).toBeUndefined();
      // The admin's force delete goes through the same guard.
      await expect(
        deletion.deleteProject(home.id, { force: true }),
      ).rejects.toThrow(ConflictError);
    });

    it("does not lose Apps", async ({ expect }) => {
      const owner = await person("owner");
      const home = await createTestProject(alepha, { createdBy: owner.id });
      await createTestEstate(
        alepha,
        owner,
        { slug: "ovh-1" },
        { projectId: home.id },
      );

      await expect(
        alepha.inject(ProjectCapabilityController).setCapability(
          {
            params: { projectId: home.id, key: "apps" },
            body: { enabled: false },
          },
          { user: owner },
        ),
      ).rejects.toThrow(/ovh-1/);
      expect(
        await repos.capabilities.count({
          projectId: { eq: home.id },
          key: { eq: "apps" },
        }),
      ).toBe(1);
    });

    it("deletes once the estate moved away", async ({ expect }) => {
      const owner = await person("owner");
      const home = await createTestProject(alepha, { createdBy: owner.id });
      const target = await createTestProject(alepha, { createdBy: owner.id });
      const estate = await createTestEstate(
        alepha,
        owner,
        { slug: "ovh-1" },
        { projectId: home.id },
      );
      await estatesApi.moveEstate(
        { params: { estateId: estate.id }, body: { projectId: target.id } },
        { user: owner },
      );

      await alepha.inject(ProjectDeletionService).deleteProject(home.id);
      expect(await repos.projects.findById(home.id)).toBeUndefined();
      expect((await repos.estates.getById(estate.id)).projectId).toBe(
        target.id,
      );
    });
  });

  describe("a project merge", () => {
    it("moves the source's estates and their anchor to the target", async ({
      expect,
    }) => {
      const ann = await person("ann");
      const bob = await person("bob");
      const source = await createTestProject(alepha, { createdBy: ann.id });
      const target = await createTestProject(alepha, { createdBy: bob.id });
      const estate = await createTestEstate(
        alepha,
        ann,
        { slug: "ovh-1" },
        { projectId: source.id },
      );

      await alepha.inject(ProjectMergeService).merge(source.id, target.id);

      const row = await repos.estates.getById(estate.id);
      expect(row.projectId).toBe(target.id);
      expect(row.ownerUserId).toBe(bob.id);
    });

    it("refuses before any write on a slug collision or a target with Apps off", async ({
      expect,
    }) => {
      const ann = await person("ann");
      const bob = await person("bob");
      const source = await createTestProject(alepha, { createdBy: ann.id });
      const target = await createTestProject(alepha, { createdBy: bob.id });
      const estate = await createTestEstate(
        alepha,
        ann,
        { slug: "ovh-1" },
        { projectId: source.id },
      );
      await createTestEstate(
        alepha,
        bob,
        { slug: "ovh-1" },
        { projectId: target.id },
      );
      const merge = alepha.inject(ProjectMergeService);

      await expect(merge.merge(source.id, target.id)).rejects.toThrow(
        /estate "ovh-1"/,
      );
      await repos.estates.deleteMany({ projectId: { eq: target.id } });
      await appsOff(target.id);
      await expect(merge.merge(source.id, target.id)).rejects.toThrow(
        /Apps is off/,
      );
      const row = await repos.estates.getById(estate.id);
      expect(row.projectId).toBe(source.id);
      expect(row.ownerUserId).toBe(ann.id);
    });
  });
});
