import { AlephaError } from "alepha";

/**
 * A host lent to a project, as `GET /api/projects/:id/hosts` lists it.
 */
export interface LentHost {
  id: string;
  slug: string;
  /**
   * The host's home project (epic #E126): a slug is unique per home, so two
   * hosts lent to one project can share one, and this tells them apart.
   */
  home?: { slug?: string; title: string };
}

/**
 * Which host a newly created copy deploys to: the one rule, shared.
 *
 * Both creators of a copy reach it: `LoreDeployService.ensureInstance` (the
 * Worker-safe client) and the `lore()` infra adapter's first `up` (through
 * `LoreDeployer`). A second hand-written copy of the rule is how the two would
 * come to put the same app on different hosts.
 *
 * No imports but `AlephaError`, so the Worker-safe client can carry it.
 */
export class LoreHostChoice {
  /**
   * The host a slug names, or the only one lent when none is named.
   *
   * ⚠️ Unnamed among several is REFUSED (#Q3144, owner 2026-11-06), naming
   * them and the way to choose. It used to take the oldest lending, which was
   * a silent choice of machine: which host a copy deploys to is decided on
   * the Lore side (the Apps page, `lore apps instance create --host`), never
   * guessed by a deploy.
   *
   * ⚠️ A slug, never an id, and resolved against the hosts lent to THIS
   * project. A host belongs to its home project and is lent out, so a caller that could
   * name an arbitrary one could point a deploy at somebody else's cloud
   * account.
   */
  public static pick(
    lent: LentHost[],
    named: string | undefined,
    copy: string,
  ): LentHost {
    if (lent.length === 0) {
      throw new AlephaError(
        `No host is lent to this project, so ${copy} would have nowhere to deploy. Buy a server for it with \`lore host provision --provider scaleway --project <project>\`, or lend one of another project's with \`lore host lend <slug> --project <project>\`.`,
      );
    }

    const slug = named?.trim();
    if (!slug) {
      if (lent.length > 1) {
        throw new AlephaError(
          `Several hosts are lent to this project (${lent.map((it) => it.slug).join(", ")}), so ${copy} needs one chosen. Choose it on the Apps page, or create the copy with \`lore apps instance create --app <app> --env <env> --host <slug>\`.`,
        );
      }
      return { id: lent[0].id, slug: lent[0].slug };
    }

    const matching = lent.filter((it) => it.slug === slug);
    if (matching.length > 1) {
      // A slug is unique per home project, not across the projects that lend
      // to one: two lenders' `ovh-1` are two machines, and picking the first
      // would be a silent choice of machine (#Q3144, #Q3282).
      throw new AlephaError(
        `Two hosts called '${slug}' are lent to this project, from ${matching
          .map((it) => it.home?.slug ?? it.home?.title ?? "an unknown project")
          .join(
            " and ",
          )}. Choose the copy's host on the Apps page, or detach one of them.`,
      );
    }
    const found = matching[0];
    if (!found) {
      throw new AlephaError(
        `No host called '${slug}' is lent to this project. Lent here: ${lent.map((it) => it.slug).join(", ")}.`,
      );
    }
    return { id: found.id, slug: found.slug };
  }
}
