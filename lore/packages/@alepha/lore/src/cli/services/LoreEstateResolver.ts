import type { EstateController } from "@lore/deploy/api";
import { $inject } from "alepha";
import { UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Finds one of the caller's OWN estates by slug (#Q3131).
 *
 * Every owner-scoped estate action (`get`, `stats`, `update`, `rotate`,
 * `delete`) refuses anything the caller does not own, and a slug is unique
 * per owner, so the caller's own list is the only place to look one up. The
 * project's list (`lore estate list`) is the wrong one: it holds the estates
 * lent to the project, which may belong to someone else.
 */
export class LoreEstateResolver {
  protected readonly client = $inject(LoreClientService);
  protected readonly estates = $client<EstateController>(this.client.scope());

  /**
   * The estate named `slug` among the caller's own, or a usage error saying
   * why there is none.
   */
  async owned(slug: string) {
    const { items } = await this.estates.listMyEstates();
    const estate = items.find((item) => item.slug === slug);
    if (!estate) {
      throw new UsageError(
        `You own no estate named ${slug}. lore estate list shows the project's, and only an estate's owner can act on it.`,
      );
    }
    return estate;
  }
}
