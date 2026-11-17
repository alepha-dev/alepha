import { $hook, $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * `.alepha/lore.json`: the file that links a directory to its Lore project,
 * `{ "project": "<slug>" }`.
 *
 * One more key is read, by the artifact push only: `"bareQuestRefs": true`
 * makes a bare `#123` in a commit message count as `#Q123` when the push
 * records the quests a commit's history references (#E154). Off by default,
 * because a project that squash-merges through GitHub has `(#123)`, a pull
 * request number, in every merged subject.
 *
 * It is what lets a repository with no `package.json` (a pure compose
 * project) run `lore stack deploy` with no flag and no environment variable.
 * `.alepha/` is the Alepha brand namespace, so the path is right for a user
 * who does not use Alepha Framework.
 *
 * Read once, when the CLI starts, walking up from the working directory to
 * the filesystem root, so a command run from a subdirectory finds it; the
 * nearest file wins. `--project` and `LORE_PROJECT` both come before it
 * (`LoreClientService.resolveProject`).
 */
export class LoreProjectLink {
  protected readonly fs = $inject(FileSystemProvider);

  public static readonly DIR = ".alepha";
  public static readonly FILE = "lore.json";

  /**
   * The slug the nearest link names, loaded at start; undefined when there is
   * none or it cannot be read.
   */
  public linked?: string;

  /**
   * Where it was found, for a message that names the file.
   */
  public linkedFrom?: string;

  protected readonly load = $hook({
    on: "start",
    handler: async () => {
      const found = await this.find(process.cwd());
      this.linked = found?.project;
      this.linkedFrom = found?.path;
    },
  });

  /**
   * The nearest `.alepha/lore.json` from `start` upwards, or undefined.
   */
  public async find(
    start: string,
  ): Promise<
    { project: string; path: string; bareQuestRefs: boolean } | undefined
  > {
    let dir = this.fs.resolve(start);
    for (let depth = 0; depth < 64; depth++) {
      const path = this.fs.join(dir, LoreProjectLink.DIR, LoreProjectLink.FILE);
      if (await this.fs.exists(path)) {
        try {
          const json = await this.fs.readJsonFile<{
            project?: unknown;
            bareQuestRefs?: unknown;
          }>(path);
          if (typeof json.project === "string" && json.project) {
            return {
              project: json.project,
              path,
              bareQuestRefs: json.bareQuestRefs === true,
            };
          }
        } catch {
          return undefined;
        }
      }
      const parent = this.fs.resolve(dir, "..");
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
    return undefined;
  }

  /**
   * Writes the link in `dir`, answering its path. Refused when one already
   * names another project: moving a directory to another project is a
   * decision, said with `--force`.
   */
  public async write(
    dir: string,
    project: string,
    force = false,
  ): Promise<string> {
    const folder = this.fs.join(this.fs.resolve(dir), LoreProjectLink.DIR);
    const path = this.fs.join(folder, LoreProjectLink.FILE);
    const current: Record<string, unknown> = (await this.fs.exists(path))
      ? await this.fs
          .readJsonFile<Record<string, unknown>>(path)
          .catch(() => ({}))
      : {};
    if (!force) {
      if (
        typeof current.project === "string" &&
        current.project &&
        current.project !== project
      ) {
        throw new AlephaError(
          `${path} already links this directory to "${current.project}". Pass --force to link it to "${project}" instead.`,
        );
      }
    }
    await this.fs.mkdir(folder, { recursive: true });
    // Every other key is kept (`bareQuestRefs`): relinking a directory is
    // not a reason to forget how its commits are read.
    await this.fs.writeJsonFile(path, { ...current, project });
    this.linked = project;
    this.linkedFrom = path;
    return path;
  }
}
