import { AlephaError } from "alepha";

/**
 * Finished work, as the Delivery tab needs to place it in a deploy (#Q3008):
 * lead time for changes runs from a quest's completion to the first deploy
 * carrying it. Quests are Work's and deployments Deploy's, and neither module
 * may import the other, so Work registers here and Deploy asks.
 */
export class DeliveryChangeRegistry {
  protected source?: DeliveryChangeSource;

  public register(source: DeliveryChangeSource): void {
    if (this.source) {
      throw new AlephaError("A delivery change source is already registered");
    }
    this.source = source;
  }

  /**
   * Nothing without a source: a project can run Deploy with no Work module.
   */
  public async changes(
    projectId: number,
    window: { from?: string; to?: string },
  ): Promise<DeliveryChange[]> {
    return (await this.source?.(projectId, window)) ?? [];
  }
}

export type DeliveryChangeSource = (
  projectId: number,
  window: { from?: string; to?: string },
) => Promise<DeliveryChange[]>;

export interface DeliveryChange {
  completedAt: string;
  /**
   * The tag of the release holding it, matched to a deployment's tag.
   */
  tag?: string;
  /**
   * Commits recorded on it, matched to an artifact's commit by prefix.
   */
  commits: string[];
}
