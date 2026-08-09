import { createSigilAnalyticsEntities } from "@alepha/sigil/ingest";
import { sigils } from "./sigils.ts";

/**
 * The three sigil aggregate tables, built from the package's shared factory.
 *
 * They used to be declared inline here, one file each. They moved into
 * `@alepha/sigil/ingest` so any Alepha app can be its own sink — but they
 * could not move as plain entities: every one of them carries
 * `db.ref(…, () => sigils.cols.id, { onDelete: "cascade" })`, and `sigils` is
 * *this app's* entity, referencing this app's `projects`. The package would
 * have had to own the whole chain. Parameterising the reference is what lets
 * the schema live in the package while the foreign key stays real.
 *
 * The cascade is load-bearing and is the reason dropping the ref for a plain
 * uuid was rejected: deleting an app erases everything it ever reported, which
 * is exactly why the UI tells the operator to **rotate** rather than delete.
 *
 * Table names, columns, defaults and indexes are unchanged, so this generates
 * no migration — and that is checked, not assumed: `yarn check:migrations`
 * diffs the entities against the snapshot.
 *
 * The three `sigil*.ts` siblings re-export one entity each, so every existing
 * import site is untouched and the file-per-entity convention survives.
 */
export const sigilAnalytics = createSigilAnalyticsEntities({
  sigilIdRef: () => sigils.cols.id,
});
