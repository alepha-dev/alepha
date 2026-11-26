import {
  PersonaController,
  RequirementController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { EpicController } from "@lore/plan/api";
import { PromptController } from "@lore/prompts/api";
import { FolioController } from "@lore/remember/api";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Requirements' built-ins on the prompts registry (#Q4343): the Verify
 * dialog's six kinds as one-shot prompts a project can run and pin, each
 * filled from its use case, persona, requirement, folio or epic.
 */
describe("Requirements built-in prompts", () => {
  let ctx: RequirementsProject;
  let prompts: PromptController;

  const NAMES = [
    "test-use-case",
    "write-use-case-spec",
    "prepare-use-case-demo",
    "explore-as-persona",
    "import-specification",
    "draft-use-cases",
    "draft-epic-use-cases",
  ];

  beforeEach(async () => {
    ctx = await requirementsProject();
    prompts = ctx.alepha.inject(PromptController);
    const as = ctx.as(ctx.owner);
    const params = { projectId: ctx.projectId };
    await ctx.alepha.inject(PersonaController).createPersona.fetch(
      {
        params,
        body: {
          name: "Léa",
          role: "Shop manager",
          demoAccount: "lea@acme.test",
        },
      },
      as,
    );
    await ctx.alepha.inject(UseCaseController).createUseCase.fetch(
      {
        params,
        body: {
          title: "Create a promo code",
          actors: [{ personaId: 1 }],
          steps: [
            { actorPersonaId: 1, text: "Opens Promotions" },
            { text: "Lists the code" },
          ],
          criteria: [
            {
              givenText: "a product",
              whenText: "she creates a code",
              thenText: "it is listed",
              method: "e2e",
            },
          ],
        },
      },
      as,
    );
    await ctx.alepha
      .inject(RequirementController)
      .createRequirement.fetch(
        { params, body: { statement: "Promo codes expire" } },
        as,
      );
    await ctx.alepha
      .inject(EpicController)
      .createEpic.fetch({ params, body: { title: "Promotions" } }, as);
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const render = async (name: string, args: Record<string, string>) =>
    (
      await prompts.renderPrompt.run(
        { params: { projectId: ctx.projectId, name }, body: { args } },
        { user: { id: ctx.owner, roles: ["user"] } as never },
      )
    ).text;

  it("lists the seven built-ins after Plan's, one-shot, each with its arg", async ({
    expect,
  }) => {
    const items = (
      await prompts.listPrompts.run(
        { params: { projectId: ctx.projectId } },
        { user: { id: ctx.owner, roles: ["user"] } as never },
      )
    ).items;
    const names = items.map((it) => it.name);
    expect(names.slice(-NAMES.length)).toEqual(NAMES);
    const byName = Object.fromEntries(items.map((it) => [it.name, it]));
    expect(byName["test-use-case"]!.args).toEqual([
      {
        name: "useCase",
        type: "useCase",
        accepts: ["draft", "ready", "validated"],
      },
    ]);
    expect(byName["import-specification"]!.args).toEqual([
      { name: "folio", type: "folio" },
    ]);
    for (const name of NAMES) {
      expect(byName[name]!.text).not.toContain("ask for");
    }
  });

  it("registers the use case, persona and requirement views and the use case list as pinnable pages, and pins each built-in to the view its item fills (#Q4412)", async ({
    expect,
  }) => {
    const answer = await prompts.listPrompts.run(
      { params: { projectId: ctx.projectId } },
      { user: { id: ctx.owner, roles: ["user"] } as never },
    );
    const pages = new Map(answer.pages.map((it) => [it.key, it]));
    expect(pages.get("use-cases")?.gives).toBeUndefined();
    expect(pages.get("use-case")?.gives).toBe("useCase");
    expect(pages.get("persona")?.gives).toBe("persona");
    expect(pages.get("requirement")?.gives).toBe("requirement");
    const pins = Object.fromEntries(
      answer.items.map((it) => [it.name, it.pins]),
    );
    expect(pins).toMatchObject({
      "test-use-case": ["use-case"],
      "write-use-case-spec": ["use-case"],
      "prepare-use-case-demo": ["use-case"],
      "explore-as-persona": ["persona"],
      "draft-use-cases": ["requirement"],
      "draft-epic-use-cases": ["epic"],
      // No folio view is pinnable.
      "import-specification": [],
    });
  });

  it("fills a pinned run's useCase arg from the value the Use case view gives, its number", async ({
    expect,
  }) => {
    // What `PinnedPromptsButton` on the use case page passes: the number.
    const text = await render("test-use-case", { useCase: "1" });
    expect(text).toContain('use case #U1, "Create a promo code"');
  });

  it("leaves them out of a project with Requirements off", async ({
    expect,
  }) => {
    const off = await requirementsProject({ requirements: false });
    try {
      const answer = await off.alepha
        .inject(PromptController)
        .listPrompts.run(
          { params: { projectId: off.projectId } },
          { user: { id: off.owner, roles: ["user"] } as never },
        );
      const names = answer.items.map((it) => it.name);
      for (const name of NAMES) expect(names).not.toContain(name);
      // Nor are their pages offered to pin a prompt to (#Q4412).
      const pages = answer.pages.map((it) => it.key);
      for (const page of ["use-cases", "use-case", "persona", "requirement"]) {
        expect(pages).not.toContain(page);
      }
      // And a pin to one of them is refused.
      await expect(
        off.alepha.inject(PromptController).updatePrompt.run(
          {
            params: { projectId: off.projectId, name: "weekly-status" },
            body: { pins: ["use-case"] },
          },
          { user: { id: off.owner, roles: ["user"] } as never },
        ),
      ).rejects.toThrow("No page 'use-case' to pin a prompt to");
    } finally {
      await off.alepha.stop();
    }
  });

  it("fills a use case's scenario, persona and demo account, and signs up a throwaway account when it has no credentials", async ({
    expect,
  }) => {
    const text = await render("test-use-case", { useCase: "#U1" });
    expect(text).toContain('use case #U1, "Create a promo code"');
    expect(text).toContain("1. Léa: Opens Promotions");
    expect(text).toContain(
      "C1 (e2e): Given a product, when she creates a code, then it is listed",
    );
    expect(text).toContain("As: #A1 Léa (Shop manager)");
    expect(text).toContain('demo account is "lea@acme.test"');
    expect(text).toContain(
      "create a fresh account through the app's own sign-up",
    );
    expect(text).toContain("Never play it against production");
    // A run plays the app in a browser when the host has one (#Q4429).
    expect(text).toContain("Play it in a real browser");
    expect(text).toContain("`command -v playwright-cli`");
    expect(text).toContain("number 1");

    const spec = await render("write-use-case-spec", { useCase: "1" });
    expect(spec).toContain("tagged `@U1`");
    // It lands like every work prompt: a sub-agent review, then auto-merge
    // where allowed, never a merge that skips CI (#Q4533).
    expect(spec).toContain("start a sub-agent to review the pull request");
    expect(spec).toContain("`gh pr merge --auto --rebase`");
    expect(spec).toContain("Never merge it at once without CI");
    expect(spec).not.toContain("Never merge it yourself");
    expect(spec).not.toContain("lets an agent do so");
    const demo = await render("prepare-use-case-demo", { useCase: "1" }).catch(
      (error: Error) => error.message,
    );
    // A draft use case is not one to demo.
    expect(demo).toMatch(/draft/);
  });

  it("fills a persona, a folio, a requirement and an epic", async ({
    expect,
  }) => {
    const explore = await render("explore-as-persona", { persona: "A1" });
    expect(explore).toContain('persona #A1, "Léa"');
    expect(explore).toContain("- #U1 Create a promo code");
    expect(explore).toContain("create a fresh account");

    const folio = (
      await ctx.alepha.inject(FolioController).create.fetch(
        {
          body: {
            projectId: ctx.projectId,
            title: "Specification",
            content: "## 3.2 Codes",
          },
        },
        ctx.as(ctx.owner),
      )
    ).data;
    const imported = await render("import-specification", {
      folio: String(folio.shortId),
    });
    expect(imported).toContain(`"Specification"`);
    expect(imported).toContain(`shortId ${folio.shortId}`);

    const draft = await render("draft-use-cases", { requirement: "1" });
    expect(draft).toContain('"Promo codes expire"');
    expect(draft).toContain("Nothing yet.");
    expect(draft).toContain("`requirement_get`, number 1");

    const epic = await render("draft-epic-use-cases", { epic: "1" });
    expect(epic).toContain('epic #E1, "Promotions"');
    expect(epic).toContain("`epic_get`, number 1");
  });
});
