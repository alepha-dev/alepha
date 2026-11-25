import {
  PersonaController,
  RequirementsPromptController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { FolioController } from "@lore/remember/api";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Verify's prompts (#E153, #Q3771): rendered on the server from the
 * default (no project keeps its own copy since #Q4281), with the scenario's
 * placeholders, the same text over HTTP, MCP and the CLI.
 */
describe("Verify prompts", () => {
  let ctx: RequirementsProject;
  let prompts: RequirementsPromptController;

  beforeEach(async () => {
    // Verify is gated on `requirements` alone.
    ctx = await requirementsProject();
    prompts = ctx.alepha.inject(RequirementsPromptController);
    const as = ctx.as(ctx.owner);
    await ctx.alepha.inject(PersonaController).createPersona.fetch(
      {
        params: { projectId: ctx.projectId },
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
        params: { projectId: ctx.projectId },
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
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const render = async (query: Record<string, unknown>) =>
    (
      await prompts.renderRequirementsPrompt.fetch(
        { params: { projectId: ctx.projectId }, query: query as never },
        ctx.as(ctx.owner),
      )
    ).data;

  it("renders the default test prompt with the scenario, the persona and the command", async ({
    expect,
  }) => {
    const out = await render({
      kind: "useCaseTest",
      useCaseNumber: 1,
      app: "shop",
      env: "staging",
    });

    expect(out.prompt).toContain('use case #U1, "Create a promo code"');
    expect(out.prompt).toContain("1. Léa: Opens Promotions");
    expect(out.prompt).toContain("2. System: Lists the code");
    expect(out.prompt).toContain(
      "C1 (e2e): Given a product, when she creates a code, then it is listed",
    );
    expect(out.prompt).toContain("#A1 Léa (Shop manager)");
    expect(out.prompt).toContain("lea@acme.test");
    expect(out.prompt).toContain("shop staging");
    expect(out.command).toBe(
      "lore usecase prompt U1 --mode test --app shop --env staging -p acme",
    );
  });

  it("renders a persona's explore prompt, an import prompt, and every stale use case", async ({
    expect,
  }) => {
    const explore = await render({ kind: "personaExplore", personaNumber: 1 });
    expect(explore.prompt).toContain("#A1 Léa");
    expect(explore.prompt).toContain("#U1 Create a promo code");
    expect(explore.command).toContain("--persona A1 --mode explore");

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
    const imported = await render({
      kind: "requirementImport",
      folioShortId: folio.shortId,
    });
    expect(imported.prompt).toContain(`#F${folio.shortId}`);
    expect(imported.command).toContain(
      `--folio F${folio.shortId} --mode import`,
    );

    const stale = await render({ kind: "useCaseTest" });
    expect(stale.prompt).toContain("every stale use case");
  });

  it("prints the same prompt over MCP", async ({ expect }) => {
    const out = await render({ kind: "useCaseSpec", useCaseNumber: 1 });
    const token = await ctx.tokenOf(ctx.owner);
    const viaMcp = await ctx.mcp(token, "usecase_prompt", {
      number: 1,
      mode: "spec",
    });
    expect(viaMcp.refused).toBe(false);
    expect(viaMcp.json?.prompt ?? viaMcp.text).toContain("@U1");
    expect(out.prompt).toContain("@U1");
  });
});
