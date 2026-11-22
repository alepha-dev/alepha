import { $storage } from "alepha/api/files";

/**
 * Where a chat message's files live (#E161, #Q3939). Any type, as quest
 * attachments: a file is served with `Content-Disposition: attachment`, so
 * an HTML file is downloaded, never rendered on Lore's origin.
 */
export class ChatBuckets {
  public static readonly ATTACHMENT_BUCKET = "chat-attachments";
  /**
   * One file's cap, in megabytes: the bucket's and the upload route's, which
   * must agree or the framework's 5 MB multipart default wins.
   */
  public static readonly MAX_SIZE_MB = 10;

  attachments = $storage({
    name: ChatBuckets.ATTACHMENT_BUCKET,
    description: "Chat message attachments",
    maxSize: ChatBuckets.MAX_SIZE_MB,
  });
}
