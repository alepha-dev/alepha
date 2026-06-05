import { $repository } from "alepha/orm";
import { type Sigil, sigils } from "../entities/sigils.ts";

/**
 * Registers the `sigils` entity in the ORM/migration graph and hosts sigil
 * lookup logic shared between the owner-facing CRUD controller and the
 * public server-to-server ingest routes.
 *
 * Declaring the repository here is also what lets
 * `alepha db migrations create` discover the `sigils` table — the migration
 * generator scans instantiated `Repository` services.
 */
export class SigilService {
  protected readonly sigils = $repository(sigils);

  /**
   * Resolve a sigil for the public `/sigils/:id/*` ingest routes. The `:id`
   * IS the credential — a successful lookup is the authentication.
   *
   * Sigils are hard-deleted (`SigilController.deleteSigil`), so a missing
   * row is genuinely gone — a plain `findOne` is correct and a not-found
   * is a clean 404. Never hand this row to an owner-facing payload —
   * `SigilController.toResource` is the projection that drops internal
   * columns.
   */
  public findForIngest(id: string): Promise<Sigil | undefined> {
    return this.sigils.findOne({ where: { id: { eq: id } } });
  }
}
