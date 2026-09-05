import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { estates } from "./estates.ts";
import { projects } from "./projects.ts";
import { sigils } from "./sigils.ts";
import { users } from "./users.ts";

/**
 * One deployed copy of an app: `club` in `b14-production`, `lore` in
 * `production`.
 *
 * ## ⚠️ There is no `apps` table, deliberately
 *
 * A reader who finds `app_instances` with no `apps` beside it will go looking
 * for the missing parent. There is none, and adding one is the design this
 * epic spent four rounds removing (folio #1185):
 *
 * - **You cannot create an app on its own.** A `club` row with no instance
 *   shows nothing and does nothing, and every creation flow drawn for it
 *   secretly created an instance too. That is the signal it was never an
 *   entity.
 * - **Nothing wants app-level storage.** Artifacts are keyed by a plain `app`
 *   string with a deliberate non-FK ("a project that ships a build for an app
 *   it never enrolled is a normal state"); the changelog and the areas
 *   attachment left the epic entirely (#1776, #1777, shelved).
 * - **The table would create pressure to FK `artifacts.app`**, which that
 *   entity explicitly argues against.
 *
 * "The app" is `GROUP BY app`, and this codebase already has the pattern:
 * `quests.area` is a string with `areas` as a metadata table kept in sync by
 * `AreaService.ensureArea`. If app-level metadata ever appears, add a metadata
 * table keyed `(projectId, app)` following `areas`, **not** a parent with a
 * foreign key.
 *
 * The one real cost is that a typo silently creates a second app: `club` and
 * `clbu` are two apps and nothing complains. The create dialog offers the
 * existing names as a combobox (#1772), which is the whole mitigation.
 *
 * ## Capabilities are unlocks, not configuration
 *
 * Both credentials are nullable, and each one turns a set of tabs on:
 *
 * | column | unlocks |
 * |---|---|
 * | nothing | Overview, Artifacts, Settings |
 * | {@link sigilId} | Analytics, Vitals, Errors, Explore |
 * | {@link estateId} | an estate on Settings, and Deploy when epic #1 lands |
 *
 * ⚠️ **The estate is per instance, never per app.** That is why one app can
 * have two instances on two estate types, which is the case the level exists
 * for. #1810 designed `environments (projectId, name, estateId)` at project
 * grain and was retired for exactly this: `docs` deploys to Cloudflare and
 * `bay` runs on the OVH VPS, and both are `production`, so one row with one
 * estate cannot serve both.
 *
 * ## ⚠️ There is no runtime or provider column, and there must not be
 *
 * `artifacts.runtime` (`node | bun | workerd | static`, with `docker` coming)
 * is what a build targets. `estates.type` (`bay | cloudflare`, more coming) is
 * what a machine is. The provider is already on the estate and this row
 * reaches it through {@link estateId}; a column here would duplicate it and
 * give two places to disagree, and one named `runtime` holding `cloudflare`
 * would make the word mean two things in two tables. What an estate accepts is
 * a deploy-time mapping owned by epic #1, expressed as data rather than a
 * switch, because both axes are open-ended.
 *
 * ## ⚠️ The column is `env`; the wire says `environment`
 *
 * `estateCommandPayloadSchema` carries `{ app, environment, artifact? }` and
 * Bay reads it as `json:"environment"`. That is wire format v1 (folio #1198,
 * epic #20). The mapping from this column to that key is one line in epic #1's
 * deploy service; renaming the payload is a Bay release.
 */
export const appInstances = $entity({
  name: "app_instances",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The app this copy is of, e.g. `club`.
     *
     * Free text within `APP_NAME_PATTERN`, normalised (trim, lowercase) then
     * tested by `AppService`, exactly as `SigilController.claimName` does. It
     * is a URL segment, so it has to survive a path unescaped.
     *
     * The column is `max(100)` while the way in is `max(64)`, for the reason
     * `sigils.name` is: a value that fails a column's schema does not read as
     * `undefined`, it throws every query that touches the table. The
     * constraint lives on the way in, where a rejection is a 400.
     */
    app: z.string().min(1).max(100),
    /**
     * Which copy, e.g. `production`, `staging`, `b14-production`.
     *
     * **Free text. Nothing parses it**, and nothing may start: there is no
     * `production` boolean, no `tenant` column and no suffix convention. An
     * environment and a tenant are the same kind of thing at this level, both
     * just "which copy", and one name expresses the pair. Every behaviour that
     * looked like it needed a `production` flag is better served by its own
     * per-instance setting, added by the epic that implements it (folio
     * #1185).
     *
     * Same charset and same column/input asymmetry as {@link app}.
     */
    env: z.string().min(1).max(100),
    /**
     * Where this copy lives, as the operator typed it.
     *
     * The override half of the address; the detected half is
     * `sigils.lastSeenHost`, reached through {@link sigilId}. A full URL rather
     * than a host, because this one is typed and someone pinning an address may
     * want a path on it. Deliberately without a `db.default`, like the columns
     * it was copied from.
     */
    url: z.string().max(2048).optional(),
    /**
     * The telemetry credential this copy reports with, when it has one.
     *
     * `set null` rather than cascade: deleting a sigil is revoking a
     * credential, and the deploy target outlives it. The reverse direction
     * (deleting the instance takes its sigil with it) is enforced in
     * `AppService`, the way `ArtifactService` enforces `fileId`, not by a
     * database rule.
     *
     * ⚠️ The foreign key lives HERE and never on `sigils`. That table is the
     * `ON DELETE CASCADE` parent of the four analytics tables and of
     * `blights.sigilId`, and adding a column to it is a drizzle rebuild, which
     * on D1 is the cascade wipe documented in `apps/lore/CLAUDE.md`. This table
     * is new, so both its foreign keys are free.
     *
     * ⚠️ `.optional()` goes INSIDE `db.ref(...)`. Outside it, no foreign key is
     * generated at all, silently, and the migration snapshot check cannot catch
     * it.
     */
    sigilId: db.ref(z.uuid().optional(), () => sigils.cols.id, {
      onDelete: "set null",
    }),
    /**
     * Where this copy deploys to, when an estate has been chosen.
     *
     * `set null` for the reason `estates`' own doc gives: deleting a user
     * account cascades to their estates, and that cascade must not be blockable
     * by other people's projects. `restrict` would fail the account deletion at
     * the database and `cascade` would delete deploy targets.
     *
     * ⚠️ Validated against the LENDING (`estate_projects`), never against
     * `estates` directly - `AppService.setEstate` is the one write path and
     * carries the check. Referencing `estates` straight lets a project point at
     * an estate it was never given, which is folio #96's `targetId` hole
     * wearing a foreign key. And the estate is never named by the client at
     * deploy time: it resolves server-side from this row.
     */
    estateId: db.ref(z.uuid().optional(), () => estates.cols.id, {
      onDelete: "set null",
    }),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
  }),
  indexes: [
    // The pair IS the row: one `production` copy of `club` per project.
    { columns: ["projectId", "app", "env"], unique: true },
    // The list, and the `GROUP BY app` behind the create dialog's combobox.
    { columns: ["projectId"] },
    // The sigil's instance, read by ingest-adjacent surfaces and by delete.
    { columns: ["sigilId"] },
    // `EstateService.assertUnreferenced` counts through this one.
    { columns: ["estateId"] },
  ],
});

export type AppInstance = Infer<typeof appInstances.schema>;
export type AppInstanceInsert = Infer<typeof appInstances.insertSchema>;
