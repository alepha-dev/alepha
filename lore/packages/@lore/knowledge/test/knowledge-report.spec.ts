import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreKnowledgeApi } from "../src/api/index.ts";
import { ProjectKnowledgeReportService } from "../src/api/services/ProjectKnowledgeReportService.ts";
import {
  createTestFolio,
  createTestProject,
  KnowledgeTestEntities,
} from "../src/testing/index.ts";

/**
 * The Knowledge tab's report (#Q3007).
 */
describe("ProjectKnowledgeReportService", () => {
  const day = 86_400_000;
  let alepha: Alepha;
  let repos: KnowledgeTestEntities;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreKnowledgeApi);
    repos = alepha.inject(KnowledgeTestEntities);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const service = () => alepha.inject(ProjectKnowledgeReportService);

  it("puts a stale pinned folio first, and reads no period into staleness", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    await createTestFolio(alepha, project, { title: "Older" });
    await createTestFolio(alepha, project, { title: "Pinned", pinned: true });
    const fresh = await createTestFolio(alepha, project, { title: "Fresh" });
    // Travelled rather than patched: every update stamps `updatedAt` itself.
    await alepha.inject(DateTimeProvider).travel(120 * day);
    await repos.folios.updateById(fresh.id, { summary: "Touched" });

    const report = await service().report(project.id, { staleDays: 90 });

    expect(report.stale.map((row) => row.title)).toEqual(["Pinned", "Older"]);
    expect(report.staleCount).toBe(2);
    expect(report.total).toBe(3);
  });

  it("calls a folio an orphan until something links to it", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const linked = await createTestFolio(alepha, project, {
      title: "Linked",
    });
    const orphan = await createTestFolio(alepha, project, {
      title: "Orphan",
    });
    await repos.folioLinks.create({
      fromType: "folio",
      fromId: orphan.id,
      toId: linked.id,
    });

    const report = await service().report(project.id, {});

    expect(report.orphans.map((row) => row.title)).toEqual(["Orphan"]);
    expect(report.mostLinked[0]).toMatchObject({ title: "Linked", links: 1 });
    expect(report.medianLinksPerFolio).toBe(0.5);
  });

  it("gives every folio a directory, the root included", async ({ expect }) => {
    const project = await createTestProject(alepha);
    await createTestFolio(alepha, project, { title: "At the root" });

    const report = await service().report(project.id, {});

    expect(report.byDirectory).toEqual([{ name: "/", count: 1 }]);
  });
});
