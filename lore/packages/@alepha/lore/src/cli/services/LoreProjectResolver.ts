import { $inject, AlephaError } from "alepha";
import { WorkspacePacker } from "alepha/cli";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";
import type { AppController } from "lore/api/controllers/AppController";
import type { ProjectController } from "lore/api/controllers/ProjectController";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * The four axes a `lore` invocation is about: where, which project, which app,
 * which environment.
 *
 * ## ⚠️ NOT re-exported from `index.ts`, and it must stay that way
 *
 * It names `ProjectController` and `AppController`, types from the private
 * `lore` workspace. The imports are erased, but an EXPORTED signature carrying
 * one would put that workspace in the published `.d.ts` and break the install
 * for anyone outside this repo - `scripts/check-dts.ts` fails the build if
 * that happens.
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
 * | env | `--env`, `LORE_ENV`, the app's own rows |
 *
 * ⚠️ Every step uses `||` and never `??`. A schema default only fills an
 * ABSENT variable, and `LORE_APP=` in a CI environment is present and empty;
 * with `??` that resolves to the empty string and the request goes somewhere
 * with a hole in it rather than to an error.
 *
 * ⚠️ The env fallback is a REMOTE read, not a constant. `production` stopped
 * being a safe client-side default the moment environments became rows: a
 * project may run `b14-production` and have no `production` at all. It reads
 * the APP's rows - the only thing that knows how many environments that app
 * has - and falls back to the word only for an app with no rows, where every
 * answer is equally wrong and the refusal downstream is the useful one.
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
   * The app's own rows, which is what answers the environment question when
   * nobody named one. Same ordering constraint as `projects` above.
   */
  protected readonly apps = $client<AppController>(this.client.scope());

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
   * Which environment this invocation is about.
   *
   * `--env`, `LORE_ENV`, then **the app's own rows**, which is the only place
   * that knows the answer:
   *
   * | rows for this app | result |
   * | --- | --- |
   * | exactly 1 | that one, no flag needed |
   * | 2 or more | refuse, naming them |
   * | 0 | `production` |
   *
   * ⚠️ **This used to be the project's `defaultEnv`, and that was the wrong
   * shape.** It is one value shared by every app of a project while the
   * question is per app, so a project set to `production` with an app whose
   * only row is `preview` had a setting that could only ever be wrong - and it
   * overrode the single place that app can go. The rows are how we know, and a
   * default is only for when we do not.
   *
   * ⚠️ **The zero case answers `production` rather than refusing here**, and
   * cannot succeed either way: a deploy never creates a row, so it lands on
   * `AppsCommand.loadInstance`'s refusal, which names the app, the env and
   * where to create it. That is a better sentence than anything this method
   * could write, since it knows nothing about deploy targets.
   *
   * The remote read is skipped entirely when a flag or a variable answered, so
   * the common path costs no request.
   */
  public async resolveEnv(
    flag: string | undefined,
    projectId: number,
    app: string,
  ): Promise<string> {
    const named = this.client.envFromEnv(flag);
    if (named) {
      return named;
    }

    const { items } = await this.apps.listApps({ params: { projectId } });
    // `listApps` orders by app then env, so these arrive sorted and the
    // refusal below names them in the order the Apps page reads in.
    const envs = items
      .filter((item) => item.app === app)
      .map((item) => item.env);

    if (envs.length === 1) {
      return envs[0];
    }
    if (envs.length === 0) {
      return "production";
    }
    throw new AlephaError(`${app} has ${envs.join(", ")}. Pass --env <name>.`);
  }
}
