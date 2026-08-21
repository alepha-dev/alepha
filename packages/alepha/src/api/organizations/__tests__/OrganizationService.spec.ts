import { Alepha } from "alepha";
import { currentUserAtom } from "alepha/security";
import { describe, it } from "vitest";

import { AlephaApiOrganizations, OrganizationService } from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:", LOG_LEVEL: "error" },
  });

  alepha.with(AlephaApiOrganizations);

  await alepha.start();

  const service = alepha.inject(OrganizationService);

  return { alepha, service };
};

describe("alepha/api/organizations - OrganizationService", () => {
  describe("create", () => {
    it("should create an organization", async ({ expect }) => {
      const { service } = await setup();

      const org = await service.create({
        name: "Acme Corp",
        slug: "acme-corp",
      });

      expect(org.id).toBeDefined();
      expect(org.name).toBe("Acme Corp");
      expect(org.slug).toBe("acme-corp");
      expect(org.enabled).toBe(true);
      expect(org.createdAt).toBeDefined();
    });

    it("should create a disabled organization", async ({ expect }) => {
      const { service } = await setup();

      const org = await service.create({
        name: "Disabled Org",
        slug: "disabled-org",
        enabled: false,
      });

      expect(org.enabled).toBe(false);
    });
  });

  describe("getById", () => {
    it("should retrieve an organization by ID", async ({ expect }) => {
      const { service } = await setup();

      const created = await service.create({
        name: "Test Org",
        slug: "test-org",
      });

      const retrieved = await service.getById(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe("Test Org");
    });
  });

  describe("getBySlug", () => {
    it("should retrieve an organization by slug", async ({ expect }) => {
      const { service } = await setup();

      await service.create({ name: "Slug Org", slug: "my-slug" });

      const retrieved = await service.getBySlug("my-slug");

      expect(retrieved.name).toBe("Slug Org");
      expect(retrieved.slug).toBe("my-slug");
    });
  });

  describe("update", () => {
    it("should update an organization", async ({ expect }) => {
      const { service } = await setup();

      const org = await service.create({
        name: "Old Name",
        slug: "old-slug",
      });

      const updated = await service.update(org.id, { name: "New Name" });

      expect(updated.name).toBe("New Name");
      expect(updated.slug).toBe("old-slug");
    });

    it("should disable an organization", async ({ expect }) => {
      const { service } = await setup();

      const org = await service.create({
        name: "Active Org",
        slug: "active-org",
      });

      const updated = await service.update(org.id, { enabled: false });

      expect(updated.enabled).toBe(false);
    });
  });

  describe("delete", () => {
    it("should delete an organization", async ({ expect }) => {
      const { service } = await setup();

      const org = await service.create({
        name: "To Delete",
        slug: "to-delete",
      });

      await service.delete(org.id);

      const result = await service.find();
      expect(result.content.find((o) => o.id === org.id)).toBeUndefined();
    });
  });

  describe("find", () => {
    it("should find organizations with pagination", async ({ expect }) => {
      const { service } = await setup();

      await service.create({ name: "Org A", slug: "org-a" });
      await service.create({ name: "Org B", slug: "org-b" });
      await service.create({ name: "Org C", slug: "org-c" });

      const result = await service.find({ size: 2 });

      expect(result.content).toHaveLength(2);
      expect(result.page.totalElements).toBe(3);
    });

    it("should filter by name", async ({ expect }) => {
      const { service } = await setup();

      await service.create({ name: "Alpha Corp", slug: "alpha" });
      await service.create({ name: "Beta Inc", slug: "beta" });

      const result = await service.find({ name: "Alpha" });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe("Alpha Corp");
    });

    it("should filter by enabled status", async ({ expect }) => {
      const { service } = await setup();

      await service.create({ name: "Active", slug: "active" });
      await service.create({
        name: "Inactive",
        slug: "inactive",
        enabled: false,
      });

      const result = await service.find({ enabled: true });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe("Active");
    });

    it("should sort by createdAt descending by default", async ({ expect }) => {
      const { service } = await setup();

      await service.create({ name: "First", slug: "first" });
      await new Promise((r) => setTimeout(r, 10));
      await service.create({ name: "Second", slug: "second" });

      const result = await service.find();

      expect(result.content[0].name).toBe("Second");
      expect(result.content[1].name).toBe("First");
    });
  });

  describe("organization scoping on users", () => {
    it("god user (no org) sees all organizations", async ({ expect }) => {
      const { alepha, service } = await setup();

      await service.create({ name: "Org A", slug: "org-a" });
      await service.create({ name: "Org B", slug: "org-b" });

      alepha.store.set(currentUserAtom, { id: "god-user" });

      const result = await service.find();
      expect(result.content).toHaveLength(2);
    });
  });
});
