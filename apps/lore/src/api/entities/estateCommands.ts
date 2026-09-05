import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { estateCommandPayloadSchema } from "../schemas/estateCommandPayloadSchema.ts";
import { estates } from "./estates.ts";

/**
 * The closed action vocabulary, in full.
 *
 * ⚠️ Every action is a named variant with typed fields, and nothing takes a
 * free-form path, shell command or argument list. That is the security
 * boundary of the whole connector (folio #64's objection, answered by folio
 * #1152): the capability ceiling is this set, not the channel. `deploy` is
 * already code execution as the app user, so the set bounds the blast radius
 * without making it small, and it is not a list to extend casually.
 */
export const ESTATE_COMMAND_KINDS = ["restart", "deploy"] as const;

export type EstateCommandKind = (typeof ESTATE_COMMAND_KINDS)[number];

/**
 * `pending` (queued, the machine was offline or the push failed), `sent`
 * (pushed over the open connection), `running` (the machine acknowledged
 * pickup), then `done` or `failed`.
 */
export const ESTATE_COMMAND_STATUSES = [
  "pending",
  "sent",
  "running",
  "done",
  "failed",
] as const;

export type EstateCommandStatus = (typeof ESTATE_COMMAND_STATUSES)[number];

/**
 * One command queued for one estate: what Lore asked a machine to do, and
 * what became of it.
 *
 * ## The id is the contract
 *
 * A machine can acknowledge and have the ack lost, or be disconnected when a
 * command is queued. Either way it sees the same command again, through the
 * reconciliation on its next connect, under the SAME id. The connector is
 * idempotent by id (#1621), so this row is never re-minted for a redelivery,
 * and an ack for an id already terminal is ignored rather than refused.
 *
 * ## A stuck command must be visible
 *
 * The interesting failure is not a rejected command, it is a machine that
 * took work and never came back. `timeoutSeconds` is stamped at enqueue from
 * the kind, so the sweep (`EstateCommandJobs`) reads no vocabulary: `sent`
 * with no ack for `EstateCommandService.ACK_TIMEOUT_SECONDS` fails as never
 * acknowledged, `running` past its own timeout fails as timed out, and
 * `pending` older than a day fails because the machine never came to fetch
 * it. All three are visible on the estate page with their reason.
 *
 * ## Cascade
 *
 * Hangs off `estates` with `onDelete: "cascade"`: a deleted estate takes its
 * history with it. New columns added later are optional with no
 * `db.default`, so the migration stays a plain `ALTER TABLE ADD COLUMN` (see
 * "Migration safety on D1" in `apps/lore/CLAUDE.md`).
 */
export const estateCommands = $entity({
  name: "estate_commands",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    estateId: db.ref(z.uuid(), () => estates.cols.id, {
      onDelete: "cascade",
    }),
    kind: z.enum(ESTATE_COMMAND_KINDS).meta({ mode: "text" }),
    status: db.default(
      z.enum(ESTATE_COMMAND_STATUSES).meta({ mode: "text" }),
      "pending",
    ),
    payload: estateCommandPayloadSchema,
    /**
     * Who asked. Set null on deletion: the command outlives the person, and
     * the estate is what it belongs to.
     */
    requestedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * How long the machine may spend in `running` before the sweep calls it
     * timed out. Per kind, stamped at enqueue.
     */
    timeoutSeconds: z.integer().min(1),
    sentAt: z.string().optional(),
    runningAt: z.string().optional(),
    finishedAt: z.string().optional(),
    /**
     * The last progress step a `running` ack carried, `downloading`,
     * `verifying` or `deploying` for a deploy.
     */
    step: z.string().max(32).optional(),
    /**
     * Why it failed, from the machine's ack or from the sweep.
     */
    reason: z.string().max(2000).optional(),
  }),
  indexes: [
    // The reconciliation on connect and the sweep both ask "which commands
    // of this estate are in this state".
    { columns: ["estateId", "status"] },
    // The estate page, newest first, and the retention cap.
    { columns: ["estateId", "createdAt"] },
  ],
});

export type EstateCommand = Infer<typeof estateCommands.schema>;
