import { $repository } from "alepha/orm";
import { type Sigil, sigils } from "../entities/sigils.ts";

/**
 * Registers the `sigils` entity in the ORM/migration graph and hosts sigil
 * lookup logic shared between the owner-facing CRUD controller and the
 * public embed-script route.
 *
 * Declaring the repository here is also what lets
 * `alepha db migrations create` discover the `sigils` table — the migration
 * generator scans instantiated `Repository` services.
 */
export class SigilService {
  protected readonly sigils = $repository(sigils);

  /**
   * Resolve a sigil for the public `/sigils/:id/*` routes.
   *
   * Sigils are hard-deleted (`SigilController.deleteSigil`), so a missing
   * row is genuinely gone — a plain `findOne` is correct and a not-found
   * is a clean 404.
   *
   * Returns the full row INCLUDING `ingestKey`: the embed route bakes that
   * secret into the served `.js` body by design (it is a semi-public speed
   * bump, not real auth). Never hand this row to an owner-facing payload —
   * `SigilController.toResource` is the path that strips the secret.
   */
  public findForEmbed(id: string): Promise<Sigil | undefined> {
    return this.sigils.findOne({ where: { id: { eq: id } } });
  }
}
