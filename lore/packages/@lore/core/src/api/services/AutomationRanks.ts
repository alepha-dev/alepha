import { RankService } from "alepha/api/organizations";

/**
 * Reuse the framework's rank resolution and permission floor, while loading
 * definitions again at every automation authority check.
 */
export class AutomationRanks extends RankService {
  protected override definitionsOf(organizationId: string) {
    return this.definitions.findMany({ where: { organizationId } });
  }
}
