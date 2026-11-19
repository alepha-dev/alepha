import { $storage } from "alepha/api/files";

/**
 * Where a chat message's files live (#E161, #Q3939). Any type, as quest
 * attachments: a file is served with `Content-Disposition: attachment`, so
 * an HTML file is downloaded, never rendered on Lore's origin.
 */
export class ChatBuckets {
  public static readonly ATTACHMENT_BUCKET = "chat-attachments";

  attachments = $storage({
    name: ChatBuckets.ATTACHMENT_BUCKET,
    description: "Chat message attachments",
    maxSize: 10,
  });
}
