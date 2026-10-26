/**
 * The page context a turn carries, as a delimited block on the user's
 * message: what the person is looking at (route, page, data) travels with
 * what they typed.
 *
 * On the user side of the conversation and never in the system prompt,
 * because it changes every turn (folded into the system prompt it would void
 * the vendor's prompt cache) and because it is client-sent data, which the
 * model must read as the user's, not as the operator's instructions.
 *
 * The block is capped at {@link maxBytes} of UTF-8 and truncated with a
 * marker past it, so a page cannot fill the context window.
 *
 * @example
 * ```ts
 * const content = block.append("Why is this invoice late?", {
 *   route: "/invoices/7",
 *   page: "invoice",
 *   data: { id: 7, dueAt: "2026-10-01" },
 * });
 * block.strip(content); // "Why is this invoice late?"
 * ```
 */
export class AiContextBlock {
  /**
   * The cap on the serialized context, in bytes.
   */
  public maxBytes = 8 * 1024;

  public readonly open = "<page-context>";
  public readonly close = "</page-context>";
  public readonly marker = "...[truncated]";

  /**
   * `content` with the context block appended, or unchanged when there is no
   * context.
   */
  public append(content: string, context?: AiPageContext): string {
    if (!context || Object.keys(context).length === 0) {
      return content;
    }
    return `${content}\n\n${this.open}\n${this.serialize(context)}\n${this.close}`;
  }

  /**
   * `content` without its context block, for display.
   */
  public strip(content: string): string {
    const at = content.lastIndexOf(`\n\n${this.open}\n`);
    if (at === -1 || !content.trimEnd().endsWith(this.close)) {
      return content;
    }
    return content.slice(0, at);
  }

  /**
   * The context as JSON, cut at {@link maxBytes} on a character boundary.
   */
  public serialize(context: AiPageContext): string {
    const json = JSON.stringify(context);
    const bytes = new TextEncoder().encode(json);
    if (bytes.length <= this.maxBytes) {
      return json;
    }
    const room = this.maxBytes - new TextEncoder().encode(this.marker).length;
    // `fatal: false` drops a character cut in half rather than throwing.
    const cut = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes.slice(0, room))
      .replace(/�+$/, "");
    return `${cut}${this.marker}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * What a page declares about itself for the assistant.
 */
export interface AiPageContext {
  /**
   * The current route, a path such as `/invoices/7`.
   */
  route?: string;
  /**
   * A short name for the page, such as `invoice`.
   */
  page?: string;
  /**
   * What the page shows, as JSON.
   */
  data?: unknown;
}
