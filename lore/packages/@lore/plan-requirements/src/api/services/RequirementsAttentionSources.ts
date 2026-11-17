import {
  DashboardAttentionRegistry,
  type DashboardAttentionItem,
  type DashboardAttentionItems,
} from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { requirements } from "../entities/requirements.ts";
import { useCases } from "../entities/useCases.ts";
import { RequirementService } from "./RequirementService.ts";
import { UseCaseService } from "./UseCaseService.ts";

/**
 * Requirements' rows of the dashboard's "Needs you" (#E153, #Q3775): the
 * failing Must requirements, the stale use cases, and the requirements
 * whose specification changed, under Plan's `requirements` option.
 */
export class RequirementsAttentionSources {
  protected readonly attention = $inject(DashboardAttentionRegistry);
  protected readonly requirements = $repository(requirements);
  protected readonly useCases = $repository(useCases);
  protected readonly requirementService = $inject(RequirementService);
  protected readonly useCaseService = $inject(UseCaseService);

  constructor() {
    this.attention.register({
      key: "requirements",
      needs: { capability: "plan", option: "requirements" },
      requires: "requirement:read",
      read: (project) => this.read(project),
    });
  }

  protected async read(project: Project): Promise<DashboardAttentionItems> {
    const slug = project.slug ?? "";
    const [rows, cases] = await Promise.all([
      this.requirements.findMany({ where: { projectId: { eq: project.id } } }),
      this.useCases.findMany({
        where: { projectId: { eq: project.id }, status: { ne: "deprecated" } },
      }),
    ]);
    const [resources, caseResources] = await Promise.all([
      this.requirementService.toResources(rows),
      this.useCaseService.toResources(cases),
    ]);
    const link = (number: number) => ({
      route: "projectRequirements",
      params: { projectSlug: slug },
      query: { requirement: String(number) },
    });
    const items: DashboardAttentionItem[] = [];
    for (const it of resources.filter(
      (row) => row.priority === "must" && row.status === "failing",
    )) {
      items.push({
        weight: 35,
        row: {
          id: `S${it.number}`,
          title: `${formatReference("requirement", it.number)} ${it.statement}`,
          badge: "failingMust",
          state: "bad",
          link: link(it.number),
        },
      });
    }
    for (const it of resources.filter((row) => row.sourceChanged)) {
      items.push({
        weight: 18,
        row: {
          id: `S${it.number}:source`,
          title: `${formatReference("requirement", it.number)} ${it.statement}`,
          badge: "sourceChanged",
          state: "warn",
          link: link(it.number),
        },
      });
    }
    for (const it of caseResources.filter((row) => row.stale)) {
      items.push({
        weight: 15,
        row: {
          id: `U${it.number}`,
          title: `${formatReference("usecase", it.number)} ${it.title}`,
          badge: "stale",
          state: "warn",
          link: {
            route: "projectUseCase",
            params: { projectSlug: slug, useCaseNumber: String(it.number) },
          },
        },
      });
    }
    return {
      items,
      total: items.length,
      link: { route: "projectRequirements", params: { projectSlug: slug } },
    };
  }
}
