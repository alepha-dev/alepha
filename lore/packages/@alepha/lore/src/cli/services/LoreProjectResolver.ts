import { $inject, AlephaError } from "alepha";
import { WorkspacePacker } from "alepha/cli";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";
import type { ProjectController } from "lore/api/controllers/ProjectController";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * The four axes a `lore` invocation is about: where, which project, which app,
 * which environment.
 *
 * ## ⚠️ NOT re-exported from `index.ts`, and it must stay that way
 *
 * It names `ProjectController`, a type from the private `lore` workspace. The
 * import is erased, but an EXPORTED signature carrying it would put that
 * workspace in the published `.d.ts` and break the install for anyone outside
 * this repo - `scripts/check-dts.ts` fails the build if that happens.
 *
 * ## Why a service rather than a method on the command that needed it first
 *
 * `lore quality push` had this inline. `lore artifacts push`
 * needs the same translation, and the second copy is where the two would start
 * disagreeing about what `--project` means. The `lore apps` commands added two
 * more axes on the same argument.
 *
 * ## The precedence, once
 *
 * | axis | order |
 * | --- | --- |
 * | url | `--url`, `LORE_URL` (in `LoreClientService`) |
 * | project | `--project` / `-p`, `LORE_PROJECT` |
 * | app | `--app`, `LORE_APP`, the directory's slugified package name |
 * | env | `--env`, `LORE_ENV`, the project's own default environment |
 *
 * ⚠️ Every step uses `||` and never `??`. A schema default only fills an
 * ABSENT variable, and `LORE_APP=` in a CI environment is present and empty;
 * with `??` that resolves to the empty string and the request goes somewhere
 * with a hole in it rather than to an error.
 *
 * ⚠️ The env fallback is a REMOTE read, not a constant. `production` stopped
 * being a safe client-side default the moment environments became rows: a
 * project may run `b14-production` and have no `production` at all.
 */
export class LoreProjectResolver {
  protected readonly client = $inject(LoreClientService);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly packer = $inject(WorkspacePacker);

  /**
   * ⚠️ Declared after `client`, and it has to be: a field initializer reading
   * another field sees `undefined` if that field is declared below it. Same
   * ordering constraint every `$client` in this package carries.
   */
  protected readonly projects = $client<ProjectController>(this.client.scope());

  /**
   * `--project` names a project the way a person does: by its slug, which is
   * what Lore's own URLs carry. Every project-scoped endpoint takes an integer
   * id, so one of the two has to translate.
   *
   * It happens here rather than on the endpoint because `$ownsProject` gates
   * by primary key from a path param, and a slug is not the key -
   * `getProjectBySlug` has to check membership by hand for exactly that
   * reason. Pushing the translation into the endpoint would mean a second gate
   * shape in Lore for the benefit of one caller.
   *
   * A numeric value is taken as an id directly, so a caller that already has
   * one pays no round trip.
   */
  public async resolve(project: string): Promise<number> {
    if (/^\d+$/.test(project)) {
      return Number(project);
    }

    const found = await this.projects.getProjectBySlug({
      params: { slug: project },
    });
    if (!found?.id) {
      throw new AlephaError(
        `No Lore project named "${project}". Check the slug in its URL, pass --project <slug>, or set LORE_PROJECT in the environment.`,
      );
    }
    return found.id;
  }

  /**
   * Which app this invocation is about.
   *
   * `--app`, `LORE_APP`, then the directory's own `package.json` name,
   * slugified **through {@link WorkspacePacker.slugify}** rather than by a
   * second implementation of it. `ArtifactCommand` already delegates for the
   * same reason: two derivations of one name is what let `pack` write one file
   * while `BayAdapter` looked for another.
   */
  public async resolveApp(
    flag: string | undefined,
    root: string,
  ): Promise<string> {
    const named = this.client.appFromEnv(flag);
    if (named) {
      return named;
    }

    const path = this.fs.join(root, "package.json");
    let name: string | undefined;
    try {
      const pkg = await this.fs.readJsonFile<{ name?: string }>(path);
      name = pkg.name;
    } catch {
      throw new AlephaError(
        `Could not read ${path}, so there is nothing to take the app name from. Run this from a workspace directory, pass --app <name>, or set LORE_APP in the environment.`,
      );
    }
    if (!name) {
      throw new AlephaError(
        `Missing "name" in ${path}, so there is nothing to take the app name from. Pass --app <name>, or set LORE_APP in the environment.`,
      );
    }
    return this.packer.slugify(name);
  }

  /**
   * Which environment this invocation is about, or nothing.
   *
   * `--env`, `LORE_ENV`, then the project's own `defaultEnv`, asked of Lore.
   *
   * ⚠️ **Answers `undefined` rather than throwing**, because the caller knows
   * something this does not: how many environments the app actually has. One
   * environment needs no flag, several must refuse rather than guess. That
   * decision belongs to the command; {@link assertEnv} is the refusal, so its
   * wording lives here with the rest of the chain.
   *
   * The remote read is skipped entirely when a flag or a variable answered, so
   * the common path costs no request.
   */
  public async resolveEnv(
    flag: string | undefined,
    project: string,
  ): Promise<string | undefined> {
    const named = this.client.envFromEnv(flag);
    if (named) {
      return named;
    }

    // A numeric project is an id and has no slug to look up, so the remote
    // default is only reachable by name. Answering `undefined` sends the
    // caller to `assertEnv`, which names `--env`; guessing would be worse.
    if (/^\d+$/.test(project)) {
      return undefined;
    }

    const found = await this.projects.getProjectBySlug({
      params: { slug: project },
    });
    return found?.defaultEnv || undefined;
  }

  /**
   * The refusal when no environment resolved.
   *
   * Names all three ways to answer, the third being a setting rather than an
   * input: a project that deploys to one environment should set it once rather
   * than have every command carry a flag.
   */
  public assertEnv(env: string | undefined, app: string): string {
    if (!env) {
      throw new AlephaError(
        `No environment named for "${app}". Pass --env <name>, set LORE_ENV in the environment, or set the project's default environment in its Apps settings.`,
      );
    }
    return env;
  }
}
