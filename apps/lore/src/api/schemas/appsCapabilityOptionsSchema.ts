import { type Infer, z } from "alepha";

/**
 * The switches inside the Apps capability.
 *
 * Apps has a **baseline plus two options**: instances, artifacts and quality
 * are there whenever Apps is on, `track` adds the sigil telemetry surfaces
 * (analytics, vitals, errors, explore, blights, sigils), and `deploy` is
 * reserved.
 *
 * ⚠️ **Quality has no option and does not get one.** It joins the baseline: it
 * is pushed by CI under a CI credential, it is about the software rather than
 * about a running copy, and it already shares the never-turn-someone's-build-red
 * rule with artifact push and sigil ingest. Its Reports tab self-hides until a
 * run exists, exactly as the Blights entry self-hides. That is why the backfill
 * takes `apps` from `features.sigils` OR `features.quality`.
 *
 * ⚠️ **`deploy` gates nothing that exists today.** Estates are owned by a user
 * and lent to a project, and that settings page lists what it holds, so a switch
 * would duplicate what the data already says. The key is defined and persisted
 * from day one so the wizard can render it disabled with a Soon badge - the
 * wizard is where someone decides what Lore is for, and hiding it means the
 * "I deploy elsewhere" reader never learns Lore will do it. Lore Deploy ships by
 * deleting `disabled`, and carries its own backfill for the projects that have
 * been lent an estate.
 *
 * See {@link workCapabilityOptionsSchema} for why every option defaults to
 * `false` and why this schema is lax rather than closed.
 */
export const appsCapabilityOptionsSchema = z.object({
  track: z.boolean().default(false),
  deploy: z.boolean().default(false),
});

export type AppsCapabilityOptions = Infer<typeof appsCapabilityOptionsSchema>;
