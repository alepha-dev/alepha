import { type Infer, z } from "alepha";

/**
 * One message as the owner's own client sees it.
 *
 * Deliberately narrower than the row: `organizationId` and `userId` are the
 * server's business, and every message in a response already belongs to the
 * caller, so repeating who they are on each row buys nothing.
 *
 * ⚠️ `title` and `body` are **plain text**, rendered once at send time and
 * frozen in the language they were written in. A reader who later switches
 * language sees the message as it was sent; the alternative is storing the
 * template name plus its variables and rendering on read, which contradicts
 * the channel contract's `render()`.
 */
export const notificationInboxResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  /**
   * The app-owned partition, e.g. `project:65`. Opaque: compare it for
   * equality, never parse it.
   */
  scope: z.text().optional(),
  /**
   * What to show for {@link scope}, e.g. `Alepha`. Frozen at send time.
   */
  scopeLabel: z.text().optional(),
  /**
   * The `$notification` template's name, so a client can group by kind.
   */
  template: z.text().optional(),
  category: z.text().optional(),
  title: z.text(),
  body: z.text().optional(),
  href: z.text(),
  /**
   * When the owner read it. Absent while unread, which is what the bell
   * counts.
   */
  readAt: z.datetime().optional(),
});

export type NotificationInboxResource = Infer<
  typeof notificationInboxResourceSchema
>;
