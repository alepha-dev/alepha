import { type Infer, z } from "alepha";

/**
 * The switches inside the Apps capability.
 *
 * Apps has a **baseline plus two options**: instances, artifacts and quality
 * are there whenever Apps is on, `track` adds the sigil telemetry surfaces
 * (analytics, vitals, errors, explore, blights, sigils), and `deploy` adds
 * epic #1's: the Deploy and Environment tabs, `lore apps deploy`, the
 * `deploy_*` MCP tools and the server gate behind all three.
 *
 * ⚠️ **Quality has no option and does not get one.** It joins the baseline: it
 * is pushed by CI under a CI credential, it is about the software rather than
 * about a running copy, and it already shares the never-turn-someone's-build-red
 * rule with artifact push and sigil ingest. Its Reports tab self-hides until a
 * run exists, exactly as the Blights entry self-hides. That is why the backfill
 * takes `apps` from `features.sigils` OR `features.quality`.
 *
 * ⚠️ **What `deploy` gates, and what it deliberately does not.** It gates epic
 * #1's surface only. The Estates settings page, an instance's estate select and
 * `enqueueEstateCommand` shipped flag-free with epics #20 and #30, and a switch
 * backfilled `false` must never hide a lent estate from the project that most
 * needs to see it.
 *
 * ⚠️ It is a WRITE gate. Reads of existing data stay open, because disabling a
 * capability hides it and never deletes anything: a project that turns `deploy`
 * off gets an empty tab rather than an error on the history it already has.
 *
 * The key was defined and persisted by epic #36 and rendered disabled with a
 * Soon badge, because the wizard is where somebody decides what Lore is for and
 * hiding a planned surface means the "I deploy elsewhere" reader never learns
 * Lore will do it. Epic #1 shipped the surface, deleted the badge, and carried
 * the backfill for every project already lent an estate
 * (`20260907130028_backfill_apps_deploy`). It is still not preselected in the
 * wizard: deploying through Lore means deploying into somebody's cloud account,
 * which is a thing to opt into on purpose.
 *
 * See {@link workCapabilityOptionsSchema} for why every option defaults to
 * `false` and why this schema is lax rather than closed.
 */
export const appsCapabilityOptionsSchema = z.object({
  track: z.boolean().default(false),
  deploy: z.boolean().default(false),
});

export type AppsCapabilityOptions = Infer<typeof appsCapabilityOptionsSchema>;
