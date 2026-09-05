import { SIGIL_FEEDBACK_POSITIONS } from "@alepha/lore/sigil";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * The capabilities a sigil may grant.
 */
export const SIGIL_KINDS = ["feedback", "blights", "beacon", "vitals"] as const;

export type SigilKind = (typeof SIGIL_KINDS)[number];

/**
 * A **sigil** is the credential one deployed copy of an app reports with —
 * nothing more than a token and the instance it belongs to.
 *
 * ⚠️ **Since Apps v3 (#1767) a sigil is an unlock, not an identity.** The
 * identity is the `app_instances` row, which exists first and points here
 * through `sigilId`; minting a sigil is what turns Analytics, Vitals, Errors
 * and Explore on for that instance. {@link name} is a server-written mirror of
 * the pair, kept as a column because five surfaces read it as a label.
 *
 * Before v3 it was the other way round: a sigil WAS the app, its name was free
 * text, and the environment was jammed into that name by convention
 * (`docs-production`, `lore`). Anything you read describing enrolment as the
 * way an app comes into existence predates this.
 *
 * The credential is a `sg_`-prefixed token shown once at creation and stored
 * as a hash. `tokenPrefix` exists so the UI can name a key it cannot
 * reconstruct.
 */
export const sigils = $entity({
  name: "sigils",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The instance this credential belongs to, as `"<app>/<env>"`.
     *
     * ⚠️ **A server-written mirror of `app_instances`, never an input** (#1767).
     * `AppService` writes it on sigil creation and on every rename of either
     * half, and nothing else does: `updateSigil` lost its `name` field when this
     * landed, because a second writer would let the mirror drift from the
     * instance it names.
     *
     * It stays a column rather than a join because it is read as a display
     * label in five places - `BlightController.listBlights`,
     * `InsightsController.labels`, `DashboardMetricRegistry.scopeNames`,
     * `LoreAudits` descriptions and MCP `sigil_list` - and all five keep
     * working with zero joins. `/` is outside `APP_NAME_PATTERN`, so a mirror
     * can never collide with a pre-v3 name, and `(app, env)` is unique, so it
     * satisfies the `(projectId, name)` index for free.
     *
     * ⚠️ `max(100)` here and validated on READ. `AppService.assertPairFits`
     * refuses a pair over 99 characters on the way in, because a row that fails
     * its column's schema does not read as `undefined` - it throws every query
     * that touches the table.
     *
     * Rows created before v3 hold a bare name (`docs-production`); the backfill
     * rewrote them to `docs-production/production`, parsing no suffixes.
     */
    name: z.string().min(1).max(100),
    tokenHash: z.string().min(1).max(256),
    /**
     * First characters of the token, so the UI can name it.
     */
    tokenPrefix: z.string().min(1).max(32),
    /**
     * Capability buckets this sigil's ingest endpoint accepts.
     */
    kinds: db.default(z.array(z.string().max(50)).max(10), []),
    /**
     * @deprecated Frozen dead column — nothing reads or writes it.
     *
     * It held the corner this app's feedback button sits in, and shipped to
     * third-party pages through `/sigils/config`, which the reporting client
     * polled. That round trip was removed: a fetched config survives neither a
     * serverless isolate nor a prerender, so an app now declares the placement
     * in its own `SIGIL_CONFIG.feedbackButton`. The Lore-side setting outlived
     * the mechanism that delivered it and could not take effect at all.
     *
     * The column stays rather than being dropped, for the same reason
     * `projects.unlockedFeatures` and `quests.note` stay: `sigils` is the
     * CASCADE parent of the four analytics tables, and a `DROP COLUMN` that
     * drizzle turns into a table rebuild is the wipe bomb documented in
     * CLAUDE.md. It is also why the column is nullable with no `db.default` —
     * a nullable `ADD COLUMN` was the one shape that avoided a rebuild going
     * in, and staying put is the one shape that avoids one coming out.
     */
    feedbackPosition: z.enum(SIGIL_FEEDBACK_POSITIONS).optional(),
    /**
     * @deprecated Frozen dead column — nothing WRITES it since #1767.
     *
     * The address moved to `app_instances.url`, which is where it belongs: it
     * describes the deployed copy rather than the credential, and an instance
     * has one whether or not it ever mints a sigil. The backfill copied every
     * value across, `updateSigil` lost the field, and `AppService.setUrl` is the
     * write path now. The last readers are the pre-v3 app page's own, and they
     * move onto the instance resource with #1774.
     *
     * The column stays rather than being dropped, for the reason
     * {@link feedbackPosition} does: `sigils` is the CASCADE parent of the four
     * analytics tables, and a `DROP COLUMN` drizzle turns into a table rebuild
     * is the wipe bomb documented in `apps/lore/CLAUDE.md`.
     *
     * What it was, for a reader of an older migration:
     *
     * The override half of the answer, and the reason there are two columns
     * rather than one: {@link lastSeenHost} is the address the app reports
     * from, which is right almost always and cannot be right for everyone. An
     * app served on an apex and a `www` has two, and whichever reported last
     * would win; an app that only ever uses the Feedback capability never
     * posts to the ingest at all and so reports none. Neither is a bug to fix
     * in the detection - they are cases where only the operator knows the
     * canonical answer.
     *
     * A full URL, not a host, because this one is typed: someone pinning an
     * address may well want a path on it, and refusing that would be refusing
     * the only thing the manual field is for.
     *
     * Optional, and deliberately without a `db.default` - the same shape
     * {@link feedbackPosition} carries, for the same reason. `sigils` is the
     * CASCADE parent of the four analytics tables, and a nullable `ADD COLUMN`
     * is the one shape that does not make drizzle rebuild the table. See
     * `apps/lore/CLAUDE.md`.
     */
    url: z.string().max(2048).optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
    createdAt: db.createdAt(),
    /**
     * Last time this sigil reported anything. Drives the "silent" badge.
     */
    lastSeenAt: z.string().optional(),
    /**
     * The host the last batch was sent from, as the app's own server named it.
     *
     * Stamped beside {@link lastSeenAt} on every accepted batch, from the
     * `host` field of the envelope. It is what makes the app's address
     * something Lore knows rather than something an operator maintains: an app
     * that moves domain says so on its next report, with nothing to update
     * here.
     *
     * A host, never a URL - the `Host` header carries no scheme, and the UI
     * renders `https://` in front of it rather than pretending to know.
     * {@link url} wins wherever it is set.
     *
     * Nullable for the same table-rebuild reason as {@link url}.
     */
    lastSeenHost: z.string().max(253).optional(),
    /**
     * What the app last SAID it is configured to collect, resolved.
     *
     * A claim, never a fact and never an input. `kinds` above is what this
     * sink accepts and is the only thing `SigilIngestService.gatesFor` reads;
     * this is what the app says it sends. They are stored side by side
     * precisely so a disagreement - the app sending vitals while the sink
     * refuses them - becomes visible, which is currently invisible in both
     * directions and the failure mode that wastes the most time.
     *
     * Bounded by `sigilNormalizeReportedConfig` on arrival, because the sender
     * is whoever holds this token and the value is rendered on a page.
     *
     * ⚠️ Every field of the stored shape is optional, deliberately. This is a
     * JSON column, and a REQUIRED key renamed inside one takes production down
     * on every read of the table - `projects.features` did exactly that on
     * 2026-08-05, because a missing required key fails the whole row rather
     * than reading as undefined. Nothing here may become required.
     *
     * Optional, and without a `db.default`, for the same table-rebuild reason
     * as {@link url} and {@link lastSeenHost}: `sigils` is the CASCADE parent
     * of the four analytics tables, and a nullable `ADD COLUMN` is the one
     * shape that does not make drizzle rebuild it.
     */
    reportedConfig: z
      .object({
        trackers: z.record(z.string(), z.boolean()).optional(),
        feedback: z.boolean().optional(),
        feedbackButton: z.string().optional(),
        feedbackButtonExcludedPaths: z.array(z.string()).optional(),
        reportOutsideProduction: z.boolean().optional(),
      })
      .optional(),
    /**
     * When {@link reportedConfig} was last reported.
     *
     * Separate from `lastSeenAt` because they answer different questions: an
     * app reports constantly and changes its config rarely, so a config
     * reported three weeks ago by an app redeployed since is stale while the
     * app is perfectly alive. A page that showed the config under the liveness
     * timestamp would be claiming the wrong freshness.
     */
    reportedConfigAt: z.string().optional(),
  }),
  indexes: [
    { columns: ["projectId"] },
    { columns: ["tokenHash"], unique: true },
    { columns: ["projectId", "name"], unique: true },
    { columns: ["createdBy"] },
  ],
});

export type Sigil = Infer<typeof sigils.schema>;
export type SigilInsert = Infer<typeof sigils.insertSchema>;
