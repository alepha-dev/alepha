/**
 * Turns one stored file into MCP content blocks.
 *
 * Shared by `feedback_attachment_get` and `quest_attachment_get` rather
 * than copied into each: the two surfaces have to agree on what an agent
 * can see, and a second copy is how one of them quietly stops rendering a
 * type the other still accepts on upload.
 *
 * Three ways out, in order of how useful the result is: images inline
 * (the whole point, since a screenshot is something an agent can actually
 * look at), text-like payloads decoded, and anything else a metadata note
 * saying where to get the real file.
 */
export class AttachmentContentService {
  /**
   * Mime types whose bytes are UTF-8 text worth inlining. Everything image
   * is handled before this, and everything else is opaque.
   */
  protected readonly textLike = /^(text\/|application\/(json|csv))/;

  render(file: {
    name: string;
    mimeType: string;
    size: number;
    data: string;
  }): {
    content: Array<
      | { type: "image"; data: string; mimeType: string }
      | { type: "text"; text: string }
    >;
  } {
    if (file.mimeType.startsWith("image/")) {
      return {
        content: [{ type: "image", data: file.data, mimeType: file.mimeType }],
      };
    }

    if (this.textLike.test(file.mimeType)) {
      const text = Buffer.from(file.data, "base64").toString("utf8");
      return {
        content: [
          {
            type: "text",
            text: `${file.name} (${file.mimeType}, ${file.size} bytes):\n\n${text}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Attachment "${file.name}" is ${file.mimeType} (${file.size} bytes), which is not inline-viewable here. Open it in Lore if you need the raw file.`,
        },
      ],
    };
  }
}
