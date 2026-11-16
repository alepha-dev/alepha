import {
  RequirementController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { EpicController, ReleaseController } from "@lore/plan/api";
import { FolioController } from "@lore/remember/api";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Requirements (#E153, #Q3768): verified by criteria, covered by the epics
 * of those criteria's use cases, and shipped in a target release that is
 * derived from those epics (auto), or set by hand while no covering epic
 * sits in a release.
 */
describe("requirements", () => {
  let ctx: RequirementsProject;
  let requirements: RequirementController;
  let useCases: UseCaseController;
  let epics: EpicController;
  let releases: ReleaseController;

  beforeEach(async () => {
    ctx = await requirementsProject();
    requirements = ctx.alepha.inject(RequirementController);
    useCases = ctx.alepha.inject(UseCaseController);
    epics = ctx.alepha.inject(EpicController);
    releases = ctx.alepha.inject(ReleaseController);
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const as = () => ctx.as(ctx.owner);
  const release = async (tag: string) =>
    (
      await releases.createRelease.fetch(
        { params: { projectId: ctx.projectId }, body: { tag, title: tag } },
        as(),
      )
    ).data;
  const epic = async (title: string, releaseId?: number) => {
    const made = (
      await epics.createEpic.fetch(
        { params: { projectId: ctx.projectId }, body: { title } },
        as(),
      )
    ).data;
    if (releaseId) {
      await epics.updateEpic.fetch(
        { params: { id: made.id }, body: { releaseId } },
        as(),
      );
    }
    return made;
  };
  const requirement = async (statement: string) =>
    (
      await requirements.createRequirement.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            statement,
            type: "functional",
            priority: "must",
            paragraph: "3.2",
          },
        },
        as(),
      )
    ).data;
  /**
   * A use case with one criterion verifying `req`, covered by `epicNumber`.
   */
  const verifiedBy = async (reqNumber: number, epicNumber?: number) => {
    const uc = (
      await useCases.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            title: `Scenario for S${reqNumber}`,
            criteria: [{ text: "It works" }],
          },
        },
        as(),
      )
    ).data;
    await requirements.linkCriterion.fetch(
      {
        params: { projectId: ctx.projectId },
        body: {
          useCaseNumber: uc.number,
          criterionKey: "C1",
          requirementNumber: reqNumber,
        },
      },
      as(),
    );
    if (epicNumber) {
      await useCases.linkUseCaseEpic.fetch(
        { params: { id: uc.id }, body: { epicNumber, linked: true } },
        as(),
      );
    }
    return uc;
  };
  const read = async (number: number) =>
    (
      await requirements.getRequirementByNumber.fetch(
        { params: { projectId: ctx.projectId, number } },
        as(),
      )
    ).data;

  it("is not covered until a criterion verifies it, then covered, with the personas of its use cases", async ({
    expect,
  }) => {
    const req = await requirement("A promo code shows its discount");
    expect((await read(req.number)).status).toBe("not_covered");

    await verifiedBy(req.number);
    const covered = await read(req.number);
    expect(covered.status).toBe("covered");
    expect(covered.criteria.map((c) => [c.useCaseNumber, c.key])).toEqual([
      [1, "C1"],
    ]);

    const uc = (
      await useCases.getUseCaseByNumber.fetch(
        { params: { projectId: ctx.projectId, number: 1 } },
        as(),
      )
    ).data;
    expect(uc.criteria[0].requirementNumber).toBe(req.number);
  });

  it("derives its release from the covering epics, the latest winning, and stores nothing", async ({
    expect,
  }) => {
    const r23 = await release("2.3.0");
    const r24 = await release("2.4.0");
    const e1 = await epic("Promo codes", r23.id);
    const e2 = await epic("Cart", r24.id);
    const req = await requirement("A promo code shows its discount");
    await verifiedBy(req.number, e1.number);
    await verifiedBy(req.number, e2.number);

    const it = await read(req.number);
    expect(it.coveringEpics.map((e) => e.number).sort((a, b) => a - b)).toEqual(
      [e1.number, e2.number].sort((a, b) => a - b),
    );
    expect(it.targetRelease?.tag).toBe("2.4.0");
    expect(it.targetRelease?.mode).toBe("auto");
    expect(it.targetReleaseId).toBeUndefined();

    // An epic moved elsewhere moves the requirement with it, on read.
    await epics.updateEpic.fetch(
      { params: { id: e2.id }, body: { releaseId: null } },
      as(),
    );
    expect((await read(req.number)).targetRelease?.tag).toBe("2.3.0");
  });

  it("keeps a release set by hand without epics, and pulls a first epic without release into it", async ({
    expect,
  }) => {
    const r24 = await release("2.4.0");
    const req = await requirement("Codes expire");
    const set = (
      await requirements.setRequirementRelease.fetch(
        { params: { id: req.id }, body: { releaseId: r24.id } },
        as(),
      )
    ).data;
    expect(set.applied).toBe(true);
    expect(set.requirement.targetRelease).toMatchObject({
      tag: "2.4.0",
      mode: "by_hand",
    });

    const e1 = await epic("Expiry");
    await verifiedBy(req.number, e1.number);

    const epicNow = (
      await epics.getEpicByNumber.fetch(
        { params: { projectId: ctx.projectId, number: e1.number } },
        as(),
      )
    ).data;
    expect(epicNow.releaseId).toBe(r24.id);
    const it = await read(req.number);
    expect(it.targetRelease).toMatchObject({ tag: "2.4.0", mode: "auto" });
  });

  it("lets an epic already in a release win, and clears the by-hand value", async ({
    expect,
  }) => {
    const r23 = await release("2.3.0");
    const r24 = await release("2.4.0");
    const req = await requirement("Codes expire");
    await requirements.setRequirementRelease.fetch(
      { params: { id: req.id }, body: { releaseId: r24.id } },
      as(),
    );
    const e1 = await epic("Expiry", r23.id);
    await verifiedBy(req.number, e1.number);

    const it = await read(req.number);
    expect(it.targetRelease).toMatchObject({ tag: "2.3.0", mode: "auto" });
    expect(it.targetReleaseId).toBeUndefined();
  });

  it("moves every covering epic when set, asking first when an epic covers another requirement or sits in a release", async ({
    expect,
  }) => {
    const r23 = await release("2.3.0");
    const r24 = await release("2.4.0");
    const shared = await epic("Promotions", r23.id);
    const s1 = await requirement("A code shows its discount");
    const s2 = await requirement("A code is single use");
    await verifiedBy(s1.number, shared.number);
    await verifiedBy(s2.number, shared.number);

    const asked = (
      await requirements.setRequirementRelease.fetch(
        { params: { id: s1.id }, body: { releaseId: r24.id } },
        as(),
      )
    ).data;
    expect(asked.applied).toBe(false);
    expect(asked.moves).toEqual([
      expect.objectContaining({
        epicNumber: shared.number,
        fromReleaseId: r23.id,
        alsoCovers: [s2.number],
      }),
    ]);
    expect((await read(s1.number)).targetRelease?.tag).toBe("2.3.0");

    const done = (
      await requirements.setRequirementRelease.fetch(
        { params: { id: s1.id }, body: { releaseId: r24.id, confirm: true } },
        as(),
      )
    ).data;
    expect(done.applied).toBe(true);
    expect((await read(s1.number)).targetRelease?.tag).toBe("2.4.0");
    expect((await read(s2.number)).targetRelease?.tag).toBe("2.4.0");
  });

  it("is read by a viewer, refused a write, and written over MCP", async ({
    expect,
  }) => {
    const viewer = await ctx.seat("viewer", "peek");
    await requirement("Codes expire");
    expect(
      (
        await requirements.getRequirements.fetch(
          { params: { projectId: ctx.projectId }, query: {} },
          ctx.as(viewer),
        )
      ).data,
    ).toHaveLength(1);
    expect(
      await ctx.statusOf(
        requirements.createRequirement.fetch(
          {
            params: { projectId: ctx.projectId },
            body: { statement: "Hijack" },
          },
          ctx.as(viewer),
        ),
      ),
    ).toBe(403);

    const token = await ctx.tokenOf(ctx.owner);
    const made = await ctx.mcp(token, "requirement_create", {
      statement: "The shop is available",
      type: "non_functional",
      priority: "should",
    });
    expect(made.refused).toBe(false);
    await ctx.mcp(token, "usecase_create", {
      title: "Open the shop",
      criteria: [{ text: "It answers" }],
    });
    expect(
      (
        await ctx.mcp(token, "criterion_verify_link", {
          usecase_number: 1,
          key: "C1",
          requirement_number: 2,
        })
      ).refused,
    ).toBe(false);
    const listed = await ctx.mcp(token, "requirement_list", {});
    expect(listed.text).toContain("#U1 C1");

    await ctx.mcp(token, "requirement_delete", { number: 2 });
    const uc = await ctx.mcp(token, "usecase_get", { number: 1 });
    expect(uc.text).not.toContain("requirementNumber");
  });
});

/**
 * Source changed (#Q3769): a requirement cites a heading of a folio; each
 * new revision of that folio compares the section with the text it was
 * synced to, and Update or Keep resyncs it.
 */
describe("a requirement's source", () => {
  let ctx: RequirementsProject;
  let requirements: RequirementController;
  let folios: FolioController;

  beforeEach(async () => {
    ctx = await requirementsProject();
    requirements = ctx.alepha.inject(RequirementController);
    folios = ctx.alepha.inject(FolioController);
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const spec = (expiry: string) =>
    [
      "# Specification",
      "## 3.2 Promo codes",
      "A code shows its discount.",
      "## 3.3 Expiry",
      expiry,
    ].join("\n");

  it("is flagged when its section is edited, then removed, and cleared by a resync", async ({
    expect,
  }) => {
    const as = ctx.as(ctx.owner);
    const folio = (
      await folios.create.fetch(
        {
          body: {
            projectId: ctx.projectId,
            title: "Specification",
            content: spec("Codes expire."),
          },
        },
        as,
      )
    ).data;
    const req = (
      await requirements.createRequirement.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            statement: "Codes expire",
            sourceFolioId: folio.id,
            sourceAnchor: "33-expiry",
          },
        },
        as,
      )
    ).data;
    expect(req.sourceSectionText).toBe("Codes expire.");
    expect(req.sourceChanged).toBe(false);

    // Another section moving changes nothing.
    await folios.update.fetch(
      {
        params: { id: folio.id },
        body: {
          content: spec("Codes expire.").replace(
            "its discount",
            "the discount",
          ),
        },
      },
      as,
    );
    const read = async () =>
      (
        await requirements.getRequirementByNumber.fetch(
          { params: { projectId: ctx.projectId, number: req.number } },
          as,
        )
      ).data;
    expect((await read()).sourceChanged).toBe(false);

    await folios.update.fetch(
      {
        params: { id: folio.id },
        body: { content: spec("Codes expire after 30 days.") },
      },
      as,
    );
    expect(await read()).toMatchObject({
      sourceChanged: true,
      sourceChangeKind: "edited",
    });

    await folios.update.fetch(
      {
        params: { id: folio.id },
        body: {
          content: spec("x").replace("## 3.3 Expiry", "## 3.3 Validity"),
        },
      },
      as,
    );
    expect(await read()).toMatchObject({
      sourceChanged: true,
      sourceChangeKind: "removed",
    });

    await folios.update.fetch(
      {
        params: { id: folio.id },
        body: { content: spec("Codes expire after 30 days.") },
      },
      as,
    );
    const kept = (
      await requirements.resyncRequirementSource.fetch(
        { params: { id: req.id } },
        as,
      )
    ).data;
    expect(kept.sourceChanged).toBe(false);
    expect(kept.sourceSectionText).toBe("Codes expire after 30 days.");
  });
});
