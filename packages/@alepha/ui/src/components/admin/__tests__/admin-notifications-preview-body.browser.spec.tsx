import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import type { NotificationPreviewResource } from "alepha/api/notifications";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminNotificationsPreviewBody } from "../admin-notifications-preview-body.tsx";

/**
 * The preview has four outcomes, three of which show nothing.
 *
 * They are all normal - a purged outbox row, a sensitive template, a template
 * deleted from the code - and an operator has to be able to tell them apart.
 * A single shared "unavailable" would make retention look like a bug, which
 * is the failure these lock down.
 */
describe("AdminNotificationsPreviewBody", () => {
  let alepha: Alepha;

  beforeAll(async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
  });

  afterAll(async () => {
    await alepha.stop();
  });

  const mount = (preview: Partial<NotificationPreviewResource>) =>
    render(
      <AlephaContext.Provider value={alepha}>
        <AdminNotificationsPreviewBody
          preview={
            {
              available: false,
              channel: "email",
              attachments: [],
              source: "live",
              ...preview,
            } as NotificationPreviewResource
          }
        />
      </AlephaContext.Provider>,
    );

  it("explains each unavailable reason differently", () => {
    const messages = (
      ["outbox-purged", "sensitive", "template-missing"] as const
    ).map(
      (reason) =>
        mount({ available: false, reason }).container.textContent ?? "",
    );

    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
    expect(new Set(messages).size).toBe(3);
  });

  it("names retention rather than blaming the reader", () => {
    const { container } = mount({
      available: false,
      reason: "outbox-purged",
    });
    expect(container.textContent).toContain("retention");
  });

  it("falls back to a generic sentence for a reason it does not know", () => {
    // A newer server could answer with a reason this build predates. An empty
    // panel would read as a broken tab.
    const { container } = mount({
      available: false,
      reason: "something-new" as never,
    });
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("renders an available email inside the sandboxed frame", () => {
    const { container } = mount({
      available: true,
      channel: "email",
      subject: "Welcome",
      html: "<p>Hi Ada</p>",
    });

    const frame = container.querySelector("iframe");
    expect(frame).toBeTruthy();
    // The isolation is the point: an email body is untrusted HTML, and it
    // must never be injected into the admin's own document.
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("srcdoc")).toContain("Hi Ada");
    expect(container.textContent).toContain("Welcome");
  });

  it("warns that the body is re-rendered, not replayed", () => {
    // Without this line the preview claims a fidelity it does not have: the
    // template may have changed since the send.
    const { container } = mount({
      available: true,
      channel: "email",
      html: "<p>x</p>",
    });
    expect(container.textContent).toContain("Re-rendered from the template");
  });

  it("renders an sms as text, with no frame", () => {
    const { container } = mount({
      available: true,
      channel: "sms",
      message: "Your code is 123456",
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Your code is 123456");
  });

  it("lists attachment names without trying to load them", () => {
    const { container } = mount({
      available: true,
      channel: "email",
      html: "<p>x</p>",
      attachments: ["invoice-2026-08.pdf"],
    });

    expect(container.textContent).toContain("invoice-2026-08.pdf");
  });
});
