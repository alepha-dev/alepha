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
 * Worker-safe client) and the `lore()` infra adapter's first `up` (through
 * `LoreDeployer`). A second hand-written copy of the rule is how the two would
 * come to put the same app on different estates.
 *
 * No imports but `AlephaError`, so the Worker-safe client can carry it.
 */
export class LoreEstateChoice {
  /**
   * The estate a slug names, or the only one lent when none is named.
   *
   * ⚠️ Unnamed among several is REFUSED (#Q3144, owner 2026-11-06), naming
   * them and the way to choose. It used to take the oldest lending, which was
   * a silent choice of machine: which estate a copy deploys to is decided on
   * the Lore side (the Apps page, `lore apps instance create --estate`), never
   * guessed by a deploy.
   *
   * ⚠️ A slug, never an id, and resolved against the estates lent to THIS
   * project. An estate is owned by a user and lent out, so a caller that could
   * name an arbitrary one could point a deploy at somebody else's cloud
   * account.
   */
  public static pick(
    lent: LentEstate[],
    named: string | undefined,
    copy: string,
  ): LentEstate {
    if (lent.length === 0) {
      throw new AlephaError(
        `No estate is lent to this project, so ${copy} would have nowhere to deploy. Buy a server and lend it here with \`lore estate provision --provider scaleway --project <project>\`, or lend one you own with \`lore estate lend <slug> --project <project>\` (your estates: \`lore estate list\`).`,
      );
    }

    const slug = named?.trim();
    if (!slug) {
      if (lent.length > 1) {
        throw new AlephaError(
          `Several estates are lent to this project (${lent.map((it) => it.slug).join(", ")}), so ${copy} needs one chosen. Choose it on the Apps page, or create the copy with \`lore apps instance create --app <app> --env <env> --estate <slug>\`.`,
        );
      }
      return { id: lent[0].id, slug: lent[0].slug };
    }

    const found = lent.find((it) => it.slug === slug);
    if (!found) {
      throw new AlephaError(
        `No estate called '${slug}' is lent to this project. Lent here: ${lent.map((it) => it.slug).join(", ")}.`,
      );
    }
    return { id: found.id, slug: found.slug };
  }
}
