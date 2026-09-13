import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmailBodyFrame } from "../email-body-frame.tsx";

/**
 * An email body is untrusted HTML written by whoever authored the template,
 * rendered inside the admin. These assert the isolation, not the styling.
 */
describe("EmailBodyFrame", () => {
  const frameOf = (html: string, dir?: "ltr" | "rtl") => {
    const { container } = render(<EmailBodyFrame html={html} dir={dir} />);
    return container.querySelector("iframe")!;
  };

  it("renders a full document as-is", () => {
    // Wrapping it again would nest <html> inside <html>, and the document
    // already declares its own direction.
    const doc = '<!DOCTYPE html><html dir="rtl"><body>hello</body></html>';
    expect(frameOf(doc).getAttribute("srcdoc")).toBe(doc);
  });

  it("wraps a bare fragment in a document of its own", () => {
    const srcDoc = frameOf("<p>hello</p>").getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("<!DOCTYPE html>");
    expect(srcDoc).toContain("<p>hello</p>");
  });

  it("applies the requested direction to a fragment", () => {
    const srcDoc = frameOf("<p>hello</p>", "rtl").getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain('dir="rtl"');
  });

  /**
   * The sandbox is the whole point of the component.
   *
   * It blocks scripts in an untrusted body, keeps the email's CSS out of the
   * admin's, and blocks top-level navigation - which is what makes the live
   * one-click unsubscribe link the renderer mints inert. Clicking it in a
   * preview would otherwise unsubscribe the recipient.
   */
  it("sandboxes the frame with no permissions at all", () => {
    const frame = frameOf("<p>hello</p>");
    expect(frame.hasAttribute("sandbox")).toBe(true);
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  it("renders an empty body rather than crashing on no html", () => {
    const srcDoc = frameOf("").getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("<!DOCTYPE html>");
  });
});
