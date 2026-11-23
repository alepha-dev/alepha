import { ProjectLimits } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject, Alepha, type Infer } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { GitBackend } from "../backends/GitBackend.ts";
import {
  type CodeRepository,
  codeRepositories,
} from "../entities/codeRepositories.ts";
import type { codeRepositorySchema } from "../schemas/codeRepositorySchema.ts";
import { CodeCommitIndex } from "./CodeCommitIndex.ts";

/**
 * A project's git repositories: the rows, and the backend behind them
 * (#E162). Every write goes through here, so the row and the backend never
 * disagree for longer than one failed call.
 */
export class CodeRepositoryService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly backend = $inject(GitBackend);
  protected readonly limits = $inject(ProjectLimits);
  protected readonly index = $inject(CodeCommitIndex);
  protected readonly repositories = $repository(codeRepositories);
  protected readonly projects = $repository(projects);

  /**
   * The project's repositories, by slug.
   */
  public async list(projectId: number): Promise<CodeRepository[]> {
    return this.repositories.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: "slug",
    });
  }

  /**
   * One repository by its slug, or undefined.
   */
  public async find(
    projectId: number,
    slug: string,
  ): Promise<CodeRepository | undefined> {
    return (
      (await this.repositories.findOne({
        where: { projectId: { eq: projectId }, slug: { eq: slug } },
      })) ?? undefined
    );
  }

  /**
   * Create an empty repository: the row first, then the backend, and the
   * row removed again when the backend refuses.
   */
  public async create(input: {
    projectId: number;
    slug: string;
    defaultBranch?: string;
    createdBy?: string;
  }): Promise<CodeRepository> {
    if (await this.find(input.projectId, input.slug)) {
      throw new ConflictError(
        `This project already has a repository named "${input.slug}".`,
      );
    }
    const max = await this.limits.maxRepositoriesPerProject();
    const count = await this.repositories.count({
      projectId: { eq: input.projectId },
    });
    if (count >= max) {
      throw new BadRequestError(`A project holds at most ${max} repositories.`);
    }
    const id = crypto.randomUUID();
    const defaultBranch = input.defaultBranch ?? "main";
    const backendRef = this.backend.refFor({
      projectId: input.projectId,
      repoId: id,
    });
    const row = await this.repositories.create({
      id,
      projectId: input.projectId,
      slug: input.slug,
      defaultBranch,
      backendRef,
      createdBy: input.createdBy,
    });
    try {
      await this.backend.create(backendRef, { defaultBranch });
    } catch (error) {
      await this.repositories.deleteById(row.id);
      throw error;
    }
    return row;
  }

  /**
   * Delete a repository: the backend first, then the row, so a refusal
   * leaves the repository listed rather than a backend repository nothing
   * names.
   */
  public async delete(projectId: number, slug: string): Promise<void> {
    const row = await this.find(projectId, slug);
    if (!row) {
      throw new NotFoundError(`No repository named "${slug}".`);
    }
    await this.backend.delete(row.backendRef);
    await this.index.deleteFor(row.id);
    await this.repositories.deleteById(row.id);
  }

  /**
   * Every repository of a project, gone: what a project deletion runs.
   */
  public async deleteAll(projectId: number): Promise<number> {
    const rows = await this.list(projectId);
    for (const row of rows) {
      await this.backend.delete(row.backendRef);
      await this.index.deleteFor(row.id);
      await this.repositories.deleteById(row.id);
    }
    return rows.length;
  }

  /**
   * The HTTPS clone URL: `/<project>/<slug>.git`, or `/<project>.git` for
   * the repository named like its project.
   */
  public cloneUrl(projectSlug: string, slug: string, base: string): string {
    const root = base.replace(/\/+$/, "");
    return slug === projectSlug
      ? `${root}/${projectSlug}.git`
      : `${root}/${projectSlug}/${slug}.git`;
  }

  /**
   * The answer the API gives for a row.
   */
  public async toResource(
    row: CodeRepository,
    base: string,
  ): Promise<Infer<typeof codeRepositorySchema>> {
    const project = await this.projects.findById(row.projectId);
    const projectSlug = project?.slug ?? String(row.projectId);
    return {
      id: row.id,
      projectId: row.projectId,
      slug: row.slug,
      defaultBranch: row.defaultBranch,
      cloneUrl: this.cloneUrl(projectSlug, row.slug, base),
      backend: this.backend.kind,
      createdAt: row.createdAt,
    };
  }

  /**
   * The base a clone URL starts with: `PUBLIC_URL` when set, else the origin
   * the request came in on.
   */
  public baseUrl(requestUrl?: URL): string {
    const configured = String(this.alepha.env.PUBLIC_URL ?? "");
    if (configured) return configured;
    return requestUrl?.origin ?? "";
  }
}
