import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * The kinds of deploy destination a host can be.
 *
 * `bay`: a VPS running `bay serve`, which dials Lore over a websocket with a
 * secret Lore minted. `cloudflare`: an account reached over the REST API with
 * a token its owner pasted (epic #22). The discriminator exists now so the
 * second arrives without a data migration.
 */
export const HOST_TYPES = ["bay", "cloudflare"] as const;

export type HostType = (typeof HOST_TYPES)[number];

/**
 * An **host** is a deploy destination that belongs to a project, its home,
 * and is lent to the projects that may deploy onto it (epic #E126).
 *
 * ## This concept changed meaning three times and spelling once
 *
 * The migration history holds `outposts`, `outpost_apps` and `outpost_events`,
 * created on 2026-08-02 and dropped on 2026-08-06 (folios #64 and #65). Those
 * were an agent on a VPS that Lore controlled over an INBOUND API, and folio
 * #64 killed that design because a control channel to a VPS is
 * root-equivalent. Do not read those migrations as this table's past: they
 * describe a different, deleted thing, and they are correct as they stand.
 *
 * What replaced it (folio #1152, then #1184) inverts the direction: the
 * machine dials OUT to Lore and holds a websocket open, and the capability
 * ceiling is the closed action vocabulary (`restart`, `deploy`), not the
 * channel. Folio #1154 then made outposts Lore-scope and admin-only, and
 * folio #1194 reversed that on 2026-09-04 and renamed them hosts, owned by
 * a user. Epic #E126 (folio #F1468) moved them from the user to a project on
 * 2026-11-11: who acts on a host is a matter of rank in its home project.
 *
 * Folio #64 warned that `SigilIngestController` and its sibling were "one
 * grep apart and will be confused otherwise". The same holds here: a sigil
 * is an app's telemetry credential, a host is a machine's deploy
 * credential, and neither is the other.
 *
 * ## Home and loan are two facts
 *
 * `projectId` is the home: the project whose members manage the host, each
 * by their rank. The lending join (`host_projects`, #1837) is which projects
 * may deploy through it. The home usually holds a loan too, and need not. A
 * deploy never names the host on the wire: it resolves server-side from an
 * app instance, which resolves from a project (folio #96's `targetId`
 * warning).
 *
 * A host with no home (`projectId` NULL) is one the migration of #Q3278
 * could not place safely, or one an older Worker created inside the
 * migrate-before-deploy window. Nobody but the instance admin reaches it, and
 * the admin assigns it a home.
 *
 * ## `ownerUserId` is an anchor, not an owner
 *
 * It cannot go: it is a NOT NULL cascade foreign key, and dropping or
 * relaxing it is a table rebuild, refused on a table with nine children
 * (`migration-safety.spec.ts`). So it stays as the user whose deletion would
 * cascade to the row, and it is never read for access. A homed host's
 * anchor is its home project's owner, who cannot delete their account while
 * they own a live project; `HostAnchorHooks` repoints it on an ownership
 * transfer and before a user is deleted. A host with no home keeps the
 * anchor of whoever created it, and still goes with that account.
 *
 * ## The rows that reference this table
 *
 * `app_instances.hostId` (#1767) is `.optional()` INSIDE
 * `db.ref(...)` with `onDelete: "set null"`: a host that goes, with its
 * anchor's account or by a delete, must not be blockable by the projects that
 * borrowed it, and must not delete their deploy targets.
 *
 * `deployments` (epic #1, #1201) carries a denormalised `(hostSlug,
 * hostType)` snapshot beside a soft `hostId`, so history outlives the row.
 */
export const hosts = $entity({
  name: "hosts",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * The cascade anchor, never read for access: see the entity's doc.
     */
    ownerUserId: db.ref(z.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The home project, whose members manage the host by their rank. Null
     * for a host the admin has yet to assign. `restrict`, and never
     * reached in practice: projects are soft-deleted, and a guard refuses to
     * delete a project that is the home of a host.
     */
    projectId: db.ref(z.integer().optional(), () => projects.cols.id, {
      onDelete: "restrict",
    }),
    /**
     * Who added or provisioned the host, for display only: a provisioned
     * server lives in that person's cloud account.
     */
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    type: z.enum(HOST_TYPES).meta({ mode: "text" }),
    /**
     * The identifier a person types and `bay connector show` prints. Unique
     * per home project and never writable after creation, because a config
     * may record it. Two projects may both have `ovh-1`.
     */
    slug: z.string().min(1).max(64),
    /**
     * Free text for renames. The slug does not move; this does.
     */
    label: z.string().max(100).optional(),
    /**
     * `bay` only, and null on every `cloudflare` row. The secret Lore
     * minted, stored as a hash for the reason a password is: a database that
     * leaks must not be a fleet that leaks. Nothing ever returns it;
     * rotation is the only way to a new one.
     *
     * A cloudflare host has nothing to put here: its credential is one its
     * owner pasted, it has to be replayed against Cloudflare, and so it is
     * sealed in {@link credential} rather than hashed. The unique index
     * tolerates that because SQLite and Postgres both treat NULLs as
     * distinct in a unique index, so any number of cloudflare rows coexist
     * while two `bay` rows still cannot share a secret.
     */
    secretHash: z.string().max(256).optional(),
    /**
     * The first characters of whichever credential the type holds, so the UI
     * can name a credential it can never rebuild: the minted secret for
     * `bay`, the pasted token for `cloudflare` (#1629). Both are the kind's
     * marker plus eight characters.
     */
    secretPrefix: z.string().max(32).optional(),
    /**
     * `cloudflare` only. The API token its owner pasted, sealed by
     * `CredentialSealService` under `lore:estates:v1` (#1631).
     *
     * `z.string().max(1024)` and never `z.text()`: `z.text()` caps at 255,
     * and a sealed 60-character token is already about 200 hex characters,
     * so the shorter column would refuse the write. Never written by a
     * client: the only writer is the create-and-check path.
     */
    credential: z.string().max(1024).optional(),
    /**
     * Which key derivation sealed {@link credential}, so re-sealing after an
     * `APP_SECRET` rotation is a script rather than a crisis. See
     * `CredentialSealService.KEY_VERSION`.
     */
    credentialKeyVersion: z.integer().optional(),
    /**
     * `cloudflare` only. The Cloudflare account the token is checked
     * against, so no probe has to guess one and none ever reads Lore's own
     * `CLOUDFLARE_ACCOUNT_ID`.
     *
     * Loose here and strict on the way in (32 hex characters, #1629), for
     * the reason `hostSlugSchema` gives: a constraint tightened on a
     * column makes a pre-existing row fail to decode, and a row that fails
     * its schema throws every query that touches the table.
     */
    accountId: z.string().max(64).optional(),
    /**
     * When the token was last proven against Cloudflare, ISO, server-written
     * (#1630). Never null on a cloudflare row: the checks run before the row
     * is written, so a host that exists has passed at least once.
     */
    credentialCheckedAt: z.string().optional(),
    /**
     * Why the last check failed, naming the permission group in Cloudflare's
     * own words; null when it passed (#1630). Server-written. It is what the
     * derived `credentialStatus` reads, together with
     * {@link credentialExpiresAt}.
     */
    credentialError: z.string().max(1024).optional(),
    /**
     * When Cloudflare says the token expires, ISO, from the verify endpoint
     * (#1630). Applied at READ time, so a token that expires at noon reads
     * invalid at noon rather than at the next midnight sweep.
     */
    credentialExpiresAt: z.string().optional(),
    /**
     * Whether CPU and memory pushes are also written to the `$analytics`
     * series. Gates the series only: the live gauge on this row is always
     * kept, because the host list reads it (#1627).
     */
    collectSeries: db.default(z.boolean(), false),
    /**
     * Whether a `deploy` command may be enqueued for this host. Off by
     * default, so a freshly enrolled machine is stats-only until its owner
     * says otherwise: #1626 refuses at enqueue, and the connector refuses
     * too, from the `welcome` frame.
     */
    deployAllowed: db.default(z.boolean(), false),
    /**
     * How often the connector pushes its gauge, in seconds. Reaches the
     * machine in the `welcome` frame (#1782). A UX choice, not a cost one.
     */
    statsIntervalSeconds: db.default(z.integer().min(60).max(86_400), 1800),
    /**
     * Liveness, as two stamps. The HTTP list runs in the Worker and cannot
     * see sockets that live in a Durable Object, so the endpoint stamps the
     * row instead (#1782). `online` is `connectedAt > disconnectedAt` and
     * `lastSeenAt` within twice the interval; the second clause guards a
     * lost close event. See `HostService.isOnline`.
     */
    connectedAt: z.string().optional(),
    disconnectedAt: z.string().optional(),
    /**
     * The socket that last connected. A close event names its socket, and
     * one for an OLDER socket can arrive after a reconnect; without this the
     * new connection would be marked offline by the old one's goodbye.
     */
    connectionId: z.string().max(64).optional(),
    /**
     * Last frame received, on connect or on a stats push.
     */
    lastSeenAt: z.string().optional(),
    /**
     * The address the machine connected FROM, as Lore saw it at the
     * handshake (`cf-connecting-ip` on Cloudflare, else the first
     * `x-forwarded-for` hop) (#Q3137). What a test hostname derives from, so
     * a server bought for an hour can serve HTTPS with no DNS to set up. Seen
     * by Lore rather than reported by the machine, which behind a 1:1 NAT
     * knows only its private address. Absent for a machine that never
     * connected, or behind nothing Lore can read.
     */
    publicIp: z.string().max(45).optional(),
    /**
     * When a throwaway host was meant to be gone (#Q3138), set from a TTL
     * (`lore host add --ttl 2h`). Past it the host reads `overdue` and
     * its owner is told once; Lore deletes nothing and stops nothing.
     */
    expiresAt: z.string().optional(),
    /**
     * When the owner was told the host is overdue: the one notification's
     * claim, set by the same UPDATE that selects it, cleared when the TTL
     * moves.
     */
    notifiedOverdueAt: z.string().optional(),
    /**
     * The hash of a one-time enrolment secret (`enr_`, #Q3165), the one a
     * provisioned server's cloud-init carries. User data is readable through
     * the metadata service, so what sits there must be worthless once used:
     * `bay connector set` exchanges it for the long-lived secret over
     * `POST /estates/enrol`, and the first handshake made with that secret
     * clears this column. Never accepted by the handshake itself.
     */
    enrolmentHash: z.string().max(256).optional(),
    /**
     * When the enrolment secret stops being accepted, ISO.
     */
    enrolmentExpiresAt: z.string().optional(),
    /**
     * The provider a `lore host provision` bought the server from
     * (`scaleway`, #Q3166), absent for a machine enrolled by hand. Lore
     * holds no key for it: the CLI terminates the server through the
     * provider's own CLI, so these columns are what it needs to name the
     * server, and what the host page shows (#Q3168).
     */
    provider: z.string().max(32).optional(),
    providerServerId: z.string().max(128).optional(),
    providerServerType: z.string().max(64).optional(),
    providerZone: z.string().max(64).optional(),
    /**
     * The server type's hourly price in euros, read from the provider's
     * catalogue once at provision and stored, never refetched.
     */
    hourlyPrice: z.number().min(0).optional(),
    provisionedAt: z.string().optional(),
    /**
     * The live gauge, upserted on every stats push. A point value, never a
     * series: "CPU is 34% right now" is this row, "CPU over 30 days" is
     * `$analytics` (#1627).
     */
    cpuPercent: z.number().min(0).max(100).optional(),
    memoryPercent: z.number().min(0).max(100).optional(),
    statsAt: z.string().optional(),
  }),
  indexes: [
    { columns: ["projectId", "slug"], unique: true },
    // The handshake resolves a secret by its hash and by nothing else.
    { columns: ["secretHash"], unique: true },
    // The enrolment exchange resolves its secret the same way.
    { columns: ["enrolmentHash"], unique: true },
  ],
});

export type Host = Infer<typeof hosts.schema>;
export type HostInsert = Infer<typeof hosts.insertSchema>;
