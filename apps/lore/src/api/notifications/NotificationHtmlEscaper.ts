/**
 * Escape user-controlled strings before they land inside an HTML email body.
 *
 * Mail clients block JavaScript, but an unescaped quest title, project name
 * or estate slug can still inject anchors, images and styling - turning a
 * DKIM-signed message into a high-trust phishing surface. Every notification
 * body in Lore that interpolates a value somebody typed goes through here.
 *
 * ⚠️ **A class rather than an exported function**, so it stays substitutable
 * through DI like everything else in an api service file. It was four
 * identical `protected escapeHtml` copies before this existed, one per
 * notification class, which is how five replacements become four slightly
 * different sets of five.
 */
export class NotificationHtmlEscaper {
  public escape(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
