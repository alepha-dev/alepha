import { BoundParameters, ProjectSecurityService } from "@lore/core/api";
import {
  type AgentPromptScenarioSubject,
  type Project,
  renderPromptTemplate,
} from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { epics, quests } from "@lore/plan/schemas";
import { folios } from "@lore/remember/schemas";
import { appInstances } from "@lore/ship/schemas";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { personas } from "../entities/personas.ts";
import { requirements } from "../entities/requirements.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import { RequirementsPromptDefaults } from "../schemas/RequirementsPromptDefaults.ts";
import type { RequirementsPromptKind } from "../schemas/requirementsPromptKindSchema.ts";
import type { UseCaseResource } from "../schemas/useCaseResourceSchema.ts";
import { UseCaseService } from "./UseCaseService.ts";

/**
 * The Verify prompts, rendered on the server (#E153, decision 7): the
 * default text (no project keeps its own copy since #Q4281), with its placeholders
 * filled from the subject (a use case, a persona or a folio), the copy and
 * the persona played. One renderer for the dialog, `usecase_prompt` and
 * `lore usecase prompt`, which therefore print the same text.
 */
export class RequirementsPromptService {
  protected readonly alepha = $inject(Alepha);
  protected readonly useCases = $repository(useCases);
  protected readonly personas = $repository(personas);
  protected readonly folios = $repository(folios);
  protected readonly instances = $repository(appInstances);
  protected readonly requirements = $repository(requirements);
  protected readonly criteria = $repository(useCaseCriteria);
  protected readonly epics = $repository(epics);
  protected readonly quests = $repository(quests);
  protected readonly scenario = $inject(UseCaseService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly bound = $inject(BoundParameters);

  public async render(input: {
    project: Project;
    kind: RequirementsPromptKind;
    useCaseNumber?: number;
    personaNumber?: number;
    folioShortId?: number;
    requirementNumber?: number;
    epicNumber?: number;
    staleOnly?: boolean;
    app?: string;
    env?: string;
    asPersona?: number;
  }): Promise<{
    kind: RequirementsPromptKind;
    prompt: string;
    command: string;
  }> {
    const slug = input.project.slug || `project-${input.project.id}`;
    const base = String(this.alepha.env.PUBLIC_URL ?? "");
    const template = RequirementsPromptDefaults[input.kind];
    const played = input.asPersona
      ? await this.persona(input.project.id, input.asPersona)
      : undefined;
    const appUrl = await this.appUrl(input.project.id, input.app, input.env);
    const where = {
      app: input.app ?? "",
      env: input.env ?? (input.app ? "" : "local"),
      appUrl,
    };
    let subject: AgentPromptScenarioSubject;
    let ref: string;

    if (input.kind === "useCaseDraft") {
      // From a coverage gap (#Q3774): a requirement to verify, or an epic
      // with no use case.
      if (input.requirementNumber !== undefined) {
        const [row] = await this.requirements.findMany({
          where: {
            projectId: { eq: input.project.id },
            number: { eq: input.requirementNumber },
          },
          limit: 1,
        });
        if (!row) {
          throw new NotFoundError(
            `Requirement #S${input.requirementNumber} not found`,
          );
        }
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
        ref = `S${row.number}`;
        subject = {
          project: input.project.title,
          slug,
          url: `${base}/${slug}/requirements?requirement=${row.number}`,
          number: row.number,
          id: row.id,
          reference: formatReference("requirement", row.number),
          title: row.statement,
          steps: [row.statement, row.description].filter(Boolean).join("\n\n"),
          criteria:
            verifying
              .map(
                (c) =>
                  `- ${formatReference("usecase", cases.find((it) => it.id === c.useCaseId)?.number ?? 0)} ${c.key}: ${this.criterionText(c)}`,
              )
              .join("\n") || "Nothing yet.",
          persona: played ? this.personaLine(played) : "",
          demoAccount: played?.demoAccount ?? "",
          ...where,
        };
      } else if (input.epicNumber !== undefined) {
        const [epic] = await this.epics.findMany({
          where: {
            projectId: { eq: input.project.id },
            number: { eq: input.epicNumber },
          },
          limit: 1,
        });
        if (!epic)
          throw new NotFoundError(`Epic #E${input.epicNumber} not found`);
        const theirs = await this.quests.findMany({
          where: { epicId: { eq: epic.id } },
          columns: ["shortId", "title"],
          orderBy: [{ column: "shortId", direction: "asc" }],
        });
        ref = `E${epic.number}`;
        subject = {
          project: input.project.title,
          slug,
          url: `${base}/${slug}/epics/${epic.number}`,
          number: epic.number,
          id: epic.id,
          reference: formatReference("epic", epic.number),
          title: epic.title,
          steps:
            theirs
              .map(
                (it) => `- ${formatReference("quest", it.shortId)} ${it.title}`,
              )
              .join("\n") || epic.description,
          criteria: "Nothing yet: no use case covers this epic.",
          persona: played ? this.personaLine(played) : "",
          demoAccount: played?.demoAccount ?? "",
          ...where,
        };
      } else {
        throw new NotFoundError(
          "Draft use cases names a requirement or an epic",
        );
      }
    } else if (input.kind === "requirementImport") {
      if (input.folioShortId === undefined) {
        throw new NotFoundError("Import a specification names a folio");
      }
      const [folio] = await this.folios.findMany({
        where: {
          projectId: { eq: input.project.id },
          shortId: { eq: input.folioShortId },
        },
        limit: 1,
      });
      if (!folio)
        throw new NotFoundError(`Folio #F${input.folioShortId} not found`);
      ref = `F${folio.shortId}`;
      subject = {
        project: input.project.title,
        slug,
        url: `${base}/${slug}/folios/${folio.shortId}`,
        number: folio.shortId,
        id: 0,
        reference: formatReference("folio", folio.shortId),
        title: folio.title,
        steps: "",
        criteria: "",
        persona: "",
        demoAccount: "",
        ...where,
      };
    } else if (
      input.kind === "useCaseTest" &&
      input.useCaseNumber === undefined &&
      input.personaNumber === undefined
    ) {
      // Verify all stale, from the Use cases list: every stale use case.
      const rows = await this.useCases.findMany({
        where: { projectId: { eq: input.project.id } },
      });
      const stale = (await this.scenario.toResources(rows)).filter(
        (it) => it.stale,
      );
      ref = "";
      subject = {
        project: input.project.title,
        slug,
        url: `${base}/${slug}/requirements/use-cases`,
        number: 0,
        id: 0,
        reference: stale
          .map((it) => formatReference("usecase", it.number))
          .join(", "),
        title: "every stale use case",
        steps: stale
          .map((it) => `- ${formatReference("usecase", it.number)} ${it.title}`)
          .join("\n"),
        criteria: stale
          .flatMap((it) =>
            it.criteria.map(
              (c) =>
                `- ${formatReference("usecase", it.number)} ${c.key} (${c.method}): ${this.criterionText(c)}`,
            ),
          )
          .join("\n"),
        persona: played ? this.personaLine(played) : "",
        demoAccount: played?.demoAccount ?? "",
        ...where,
      };
    } else if (
      input.kind === "personaExplore" ||
      (input.useCaseNumber === undefined && input.personaNumber !== undefined)
    ) {
      const persona = await this.persona(
        input.project.id,
        input.personaNumber ?? input.asPersona ?? 0,
      );
      const theirs = await this.useCasesOf(
        input.project.id,
        persona.id,
        input.staleOnly,
      );
      ref = `A${persona.number}`;
      subject = {
        project: input.project.title,
        slug,
        url: `${base}/${slug}/requirements/personas/${persona.number}`,
        number: persona.number,
        id: persona.id,
        reference: formatReference("persona", persona.number),
        title: persona.name,
        steps: theirs
          .map((it) => `- ${formatReference("usecase", it.number)} ${it.title}`)
          .join("\n"),
        criteria: theirs
          .flatMap((it) =>
            it.criteria.map(
              (c) =>
                `- ${formatReference("usecase", it.number)} ${c.key} (${c.method}): ${this.criterionText(c)}`,
            ),
          )
          .join("\n"),
        persona: this.personaLine(persona),
        demoAccount: persona.demoAccount ?? "",
        ...where,
      };
    } else {
      if (input.useCaseNumber === undefined) {
        throw new NotFoundError("This prompt names a use case");
      }
      const [row] = await this.useCases.findMany({
        where: {
          projectId: { eq: input.project.id },
          number: { eq: input.useCaseNumber },
        },
        limit: 1,
      });
      if (!row)
        throw new NotFoundError(`Use case #U${input.useCaseNumber} not found`);
      const [useCase] = await this.scenario.toResources([row]);
      const primary =
        played ??
        (useCase.actors[0]
          ? await this.persona(input.project.id, useCase.actors[0].number)
          : undefined);
      ref = `U${useCase.number}`;
      subject = {
        project: input.project.title,
        slug,
        url: `${base}/${slug}/requirements/use-cases/${useCase.number}`,
        number: useCase.number,
        id: useCase.id,
        reference: formatReference("usecase", useCase.number),
        title: useCase.title,
        steps: this.stepsText(useCase),
        criteria: useCase.criteria
          .map(
            (c) =>
              `- ${c.key} (${c.method})${c.alternativeKey ? ` [${c.alternativeKey}]` : ""}: ${this.criterionText(c)}`,
          )
          .join("\n"),
        persona: primary ? this.personaLine(primary) : "",
        demoAccount: primary?.demoAccount ?? "",
        ...where,
      };
    }

    const mode = {
      useCaseTest: "test",
      useCaseSpec: "spec",
      useCaseDemo: "demo",
      personaExplore: "explore",
      requirementImport: "import",
      useCaseDraft: "draft",
    }[input.kind];
    const command = [
      "lore usecase prompt",
      input.kind === "requirementImport"
        ? `--folio ${ref}`
        : input.kind === "useCaseDraft"
          ? ref.startsWith("E")
            ? `--epic ${ref}`
            : `--requirement ${ref}`
          : ref.startsWith("A")
            ? `--persona ${ref}`
            : ref,
      `--mode ${mode}`,
      input.app ? `--app ${input.app}` : "",
      input.env ? `--env ${input.env}` : "",
      input.asPersona ? `--as A${input.asPersona}` : "",
      input.staleOnly ? "--stale" : "",
      `-p ${slug}`,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      kind: input.kind,
      prompt: renderPromptTemplate(template, subject),
      command,
    };
  }

  public stepsText(useCase: UseCaseResource): string {
    const who = new Map(useCase.actors.map((a) => [a.personaId, a.name]));
    return [
      ...useCase.steps.map(
        (s) =>
          `${s.position}. ${s.actorPersonaId ? `${who.get(s.actorPersonaId) ?? "?"}: ` : "System: "}${s.text}`,
      ),
      ...useCase.alternatives.map((a) => `${a.key}. ${a.text}`),
    ].join("\n");
  }

  public criterionText(c: {
    text?: string;
    givenText?: string;
    whenText?: string;
    thenText?: string;
  }): string {
    return (
      c.text ??
      [
        c.givenText && `Given ${c.givenText}`,
        c.whenText && `when ${c.whenText}`,
        c.thenText && `then ${c.thenText}`,
      ]
        .filter(Boolean)
        .join(", ")
    );
  }

  public personaLine(p: {
    number: number;
    name: string;
    role?: string;
  }): string {
    return `${formatReference("persona", p.number)} ${p.name}${p.role ? ` (${p.role})` : ""}`;
  }

  protected async persona(projectId: number, number: number) {
    const [row] = await this.personas.findMany({
      where: { projectId: { eq: projectId }, number: { eq: number } },
      limit: 1,
    });
    if (!row) throw new NotFoundError(`Persona #A${number} not found`);
    return row;
  }

  /**
   * A persona's use cases, or only their stale ones.
   */
  public async useCasesOf(
    projectId: number,
    personaId: number,
    staleOnly?: boolean,
  ): Promise<UseCaseResource[]> {
    const rows = await this.useCases.findMany({
      where: { projectId: { eq: projectId } },
    });
    const all = await this.scenario.toResources(rows);
    return all.filter(
      (it) =>
        it.actors.some((a) => a.personaId === personaId) &&
        (!staleOnly || it.stale),
    );
  }

  protected async appUrl(
    projectId: number,
    app?: string,
    env?: string,
  ): Promise<string> {
    if (!app || !env) return "";
    try {
      const [copy] = await this.instances.findMany({
        where: {
          projectId: { eq: projectId },
          app: { eq: app },
          env: { eq: env },
        },
        columns: ["url"],
        limit: 1,
      });
      return copy?.url ?? "";
    } catch {
      // Ship's tables exist in every schema; a project without Ship simply
      // has no copy, which reads as no URL.
      return "";
    }
  }
}
