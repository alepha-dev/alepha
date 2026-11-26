import {
  BoundParameters,
  type PromptArgContext,
  PromptRegistry,
} from "@lore/core/api";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { personas } from "../entities/personas.ts";
import { requirements } from "../entities/requirements.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import {
  draftEpicUseCasesPromptText,
  draftUseCasesPromptText,
  exploreAsPersonaPromptText,
  importSpecificationPromptText,
  prepareUseCaseDemoPromptText,
  testUseCasePromptText,
  writeUseCaseSpecPromptText,
} from "../prompts/requirementsPrompts.ts";
import { RequirementsPromptService } from "./RequirementsPromptService.ts";
import { UseCaseService } from "./UseCaseService.ts";

/**
 * Requirements' built-in prompts and the items its args name (#Q4343): the
 * six kinds of the Verify dialog as registry built-ins, so a project can
 * run, trigger and pin them. The old `useCaseDraft` took a requirement or an
 * epic, which is two built-ins here, since an arg has one type.
 *
 * Each needs Plan's `requirements` option, and comes pinned to the view
 * whose item fills its arg (#Q4412): the use case, persona and requirement
 * views Requirements registers, the epic view Plan does. The use case, persona and
 * requirement args read their item by its number; Remember registers the
 * folio arg, Plan the epic arg.
 */
export class RequirementsPrompts {
  protected readonly registry = $inject(PromptRegistry);
  protected readonly useCases = $repository(useCases);
  protected readonly personas = $repository(personas);
  protected readonly requirements = $repository(requirements);
  protected readonly criteria = $repository(useCaseCriteria);
  protected readonly scenario = $inject(UseCaseService);
  protected readonly render = $inject(RequirementsPromptService);
  protected readonly bound = $inject(BoundParameters);

  constructor() {
    const needs = { capability: "plan", option: "requirements" } as const;
    const playable = ["draft", "ready", "validated"];
    // The pages Requirements' prompts are pinned to (#Q4412), each shown
    // with its item filled in. The requirement view is the detail panel of
    // the requirements list, as the feedback view is of the feedback list.
    // No folio view is pinnable, so `import-specification` comes unpinned.
    for (const page of [
      { key: "use-cases", label: "Use case list" },
      { key: "use-case", label: "Use case view", gives: "useCase" },
      { key: "persona", label: "Persona view", gives: "persona" },
      { key: "requirement", label: "Requirement view", gives: "requirement" },
    ] as const) {
      this.registry.registerPage({ ...page, needs });
    }
    this.registry.register({
      name: "test-use-case",
      title: "Test a use case",
      description:
        "Play a use case in the app as its persona, fixing nothing, and record one run with a result per criterion.",
      args: [{ name: "useCase", type: "useCase", accepts: playable }],
      source: "read",
      permission: "usecase:write",
      needs,
      text: testUseCasePromptText,
      pins: ["use-case"],
      oneShot: true,
    });
    this.registry.register({
      name: "write-use-case-spec",
      title: "Write the end-to-end spec",
      description:
        "Write one end-to-end test per criterion of a use case into a pull request, and record the spec on it.",
      args: [{ name: "useCase", type: "useCase", accepts: playable }],
      source: "write",
      permission: "usecase:write",
      needs,
      text: writeUseCaseSpecPromptText,
      pins: ["use-case"],
      oneShot: true,
    });
    this.registry.register({
      name: "prepare-use-case-demo",
      title: "Prepare a demo",
      description:
        "Write the demo script of a use case and the data it needs, filed as a folio linked from it.",
      args: [
        { name: "useCase", type: "useCase", accepts: ["ready", "validated"] },
      ],
      source: "read",
      permission: "folio:write",
      needs,
      text: prepareUseCaseDemoPromptText,
      pins: ["use-case"],
      oneShot: true,
    });
    this.registry.register({
      name: "explore-as-persona",
      title: "Explore as a persona",
      description:
        "Use the app in a persona's shoes and comment every friction met on the persona, changing nothing.",
      args: [{ name: "persona", type: "persona" }],
      source: "read",
      permission: "persona:write",
      needs,
      text: exploreAsPersonaPromptText,
      pins: ["persona"],
      oneShot: true,
    });
    this.registry.register({
      name: "import-specification",
      title: "Import a specification",
      description:
        "Turn every requirement a specification folio states into a requirement of the project.",
      args: [{ name: "folio", type: "folio" }],
      source: "none",
      permission: "requirement:write",
      needs,
      text: importSpecificationPromptText,
      oneShot: true,
    });
    this.registry.register({
      name: "draft-use-cases",
      title: "Draft use cases",
      description:
        "Draft the use cases that would verify a requirement, left in draft for a person to validate.",
      args: [{ name: "requirement", type: "requirement" }],
      source: "none",
      permission: "usecase:write",
      needs,
      text: draftUseCasesPromptText,
      pins: ["requirement"],
      oneShot: true,
    });
    this.registry.register({
      name: "draft-epic-use-cases",
      title: "Draft an epic's use cases",
      description:
        "Draft the use cases an epic delivers, left in draft for a person to validate.",
      args: [
        {
          name: "epic",
          type: "epic",
          accepts: ["draft", "ready", "in_progress"],
        },
      ],
      source: "none",
      permission: "usecase:write",
      needs,
      text: draftEpicUseCasesPromptText,
      pins: ["epic"],
      oneShot: true,
    });

    this.registry.registerArg({
      type: "useCase",
      permission: "usecase:read",
      resolve: (context) => this.useCaseOf(context),
    });
    this.registry.registerArg({
      type: "persona",
      permission: "persona:read",
      resolve: (context) => this.personaOf(context),
    });
    this.registry.registerArg({
      type: "requirement",
      permission: "requirement:read",
      resolve: (context) => this.requirementOf(context),
    });
    this.registry.registerOptions("useCase", (projectId, accepts) =>
      this.useCaseOptions(projectId, accepts),
    );
    this.registry.registerOptions("persona", (projectId) =>
      this.personaOptions(projectId),
    );
    this.registry.registerOptions("requirement", (projectId) =>
      this.requirementOptions(projectId),
    );
  }

  /**
   * The digits of `12`, `#12`, `#U12`.
   */
  protected numberOf(value: string): number | undefined {
    const match = /^#?[A-Za-z]?(\d{1,9})$/.exec(value.trim());
    return match ? Number(match[1]) : undefined;
  }

  /**
   * Where a persona lives, as the run reads it: the copy's app and env
   * names, or a line saying none is set.
   */
  protected environmentOf(persona?: {
    environmentApp?: string;
    environmentEnv?: string;
  }): string {
    const named = [persona?.environmentApp, persona?.environmentEnv]
      .filter(Boolean)
      .join(" ");
    return named ? `app and env "${named}"` : "none named";
  }

  protected demoAccountOf(persona?: { demoAccount?: string }): string {
    return persona?.demoAccount ? `"${persona.demoAccount}"` : "not set";
  }

  protected async useCaseOf(context: PromptArgContext) {
    const number = this.numberOf(context.value);
    if (number === undefined) return undefined;
    const row = await this.useCases.findOne({
      where: { projectId: { eq: context.project.id }, number: { eq: number } },
    });
    if (!row) return undefined;
    const [useCase] = await this.scenario.toResources([row]);
    const actor = useCase.actors[0];
    const persona = actor
      ? await this.personas.findOne({
          where: {
            projectId: { eq: context.project.id },
            number: { eq: actor.number },
          },
        })
      : undefined;
    return {
      status: row.status,
      gone: !!row.deletedAt,
      fields: {
        reference: formatReference("usecase", row.number),
        title: row.title,
        url: `${context.projectUrl}/requirements/use-cases/${row.number}`,
        number: row.number,
        id: row.id,
        steps: this.render.stepsText(useCase) || "None written yet.",
        criteria:
          useCase.criteria
            .map(
              (c) =>
                `- ${c.key} (${c.method})${c.alternativeKey ? ` [${c.alternativeKey}]` : ""}: ${this.render.criterionText(c)}`,
            )
            .join("\n") || "None written yet.",
        persona: persona ? this.render.personaLine(persona) : "no actor set",
        demoAccount: this.demoAccountOf(persona),
        environment: this.environmentOf(persona),
      },
    };
  }

  protected async personaOf(context: PromptArgContext) {
    const number = this.numberOf(context.value);
    if (number === undefined) return undefined;
    const persona = await this.personas.findOne({
      where: { projectId: { eq: context.project.id }, number: { eq: number } },
    });
    if (!persona) return undefined;
    const theirs = await this.render.useCasesOf(context.project.id, persona.id);
    return {
      gone: !!persona.deletedAt,
      fields: {
        reference: formatReference("persona", persona.number),
        title: persona.name,
        url: `${context.projectUrl}/requirements/personas/${persona.number}`,
        number: persona.number,
        id: persona.id,
        role: persona.role || "no role set",
        useCases:
          theirs
            .map(
              (it) => `- ${formatReference("usecase", it.number)} ${it.title}`,
            )
            .join("\n") || "None yet.",
        criteria: theirs
          .flatMap((it) =>
            it.criteria.map(
              (c) =>
                `- ${formatReference("usecase", it.number)} ${c.key} (${c.method}): ${this.render.criterionText(c)}`,
            ),
          )
          .join("\n"),
        demoAccount: this.demoAccountOf(persona),
        environment: this.environmentOf(persona),
      },
    };
  }

  protected async requirementOf(context: PromptArgContext) {
    const number = this.numberOf(context.value);
    if (number === undefined) return undefined;
    const row = await this.requirements.findOne({
      where: { projectId: { eq: context.project.id }, number: { eq: number } },
    });
    if (!row) return undefined;
    const verifying = await this.criteria.findMany({
      where: { requirementId: { eq: row.id } },
    });
    // Batched under D1's bind limit (#Q3959).
    const cases = await this.bound.collect(
      [...new Set(verifying.map((it) => it.useCaseId))],
      (batch) =>
        this.useCases.findMany({
          where: { id: { inArray: batch } },
          columns: ["id", "number"],
        }),
    );
    return {
      gone: !!row.deletedAt,
      fields: {
        reference: formatReference("requirement", row.number),
        title: row.statement,
        url: `${context.projectUrl}/requirements?requirement=${row.number}`,
        number: row.number,
        id: row.id,
        description: row.description || row.statement,
        verifiedBy:
          verifying
            .map(
              (c) =>
                `- ${formatReference("usecase", cases.find((it) => it.id === c.useCaseId)?.number ?? 0)} ${c.key}: ${this.render.criterionText(c)}`,
            )
            .join("\n") || "Nothing yet.",
      },
    };
  }

  /**
   * The newest use cases an arg may take.
   */
  protected async useCaseOptions(projectId: number, accepts?: string[]) {
    const rows = await this.useCases.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["number", "title", "status", "deletedAt"],
      orderBy: [{ column: "number", direction: "desc" }],
      limit: 200,
    });
    return rows
      .filter(
        (it) =>
          !it.deletedAt && (!accepts?.length || accepts.includes(it.status)),
      )
      .map((it) => ({
        value: String(it.number),
        label: `${formatReference("usecase", it.number)} ${it.title}`,
      }));
  }

  protected async personaOptions(projectId: number) {
    const rows = await this.personas.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["number", "name", "deletedAt"],
      orderBy: [{ column: "number", direction: "asc" }],
      limit: 200,
    });
    return rows
      .filter((it) => !it.deletedAt)
      .map((it) => ({
        value: String(it.number),
        label: `${formatReference("persona", it.number)} ${it.name}`,
      }));
  }

  protected async requirementOptions(projectId: number) {
    const rows = await this.requirements.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["number", "statement", "deletedAt"],
      orderBy: [{ column: "number", direction: "desc" }],
      limit: 200,
    });
    return rows
      .filter((it) => !it.deletedAt)
      .map((it) => ({
        value: String(it.number),
        label: `${formatReference("requirement", it.number)} ${it.statement}`,
      }));
  }
}
