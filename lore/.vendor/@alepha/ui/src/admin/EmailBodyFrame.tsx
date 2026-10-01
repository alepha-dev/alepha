import * as React from "react";

void React;

import { useMemo } from "react";

export interface EmailBodyFrameProps {
  /**
   * Raw email HTML. May be a full document (`<html dir="rtl">…`) or a bare
   * fragment.
   */
  html: string;
  /**
   * Direction applied only when `html` is a bare fragment. A full document
   * keeps whatever `dir` it declares for itself.
   */
  dir?: "ltr" | "rtl";
  /**
   * Inline style overrides, mainly for sizing.
   */
  style?: React.CSSProperties;
  title?: string;
}

/**
 * Render email HTML inside a sandboxed `<iframe srcDoc>`, so the email's own
 * document stays scoped to the preview.
 *
 * ⚠️ **Never swap this for `dangerouslySetInnerHTML`.** The HTML fragment
 * parser hoists a body's `<html>` / `<body>` attributes onto the real page,
 * so an email carrying `dir="rtl"` flips the entire admin UI to RTL. An
 * iframe gives it a document of its own.
 *
 * The sandbox is empty on purpose, and it does three jobs:
 *
 * - blocks scripts in a body nobody has reviewed,
 * - keeps the email's CSS out of the admin's,
 * - blocks top-level navigation, which is what makes the **live** one-click
 *   unsubscribe link the notification renderer mints inert. Clicking it in a
 *   preview would otherwise unsubscribe the recipient.
 */
export const EmailBodyFrame = (props: EmailBodyFrameProps) => {
  const dir = props.dir ?? "ltr";

  const srcDoc = useMemo(() => {
    const content = props.html ?? "";
    // Already a complete document: render it untouched rather than nesting
    // <html> inside <html>. It sets its own direction.
    if (/<html[\s>]/i.test(content)) {
      return content;
    }
    // A fragment gets a minimal document so it renders with the requested
    // direction and readable defaults, still fully isolated.
    return (
      `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8">` +
      `<base target="_blank">` +
      "<style>html,body{margin:0}body{padding:24px 28px;" +
      "font-family:-apple-system,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "font-size:14px;color:#1b2540;line-height:1.5}</style></head>" +
      `<body dir="${dir}">${content}</body></html>`
    );
  }, [props.html, dir]);

  return (
    <iframe
      title={props.title ?? "Email preview"}
      srcDoc={srcDoc}
      sandbox=""
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        // An email is authored against a white ground. Painting it with the
        // admin's surface colour would misrepresent what the recipient saw,
        // and in dark mode it would hide dark text entirely.
        background: "#fff",
        ...props.style,
      }}
    />
  );
};
