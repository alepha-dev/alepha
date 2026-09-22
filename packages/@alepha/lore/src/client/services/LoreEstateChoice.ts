import { AlephaError } from "alepha";

/**
 * An estate lent to a project, as `GET /api/projects/:id/estates` lists it.
 */
export interface LentEstate {
  id: string;
  slug: string;
}

/**
 * Which estate a newly created copy deploys to: the one rule, shared.
 *
 * Both creators of a copy reach it: `LoreDeployService.ensureInstance` (the
 * Worker-safe client) and the `lore()` platform adapter's first `up` (through
 * `LoreDeployer`). A second hand-written copy of the rule is how the two would
 * come to put the same app on different estates.
 *
 * No imports but `AlephaError`, so the Worker-safe client can carry it.
 */
export class LoreEstateChoice {
  /**
   * The estate a slug names, or the one lent FIRST when none is named.
   *
   * ⚠️ The oldest lending, not the newest. The list is newest first, so this is
   * the LAST item, never `items[0]`: lending a second estate to a project must
   * not silently move where its next new copy lands.
   *
   * ⚠️ A slug, never an id, and resolved against the estates lent to THIS
   * project. An estate is owned by a user and lent out, so a caller that could
   * name an arbitrary one could point a deploy at somebody else's cloud
   * account.
   *
   * `defaulted` says the oldest was taken because nothing was named, so a
   * caller can say so when there was a choice.
   */
  public static pick(
    lent: LentEstate[],
    named: string | undefined,
    copy: string,
  ): LentEstate & { defaulted: boolean } {
    if (lent.length === 0) {
      throw new AlephaError(
        `No estate is lent to this project, so ${copy} would have nowhere to deploy. Lend one on the project's Estates page first.`,
      );
    }

    const slug = named?.trim();
    if (!slug) {
      const oldest = lent[lent.length - 1];
      return { id: oldest.id, slug: oldest.slug, defaulted: true };
    }

    const found = lent.find((it) => it.slug === slug);
    if (!found) {
      throw new AlephaError(
        `No estate called '${slug}' is lent to this project. Lent here: ${lent.map((it) => it.slug).join(", ")}.`,
      );
    }
    return { id: found.id, slug: found.slug, defaulted: false };
  }
}
