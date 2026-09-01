import { $inject, AlephaError } from "alepha";
import { $client } from "alepha/server/links";
import type { ProjectController } from "lore/api/controllers/ProjectController";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Turns the project a human names into the integer every endpoint takes.
 *
 * ## ⚠️ NOT re-exported from `index.ts`, and it must stay that way
 *
 * It names `ProjectController`, a type from the private `lore` workspace. The
 * import is erased, but an EXPORTED signature carrying it would put that
 * workspace in the published `.d.ts` and break the install for anyone outside
 * this repo - `scripts/check-dts.mjs` fails the build if that happens.
 *
 * ## Why a service rather than a method on the command that needed it first
 *
 * `alepha lore quality push` had this inline. `alepha lore artifacts push`
 * needs the same translation, and the second copy is where the two would start
 * disagreeing about what `--project` means.
 */
export class LoreProjectResolver {
  protected readonly client = $inject(LoreClientService);

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
        `No Lore project named "${project}". Check the slug in its URL, or pass --project <slug>.`,
      );
    }
    return found.id;
  }
}
