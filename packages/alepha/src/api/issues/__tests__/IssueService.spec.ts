import { Alepha } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { BadRequestError } from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaApiIssues } from "../index.ts";
import { issueConfigAtom } from "../schemas/issueConfigAtom.ts";
import { IssueService } from "../services/IssueService.ts";

class TestRepositories {
  users = $repository(users);
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaApiIssues);
  alepha.with(TestRepositories);

  const service = alepha.inject(IssueService);
  const repos = alepha.inject(TestRepositories);

  await alepha.start();

  const user = await repos.users.create({
    email: "test@example.com",
    roles: [],
  });

  const admin = await repos.users.create({
    email: "admin@example.com",
    roles: ["admin"],
  });

  return { alepha, service, repos, user, admin };
};

describe("IssueService", () => {
  describe("create", () => {
    it("should create an issue with defaults", async () => {
      const { service, user } = await setup();

      const issue = await service.create(
        { title: "Something is broken" },
        { id: user.id },
      );

      expect(issue.title).toBe("Something is broken");
      expect(issue.type).toBe("bug");
      expect(issue.priority).toBe("medium");
      expect(issue.status).toBe("open");
      expect(issue.createdBy).toBe(user.id);
    });

    it("should create an issue with all fields", async () => {
      const { service, user } = await setup();

      const issue = await service.create(
        {
          title: "Add dark mode",
          type: "feature",
          priority: "high",
          description: "We need dark mode support",
          pageUrl: "https://example.com/settings",
        },
        { id: user.id },
      );

      expect(issue.type).toBe("feature");
      expect(issue.priority).toBe("high");
      expect(issue.description).toBe("We need dark mode support");
      expect(issue.pageUrl).toBe("https://example.com/settings");
    });

    it("should reject when max open issues reached", async () => {
      const { alepha, service, user } = await setup();

      alepha.store.set(issueConfigAtom, {
        enabled: true,
        maxOpenPerUser: 1,
      });

      await service.create({ title: "First" }, { id: user.id });

      await expect(
        service.create({ title: "Second" }, { id: user.id }),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should reject when issues are disabled", async () => {
      const { alepha, service, user } = await setup();

      alepha.store.set(issueConfigAtom, {
        enabled: false,
        maxOpenPerUser: 50,
      });

      await expect(
        service.create({ title: "Test" }, { id: user.id }),
      ).rejects.toThrowError(BadRequestError);
    });
  });

  describe("assign", () => {
    it("should assign an open issue", async () => {
      const { service, user, admin } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });

      const assigned = await service.assign(issue.id, admin.id);

      expect(assigned.status).toBe("assigned");
      expect(assigned.assigneeId).toBe(admin.id);
      expect(assigned.assignedAt).toBeDefined();
    });

    it("should reject assigning a non-open issue", async () => {
      const { service, user, admin } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });
      await service.assign(issue.id, admin.id);

      await expect(service.assign(issue.id, admin.id)).rejects.toThrowError(
        BadRequestError,
      );
    });
  });

  describe("complete", () => {
    it("should complete an assigned issue", async () => {
      const { service, user, admin } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });
      await service.assign(issue.id, admin.id);

      const completed = await service.complete(issue.id, "Fixed the bug");

      expect(completed.status).toBe("completed");
      expect(completed.resolution).toBe("Fixed the bug");
      expect(completed.completedAt).toBeDefined();
    });

    it("should reject completing a non-assigned issue", async () => {
      const { service, user } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });

      await expect(service.complete(issue.id, "Fixed")).rejects.toThrowError(
        BadRequestError,
      );
    });
  });

  describe("reopen", () => {
    it("should reopen a completed issue", async () => {
      const { service, user, admin } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });
      await service.assign(issue.id, admin.id);
      await service.complete(issue.id, "Fixed");

      const reopened = await service.reopen(issue.id, "Not actually fixed");

      expect(reopened.status).toBe("open");
      expect(reopened.reopenReason).toBe("Not actually fixed");
    });

    it("should reject reopening a non-completed issue", async () => {
      const { service, user } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });

      await expect(service.reopen(issue.id, "Reason")).rejects.toThrowError(
        BadRequestError,
      );
    });
  });

  describe("archive", () => {
    it("should archive a completed issue", async () => {
      const { service, user, admin } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });
      await service.assign(issue.id, admin.id);
      await service.complete(issue.id, "Fixed");

      const archived = await service.archive(issue.id);

      expect(archived.status).toBe("archived");
      expect(archived.archivedAt).toBeDefined();
    });

    it("should reject archiving a non-completed issue", async () => {
      const { service, user } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });

      await expect(service.archive(issue.id)).rejects.toThrowError(
        BadRequestError,
      );
    });
  });

  describe("find", () => {
    it("should paginate issues", async () => {
      const { service, user } = await setup();
      await service.create({ title: "Bug 1" }, { id: user.id });
      await service.create({ title: "Bug 2" }, { id: user.id });

      const page = await service.find({ size: 10 });

      expect(page.content.length).toBeGreaterThanOrEqual(2);
      expect(page.page.totalElements).toBeGreaterThanOrEqual(2);
    });

    it("should filter by status", async () => {
      const { service, user, admin } = await setup();
      await service.create({ title: "Open bug" }, { id: user.id });
      const bug2 = await service.create(
        { title: "Assigned bug" },
        { id: user.id },
      );
      await service.assign(bug2.id, admin.id);

      const openOnly = await service.find({ status: "open" });

      for (const issue of openOnly.content) {
        expect(issue.status).toBe("open");
      }
    });

    it("should search by title", async () => {
      const { service, user } = await setup();
      await service.create({ title: "Login page broken" }, { id: user.id });
      await service.create({ title: "Dark mode request" }, { id: user.id });

      const result = await service.find({ search: "Login" });

      expect(result.content.some((i) => i.title === "Login page broken")).toBe(
        true,
      );
    });
  });

  describe("findMine", () => {
    it("should return only the user's issues", async () => {
      const { service, user, admin } = await setup();
      await service.create({ title: "User bug" }, { id: user.id });
      await service.create({ title: "Admin bug" }, { id: admin.id });

      const mine = await service.findMine(user.id);

      for (const issue of mine.content) {
        expect(issue.createdBy).toBe(user.id);
      }
    });
  });

  describe("deleteIssue", () => {
    it("should delete an issue", async () => {
      const { service, user } = await setup();
      const issue = await service.create({ title: "Bug" }, { id: user.id });

      await service.deleteIssue(issue.id);

      await expect(service.getById(issue.id)).rejects.toThrow();
    });
  });
});
