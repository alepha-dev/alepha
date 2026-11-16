import { ResourceLinkService } from "@lore/core/api";
import {
  PersonaController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { EpicController } from "@lore/plan/api";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Use cases, Plan's Requirements (#E153, #Q3766): a scenario of steps,
 * alternatives and criteria whose keys are never reused, played by personas
 * (mirrored as `actor` links after the table), covered by epics (`covers`
 * links), and versioned by every scenario edit.
 */
describe("use cases", () => {
  let ctx: RequirementsProject;
  let api: UseCaseController;
  let lea: { id: number };
  let paul: { id: number };

  beforeEach(async () => {
    ctx = await requirementsProject();
    api = ctx.alepha.inject(UseCaseController);
    const personas = ctx.alepha.inject(PersonaController);
    lea = (
      await personas.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
        ctx.as(ctx.owner),
      )
    ).data;
    paul = (
      await personas.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Paul" } },
        ctx.as(ctx.owner),
      )
    ).data;
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const create = async () =>
    (
      await api.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            title: "Check out a basket",
            actors: [
              { personaId: lea.id },
              { personaId: paul.id, role: "beneficiary" },
            ],
            steps: [
              { actorPersonaId: lea.id, text: "Opens the basket" },
              { text: "The shop computes the total" },
            ],
            alternatives: [{ key: "2a", text: "Expired code" }],
            criteria: [
              {
                givenText: "a basket",
                whenText: "she pays",
                thenText: "an order exists",
                method: "e2e",
              },
              { text: "A receipt is mailed", alternativeKey: "2a" },
            ],
          },
        },
        ctx.as(ctx.owner),
      )
    ).data;

  it("are created as a draft with their scenario, numbered, keyed C1, C2", async ({
    expect,
  }) => {
    const uc = await create();

    expect(uc.number).toBe(1);
    expect(uc.status).toBe("draft");
    expect(uc.scenarioVersion).toBe(1);
    expect(uc.actors.map((a) => [a.name, a.role])).toEqual([
      ["Léa", "primary"],
      ["Paul", "beneficiary"],
    ]);
    expect(uc.steps.map((s) => s.text)).toEqual([
      "Opens the basket",
      "The shop computes the total",
    ]);
    expect(uc.alternatives.map((a) => a.key)).toEqual(["2a"]);
    expect(uc.criteria.map((c) => [c.key, c.method])).toEqual([
      ["C1", "e2e"],
      ["C2", "manual"],
    ]);

    const actors = await ctx.alepha
      .inject(ResourceLinkService)
      .relationsTo("actor", "usecase", [String(uc.id)]);
    expect(actors.map((it) => Number(it.fromId)).sort((a, b) => a - b)).toEqual(
      [lea.id, paul.id].sort((a, b) => a - b),
    );
  });

  it("never reuses a criterion key, and bumps the version on a scenario edit only", async ({
    expect,
  }) => {
    const uc = await create();

    // C1 deleted, C2 kept, a new one added: it is C3, never C1.
    const edited = (
      await api.updateUseCase.fetch(
        {
          params: { id: uc.id },
          body: {
            criteria: [
              { key: "C2", text: "A receipt is mailed", alternativeKey: "2a" },
              { text: "The stock goes down" },
            ],
          },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(edited.criteria.map((c) => c.key)).toEqual(["C2", "C3"]);
    expect(edited.scenarioVersion).toBe(2);

    // Asking for a freed key does not reclaim it.
    const again = (
      await api.updateUseCase.fetch(
        {
          params: { id: uc.id },
          body: {
            criteria: [
              { key: "C2", text: "A receipt is mailed", alternativeKey: "2a" },
              { key: "C3", text: "The stock goes down" },
              { key: "C1", text: "Back from the dead" },
            ],
          },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(again.criteria.map((c) => c.key)).toEqual(["C2", "C3", "C4"]);

    // A title alone is not a scenario edit.
    const renamed = (
      await api.updateUseCase.fetch(
        { params: { id: uc.id }, body: { title: "Check out" } },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(renamed.scenarioVersion).toBe(again.scenarioVersion);

    // The same steps sent again change nothing.
    const same = (
      await api.updateUseCase.fetch(
        {
          params: { id: uc.id },
          body: {
            steps: [
              { actorPersonaId: lea.id, text: "Opens the basket" },
              { text: "The shop computes the total" },
            ],
          },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(same.scenarioVersion).toBe(again.scenarioVersion);
  });

  it("refuse an actor from another project and a validated status set by hand", async ({
    expect,
  }) => {
    const uc = await create();
    expect(
      await ctx.statusOf(
        api.updateUseCase.fetch(
          { params: { id: uc.id }, body: { actors: [{ personaId: 999 }] } },
          ctx.as(ctx.owner),
        ),
      ),
    ).toBe(400);
    expect(
      await ctx.statusOf(
        api.updateUseCase.fetch(
          { params: { id: uc.id }, body: { status: "validated" } },
          ctx.as(ctx.owner),
        ),
      ),
    ).toBe(400);
  });

  it("are covered by epics through covers links", async ({ expect }) => {
    const uc = await create();
    const epic = (
      await ctx.alepha.inject(EpicController).createEpic.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { title: "Checkout v2" },
        },
        ctx.as(ctx.owner),
      )
    ).data;

    const covered = (
      await api.linkUseCaseEpic.fetch(
        {
          params: { id: uc.id },
          body: { epicNumber: epic.number, linked: true },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(covered.coveredBy.map((e) => e.number)).toEqual([epic.number]);

    const read = (
      await api.getUseCases.fetch(
        { params: { projectId: ctx.projectId }, query: {} },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(read[0].coveredBy.map((e) => e.title)).toEqual(["Checkout v2"]);

    const uncovered = (
      await api.linkUseCaseEpic.fetch(
        {
          params: { id: uc.id },
          body: { epicNumber: epic.number, linked: false },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(uncovered.coveredBy).toEqual([]);
  });

  it("are read by a viewer who writes none, and comment and delete for a member", async ({
    expect,
  }) => {
    const uc = await create();
    const viewer = await ctx.seat("viewer", "peek");
    const member = await ctx.seat("member");

    expect(
      (
        await api.getUseCaseByNumber.fetch(
          { params: { projectId: ctx.projectId, number: uc.number } },
          ctx.as(viewer),
        )
      ).data.title,
    ).toBe("Check out a basket");
    expect(
      await ctx.statusOf(
        api.updateUseCase.fetch(
          { params: { id: uc.id }, body: { title: "Hijack" } },
          ctx.as(viewer),
        ),
      ),
    ).toBe(403);

    await api.addUseCaseComment.fetch(
      { params: { id: uc.id }, body: { body: "Seen in the shop" } },
      ctx.as(member),
    );
    await api.deleteUseCase.fetch({ params: { id: uc.id } }, ctx.as(member));
    expect(
      await ctx.statusOf(
        api.getUseCaseByNumber.fetch(
          { params: { projectId: ctx.projectId, number: uc.number } },
          ctx.as(member),
        ),
      ),
    ).toBe(404);
    const mirrors = await ctx.alepha
      .inject(ResourceLinkService)
      .relationsTo("actor", "usecase", [String(uc.id)]);
    expect(mirrors).toEqual([]);
  });

  it("write through their MCP tools, in persona and epic numbers", async ({
    expect,
  }) => {
    const token = await ctx.tokenOf(ctx.owner);
    const epic = await ctx.alepha.inject(EpicController).createEpic.fetch(
      {
        params: { projectId: ctx.projectId },
        body: { title: "Checkout v2" },
      },
      ctx.as(ctx.owner),
    );

    const created = await ctx.mcp(token, "usecase_create", {
      title: "Return an item",
      actors: [{ persona: 1 }],
      steps: [{ actor: 1, text: "Asks for a return" }],
      criteria: [{ text: "A refund is issued", method: "agent" }],
    });
    expect(created.refused).toBe(false);
    expect(
      (
        await ctx.mcp(token, "usecase_link_epic", {
          number: 1,
          epic_number: epic.data.number,
        })
      ).refused,
    ).toBe(false);
    const got = await ctx.mcp(token, "usecase_get", { number: 1 });
    expect(got.text).toContain("Asks for a return");
    expect(got.text).toContain("Checkout v2");
    expect(
      (
        await ctx.mcp(token, "usecase_create", {
          title: "Ghost",
          actors: [{ persona: 9 }],
        })
      ).refused,
    ).toBe(true);
    expect((await ctx.mcp(token, "usecase_list", {})).text).toContain("#A1");
  });
});

/**
 * Validation is the use case's own (#Q3767): anyone who writes may ask,
 * only a holder of `usecase:validate` answers, and a scenario edit of a
 * validated use case returns it to ready.
 */
describe("use case validation", () => {
  let ctx: RequirementsProject;
  let api: UseCaseController;

  beforeEach(async () => {
    ctx = await requirementsProject();
    api = ctx.alepha.inject(UseCaseController);
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("is asked by a member and answered by the owner, never by the member", async ({
    expect,
  }) => {
    const member = await ctx.seat("member");
    const uc = (
      await api.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { title: "Check out", criteria: [{ text: "An order exists" }] },
        },
        ctx.as(member),
      )
    ).data;

    const asked = (
      await api.requestUseCaseValidation.fetch(
        { params: { id: uc.id } },
        ctx.as(member),
      )
    ).data;
    // The owner holds usecase:validate; the member who asked is not told.
    expect(asked.notified).toBe(1);

    expect(
      await ctx.statusOf(
        api.validateUseCase.fetch(
          { params: { id: uc.id }, body: { decision: "validated" } },
          ctx.as(member),
        ),
      ),
    ).toBe(403);

    const validated = (
      await api.validateUseCase.fetch(
        {
          params: { id: uc.id },
          body: { decision: "validated", note: "Checked on staging" },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(validated.status).toBe("validated");
    expect(validated.validationNote).toBe("Checked on staging");
    expect(validated.validationRequestedAt).toBeUndefined();

    const edited = (
      await api.updateUseCase.fetch(
        {
          params: { id: uc.id },
          body: { criteria: [{ text: "Two orders exist" }] },
        },
        ctx.as(member),
      )
    ).data;
    expect(edited.status).toBe("ready");

    const back = (
      await api.validateUseCase.fetch(
        {
          params: { id: uc.id },
          body: { decision: "changes_requested", note: "Name the shop" },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    expect(back.status).toBe("draft");
  });

  it("is answered over MCP with usecase_validate", async ({ expect }) => {
    const token = await ctx.tokenOf(ctx.owner);
    await ctx.mcp(token, "usecase_create", { title: "Return an item" });
    const answered = await ctx.mcp(token, "usecase_validate", {
      number: 1,
      decision: "validated",
    });
    expect(answered.refused).toBe(false);
    expect(answered.text).toContain("validated");
  });
});
