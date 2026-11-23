import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { hostCommandPayloadSchema } from "../schemas/hostCommandPayloadSchema.ts";
import {
  HOST_COMMAND_KINDS,
  HOST_COMMAND_STATUSES,
} from "../schemas/hostCommandValues.ts";
import { hosts } from "./hosts.ts";

/**
 * One command queued for one host: what Lore asked a machine to do, and
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
 * the kind, so the sweep (`HostCommandJobs`) reads no vocabulary: `sent`
 * with no ack for `HostCommandService.ACK_TIMEOUT_SECONDS` fails as never
 * acknowledged, `running` past its own timeout fails as timed out, and
 * `pending` older than a day fails because the machine never came to fetch
 * it. All three are visible on the host page with their reason.
 *
 * ## Cascade
 *
 * Hangs off `hosts` with `onDelete: "cascade"`: a deleted host takes its
 * history with it. New columns added later are optional with no
 * `db.default`, so the migration stays a plain `ALTER TABLE ADD COLUMN` (see
 * "Migration safety on D1" in `apps/lore/AGENTS.md`).
 */
export const hostCommands = $entity({
  name: "host_commands",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    hostId: db.ref(z.uuid(), () => hosts.cols.id, {
      onDelete: "cascade",
    }),
    kind: z.enum(HOST_COMMAND_KINDS).meta({ mode: "text" }),
    status: db.default(
      z.enum(HOST_COMMAND_STATUSES).meta({ mode: "text" }),
      "pending",
    ),
    payload: hostCommandPayloadSchema,
    /**
     * Who asked. Set null on deletion: the command outlives the person, and
     * the host is what it belongs to.
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
    /**
     * The blob a `logs` command's answer was uploaded as.
     *
     * ⚠️ A LOGICAL reference, exactly like `artifacts.fileId`, and for the
     * reason that entity gives: a physical `db.ref` onto `files` is a table
     * rebuild on SQLite, which on D1 is the cascade wipe documented in
     * `apps/lore/AGENTS.md`. Nothing here cascades, and the file is swept by
     * the framework's own `FileJobs` when its 24 h expiry passes - which is
     * why `HostCommandJobs` needs to know nothing about it and a host
     * deletion needs no blob hook.
     *
     * A row still pointing at a swept file is the normal end state, and the
     * owner's read answers "expired" for it rather than 500ing.
     */
    resultFileId: z.uuid().optional(),
  }),
  indexes: [
    // The reconciliation on connect and the sweep both ask "which commands
    // of this host are in this state".
    { columns: ["hostId", "status"] },
    // The host page, newest first, and the retention cap.
    { columns: ["hostId", "createdAt"] },
  ],
});

export type HostCommand = Infer<typeof hostCommands.schema>;
