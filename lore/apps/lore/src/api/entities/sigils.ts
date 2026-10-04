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
     * The instance's own `app_instances.url` wins wherever it is set.
     *
     * Nullable: `sigils` is the CASCADE parent of its analytics tables, and a
     * nullable `ADD COLUMN` is the one shape that does not make drizzle
     * rebuild it.
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
     * as {@link lastSeenHost}.
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
