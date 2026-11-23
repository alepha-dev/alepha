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

  public static readonly AGENT_AVATAR_BUCKET = "chat-agent-avatars";

  /**
   * A chat agent's picture (#E170), as core's project icons: image only,
   * 2 MB, uploaded from the browser by the agent form.
   */
  agentAvatars = $storage({
    name: ChatBuckets.AGENT_AVATAR_BUCKET,
    description: "Chat agent avatars",
    clientUploads: true,
    maxSize: 2,
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });
}
