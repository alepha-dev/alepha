import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * An invitation to join something, addressed to an EMAIL rather than to a
 * user id.
 *
 * That is the whole reason the table exists: the person being invited may
 * have no account yet, and an invitation keyed on a user row would have to
 * invent one for every address nobody ever accepts. Keying on the address
 * also means the same row serves both cases, and the status machine
 * (`pending` to `accepted` / `declined` / `expired` / `revoked`) is the same
 * either way.
 *
 * `resourceType` / `resourceId` are deliberately untyped strings: this module
 * knows nothing about what is being joined. What each type MEANS is supplied
 * by the application through `$invitationResource`.
 */
export const invitations = $entity({
  name: "invitations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Tenant scope, nullable, following the `parameters` precedent exactly.
     *
     * A single-tenant app never resolves a tenant, so it keeps writing NULL
     * rows with the historic global semantics and reads them all back
     * unfiltered. A pooled multi-tenant worker gets real isolation for free:
     * the Repository stamps the active tenant on write and filters by it on
     * read, so one org's pending invitations can never be listed, revoked or
     * accepted from another.
     *
     * Not `strict`, again like `parameters`: whether a deployment is
     * multi-tenant is a fact about the application, not about this table, and
     * `tenancyAtom` is where that fact lives.
     */
    organizationId: db.organization(),

    /**
     * Who sent it.
     *
     * A bare uuid and not `db.ref(() => users.cols.id)`, matching every other
     * framework module that records a user (`api/keys`, `api/audits`): a
     * foreign key here would make this module unusable in an app that does
     * not register `alepha/api/users`, and would make its migration depend on
     * another module's table existing first.
     *
     * The consequence is that deleting a user does not cascade their sent
     * invitations away. `purgeResolved` sweeps the resolved ones, and an
     * application that lets an inviter delete their account while
     * invitations are outstanding should sweep those itself.
     */
    invitedBy: z.uuid(),

    /**
     * The invited address, lowercased by `InvitationService.create`. Every
     * comparison against it is done on a lowercased value.
     */
    email: z.string().meta({ format: "email" }),

    /**
     * What kind of thing is being joined, e.g. `"project"`. Matched against
     * the `type` of a registered `$invitationResource`.
     */
    resourceType: z.text({ minLength: 1, maxLength: 100 }),

    /**
     * Which one, as a string. Numeric ids are stringified by the caller;
     * this module never parses it.
     */
    resourceId: z.text({ minLength: 1, maxLength: 255 }),

    status: z.enum(["pending", "accepted", "declined", "expired", "revoked"]),

    /**
     * What the invitee is granted on accept, for an application whose
     * resources have more than one kind of principal. Passed through
     * untouched and handed to the resolver's `grant`.
     */
    roles: z.array(z.text()).optional(),

    /**
     * Application-defined payload, carried to `grant` unread.
     */
    metadata: z.record(z.text(), z.any()).optional(),

    expiresAt: z.datetime(),
    resolvedAt: z.datetime().optional(),
    resolvedBy: z.uuid().optional(),
  }),
  indexes: [
    { columns: ["email", "status"] },
    { columns: ["resourceType", "resourceId", "email", "status"] },
    { columns: ["invitedBy"] },
    { columns: ["expiresAt"] },
  ],
});

export type InvitationEntity = Infer<typeof invitations.schema>;
