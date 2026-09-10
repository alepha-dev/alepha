import { $env, $inject, z } from "alepha";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import type { ProjectCreate } from "../schemas/projectCreateSchema.ts";
import type { Project } from "../schemas/projectSchema.ts";
import { GitService } from "./GitService.ts";

/**
 * The projects Loom watches, in `projects.json` under {@link home}.
 *
 * A file rather than a database: a handful of rows, read on every page and
 * written when someone adds a repository. It lives beside the installed
 * binary, `~/.alepha/apps/loom/`, which is why the install is a directory of
 * its own. Dev and the binary share it on purpose: it is the user's list, not
 * the build's.
 *
 * Writes are serialized through {@link queue}, so two adds racing each other
 * cannot drop one.
 */
export class ProjectStore {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly git = $inject(GitService);

  protected readonly env = $env(
    z.object({
      LOOM_HOME: z.text({
        default: "",
        secret: false,
        description:
          "Directory Loom keeps projects.json in. Defaults to ~/.alepha/apps/loom, beside the installed binary.",
      }),
      HOME: z.text({ default: "", secret: false }),
    }),
  );

  protected queue: Promise<unknown> = Promise.resolve();

  public home(): string {
    return (
      String(this.env.LOOM_HOME) ||
      this.fs.join(String(this.env.HOME), ".alepha", "apps", "loom")
    );
  }

  public async list(): Promise<Project[]> {
    const file = this.fs.join(this.home(), "projects.json");
    if (!(await this.fs.exists(file))) {
      return [];
    }
    const parsed = JSON.parse(await this.fs.readTextFile(file)) as {
      projects?: Project[];
    };
    return parsed.projects ?? [];
  }

  public async get(id: string): Promise<Project> {
    const project = (await this.list()).find((it) => it.id === id);
    if (!project) {
      throw new NotFoundError(`No project '${id}'.`);
    }
    return project;
  }

  public add(input: ProjectCreate): Promise<Project> {
    return this.serialize(async () => {
      const path = this.expand(input.path.trim());
      if (!path.startsWith("/")) {
        throw new BadRequestError(
          `'${input.path}' is not an absolute path. Start it with / or ~.`,
        );
      }
      const top = await this.git.topLevel(path);
      if (!top) {
        throw new BadRequestError(`'${path}' is not inside a git repository.`);
      }

      const projects = await this.list();
      const existing = projects.find((it) => it.path === top);
      if (existing) {
        throw new ConflictError(
          `${top} is already open as '${existing.name}'.`,
        );
      }

      const name = input.name?.trim() || top.slice(top.lastIndexOf("/") + 1);
      const project: Project = {
        id: this.uniqueId(name, projects),
        name,
        path: top,
        loreProjectId: input.loreProjectId,
        loreProjectSlug: input.loreProjectSlug?.trim() || undefined,
      };
      await this.write([...projects, project]);
      return project;
    });
  }

  public remove(id: string): Promise<void> {
    return this.serialize(async () => {
      const projects = await this.list();
      if (!projects.some((it) => it.id === id)) {
        throw new NotFoundError(`No project '${id}'.`);
      }
      await this.write(projects.filter((it) => it.id !== id));
    });
  }

  /**
   * `~` and `~/x` against `HOME`; anything else unchanged.
   */
  public expand(path: string): string {
    if (path === "~") {
      return String(this.env.HOME);
    }
    if (path.startsWith("~/")) {
      return this.fs.join(String(this.env.HOME), path.slice(2));
    }
    return path;
  }

  /**
   * A URL-safe handle from the name, suffixed when another project has it.
   */
  protected uniqueId(name: string, projects: Project[]): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "project";
    let id = base;
    for (let n = 2; projects.some((it) => it.id === id); n++) {
      id = `${base}-${n}`;
    }
    return id;
  }

  protected async write(projects: Project[]): Promise<void> {
    await this.fs.mkdir(this.home(), { recursive: true });
    await this.fs.writeFile(
      this.fs.join(this.home(), "projects.json"),
      `${JSON.stringify({ projects }, null, 2)}\n`,
    );
  }

  protected serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
