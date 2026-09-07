import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One message sitting in somebody's inbox.
 *
 * Distinct from `notification_deliveries` on purpose, and the two are not
 * interchangeable: a receipt is an audit record of one channel attempt, on a
 * 90-day clock, written whether or not anybody will ever look at it. A row
 * here is a message a person can read, click and dismiss, and its lifetime
 * is the product's, not the operator's.
 *
 * ## `userId` is a bare uuid with no foreign key
 *
 * The same reason `notification_deliveries.organizationId` is: the writer
 * runs inside a tenant-less job, and this module deliberately imports
 * nothing from `alepha/api/users`, so there is no table here to point at.
 * The cost is orphan rows when an account is deleted, paid by the retention
 * sweep plus whatever hook the app already runs on deletion.
 *
 * ## `scope` and `scopeLabel` are opaque, and stay that way
 *
 * `scope` is an app-owned string (`project:65`). The framework stores it and
 * filters on **equality**; it never parses it and nothing here may branch on
 * its value. That is what lets one project-agnostic table serve a
 * project-filtered URL, and it is the same discipline `app_instances.env`
 * keeps.
 *
 * `scopeLabel` exists because opacity has a cost: nothing in the chain can
 * turn `project:65` into "Alepha". The framework cannot, and a shared
 * component cannot either - the inbox is cross-project, so even an app-side
 * resolver would be asked about projects the current page knows nothing
 * about. So the pusher writes the readable string too, and the framework
 * stores a second string it never parses. Frozen at send time, which is
 * correct: a message is the record of a moment, so a renamed project keeps
 * the name it had when it pinged you.
 */
export const notificationInboxEntity = $entity({
  name: "notification_inbox",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Whose inbox this is, resolved from the contact at send time by
     * `NotificationInboxRecipientProvider`.
     */
    userId: z.uuid(),

    /**
     * The app-owned partition this message belongs to, or null for one that
     * belongs to no particular place. Opaque: stored, compared for equality,
     * never parsed.
     */
    scope: z.text({ maxLength: 64 }).nullable().optional(),

    /**
     * What to call {@link scope} on screen. Opaque in exactly the same way,
     * and null when the pusher had nothing readable to offer.
     */
    scopeLabel: z.text({ maxLength: 100 }).nullable().optional(),

    /**
     * The `$notification` template's name, so a preference page can talk
     * about kinds of message rather than about individual rows.
     */
    template: z.text({ maxLength: 100 }),

    /**
     * The template's category, when it declares one.
     */
    category: z.text({ maxLength: 100 }).nullable().optional(),

    title: z.text({ maxLength: 500 }),
    body: z.text().nullable().optional(),

    /**
     * Where clicking this message goes. Required by the option block, not
     * merely by this column: a message that cannot be clicked makes the
     * reader hunt for what it is about.
     */
    href: z.text({ maxLength: 2000 }),

    /**
     * When the owner read it, or null while it is unread. A timestamp rather
     * than a boolean, because "when" is free here and answers questions a
     * boolean cannot.
     */
    readAt: z.datetime().nullable().optional(),

    /**
     * Owning tenant, from the payload, for the same reason the delivery and
     * suppression tables carry one: the writer runs inside a tenant-less job
     * and an auto-scoped column would read nothing.
     */
    organizationId: z.uuid().nullable().optional(),
  }),
  indexes: [
    // The unread count and the unread list, which is every page load.
    { columns: ["userId", "readAt", "createdAt"] },
    // One scope's messages, which is the project-filtered view.
    { columns: ["userId", "scope", "createdAt"] },
  ],
});

export type NotificationInboxEntity = Infer<
  typeof notificationInboxEntity.schema
>;
