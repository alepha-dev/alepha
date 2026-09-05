import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * The kinds of deploy destination an estate can be.
 *
 * `bay`: a VPS running `bay serve`, which dials Lore over a websocket with a
 * secret Lore minted. `cloudflare`: an account reached over the REST API with
 * a token its owner pasted (epic #22). The discriminator exists now so the
 * second arrives without a data migration.
 */
export const ESTATE_TYPES = ["bay", "cloudflare"] as const;

export type EstateType = (typeof ESTATE_TYPES)[number];

/**
 * An **estate** is a deploy destination owned by a user and lent to projects.
 *
 * ## This concept changed meaning twice and spelling once
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
 * folio #1194 reversed that on 2026-09-04 and renamed them estates: owned by
 * a user, lent to projects, never an instance resource an admin registers.
 *
 * Folio #64 warned that `SigilIngestController` and its sibling were "one
 * grep apart and will be confused otherwise". The same holds here: a sigil
 * is an app's telemetry credential, an estate is a machine's deploy
 * credential, and neither is the other.
 *
 * ## Ownership is personal, usage is lent
 *
 * `ownerUserId` is the owner and there is no `projectId`: the lending join
 * (`estate_projects`, #1837) carries which projects may deploy through it.
 * A deploy never names the estate on the wire: it resolves server-side from
 * an app instance, which resolves from a project (folio #96's `targetId`
 * warning, back in force under user-scope).
 *
 * ## The rows that will reference this table
 *
 * `app_instances.estateId` (#1767) is `.optional()` INSIDE
 * `db.ref(...)` with `onDelete: "set null"`. Deleting a user account cascades
 * to their estates, and that cascade must not be blockable by other people's
 * projects: `restrict` would fail the account deletion at the database and
 * `cascade` would delete deploy targets. `set null` is the one shape that fits
 * the rules in `EstateService`.
 *
 * `deployments` (epic #1, #1201) carries a denormalised `(estateSlug,
 * estateType)` snapshot beside a soft `estateId`, so history outlives the row.
 */
export const estates = $entity({
  name: "estates",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    ownerUserId: db.ref(z.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    type: z.enum(ESTATE_TYPES).meta({ mode: "text" }),
    /**
     * The identifier a person types and `bay connector show` prints. Unique
     * per owner and never writable after creation, because a config may
     * record it. Two owners may both have `ovh-1`.
     */
    slug: z.string().min(1).max(64),
    /**
     * Free text for renames. The slug does not move; this does.
     */
    label: z.string().max(100).optional(),
    /**
     * `bay` only. The secret Lore minted, stored as a hash for the reason a
     * password is: a database that leaks must not be a fleet that leaks.
     * Nothing ever returns it; rotation is the only way to a new one.
     */
    secretHash: z.string().max(256).optional(),
    /**
     * The first characters of the secret, so the UI can name a credential
     * it can never rebuild.
     */
    secretPrefix: z.string().max(32).optional(),
    /**
     * Whether CPU and memory pushes are also written to the `$analytics`
     * series. Gates the series only: the live gauge on this row is always
     * kept, because the estate list reads it (#1627).
     */
    collectSeries: db.default(z.boolean(), false),
    /**
     * Whether a `deploy` command may be enqueued for this estate. Off by
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
     * lost close event. See `EstateService.isOnline`.
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
     * The live gauge, upserted on every stats push. A point value, never a
     * series: "CPU is 34% right now" is this row, "CPU over 30 days" is
     * `$analytics` (#1627).
     */
    cpuPercent: z.number().min(0).max(100).optional(),
    memoryPercent: z.number().min(0).max(100).optional(),
    statsAt: z.string().optional(),
  }),
  indexes: [
    { columns: ["ownerUserId", "slug"], unique: true },
    // The handshake resolves a secret by its hash and by nothing else.
    { columns: ["secretHash"], unique: true },
  ],
});

export type Estate = Infer<typeof estates.schema>;
export type EstateInsert = Infer<typeof estates.insertSchema>;
