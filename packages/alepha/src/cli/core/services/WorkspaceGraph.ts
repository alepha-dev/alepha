import { $inject } from "alepha";
import { ShellProvider } from "alepha/system";

/**
 * One workspace of a monorepo, and the workspaces it depends on.
 */
export interface Workspace {
  /**
   * The package name, which is what `--project` and `yarn w` take.
   */
  name: string;

  /**
   * The workspace directory, relative to the repository root. The root
   * workspace's own location is `.`.
   */
  location: string;

  /**
   * The names of the workspaces this one depends on, from both
   * `dependencies` and `devDependencies`.
   *
   * Both, deliberately, and this is where it differs from
   * {@link BuildFreshness}, which follows only what a bundle inlines. The
   * question here is "could this change break that workspace's tests", and a
   * devDependency breaks tests exactly as well as a dependency does.
   */
  dependencies: string[];
}

/**
 * The workspace dependency graph, and which workspaces a change can reach.
 *
 * This is the half of an affected-only pipeline that decides what to run.
 * Getting it wrong in the generous direction costs time; getting it wrong in
 * the mean direction skips a suite and reports success, so every unknown here
 * resolves to "everything" rather than to "nothing".
 */
export class WorkspaceGraph {
  protected readonly shell = $inject(ShellProvider);

  /**
   * The command that defines what a workspace is.
   *
   * Asking the package manager rather than globbing `workspaces` out of the
   * root manifest and walking for `package.json` files: the glob patterns have
   * negations, and a directory holding a manifest is not automatically a
   * workspace. A scaffolded `apps/tmp` left behind by an interrupted e2e run
   * is the live example of the second, and it would arrive here as a phantom
   * workspace that owns files and has no scripts.
   */
  static readonly LIST_COMMAND = "yarn workspaces list -v --json";

  /**
   * Every workspace, as the package manager sees it.
   */
  public async read(root?: string): Promise<Workspace[]> {
    const result = await this.shell.capture(WorkspaceGraph.LIST_COMMAND, {
      root,
    });

    const rows = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            name: string;
            location: string;
            workspaceDependencies?: string[];
          },
      );

    // Yarn reports dependencies as locations, not names.
    const nameByLocation = new Map(rows.map((it) => [it.location, it.name]));

    return rows.map((row) => ({
      name: row.name,
      location: row.location,
      dependencies: (row.workspaceDependencies ?? []).flatMap((location) => {
        const name = nameByLocation.get(location);
        return name ? [name] : [];
      }),
    }));
  }

  /**
   * The workspace a file belongs to: the longest location that prefixes it.
   *
   * The longest wins because the root workspace's location is `.`, which
   * prefixes every path in the repository. First-match would hand it
   * everything and no other workspace would ever be selected.
   */
  public ownerOf(workspaces: Workspace[], file: string): Workspace | undefined {
    return workspaces
      .filter((it) => it.location === "." || file.startsWith(`${it.location}/`))
      .sort((a, b) => b.location.length - a.location.length)[0];
  }

  /**
   * The given workspaces plus everything that depends on them, transitively.
   *
   * `seen` is what makes this terminate: `lore` and `@alepha/lore` depend on
   * each other in this repository, so a walk without it does not return.
   */
  public dependentsOf(
    workspaces: Workspace[],
    names: Iterable<string>,
  ): Set<string> {
    const seen = new Set<string>();
    const queue = [...names];

    while (queue.length > 0) {
      const name = queue.shift()!;
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);

      for (const workspace of workspaces) {
        if (
          workspace.dependencies.includes(name) &&
          !seen.has(workspace.name)
        ) {
          queue.push(workspace.name);
        }
      }
    }

    return seen;
  }

  /**
   * The workspaces a set of changed files can reach.
   *
   * ⚠️ A file owned by the ROOT workspace, or by no workspace at all, selects
   * every workspace. Nothing declares a dependency on the root, so following
   * edges from it would select the root alone, and root-level files are
   * exactly the ones that govern everybody: `vitest.projects.ts` decides which
   * specs exist, `yarn.lock` decides what they run against, `compose.yml`
   * decides whether the services answer. Editing the file that chooses the
   * suite would otherwise run almost none of it.
   */
  public async affected(
    changedFiles: string[],
    root?: string,
  ): Promise<Set<string>> {
    if (changedFiles.length === 0) {
      return new Set();
    }

    return this.affectedIn(await this.read(root), changedFiles);
  }

  /**
   * {@link affected}, against a graph that has already been read.
   *
   * The rule lives here rather than being restated by callers that happen to
   * hold a workspace list: it is one `if` away from selecting nothing where it
   * should select everything, and a caller's copy of it would drift.
   */
  public affectedIn(
    workspaces: Workspace[],
    changedFiles: string[],
  ): Set<string> {
    if (changedFiles.length === 0) {
      return new Set();
    }

    const everything = new Set(workspaces.map((it) => it.name));
    const owners = new Set<string>();

    for (const file of changedFiles) {
      const owner = this.ownerOf(workspaces, file);
      if (!owner || owner.location === ".") {
        return everything;
      }
      owners.add(owner.name);
    }

    return this.dependentsOf(workspaces, owners);
  }
}
