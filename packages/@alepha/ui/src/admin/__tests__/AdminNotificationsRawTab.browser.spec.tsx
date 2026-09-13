import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import type { NotificationDetailResource } from "alepha/api/notifications";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminNotificationsRawTab } from "../admin-notifications-raw-tab.tsx";

/**
 * `variables`, `rendered` and `logs` were all returned by `getNotification`
 * and none of them was rendered anywhere. They are also the three fields most
 * often absent, for two unrelated and entirely normal reasons: the outbox row
 * is purged at 7 days while the receipt lives 90, and a `sensitive` template
 * withholds its variables for good.
 */
describe("AdminNotificationsRawTab", () => {
  let alepha: Alepha;

  beforeAll(async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
  });

  afterAll(async () => {
    await alepha.stop();
  });

  const mount = (detail: Partial<NotificationDetailResource>) =>
    render(
      <AlephaContext.Provider value={alepha}>
        <AdminNotificationsRawTab
          detail={
            {
              id: "n-1",
              createdAt: "2026-08-28T10:00:00.000Z",
              executionId: "e-1",
              status: "sent",
              ...detail,
            } as NotificationDetailResource
          }
        />
      </AlephaContext.Provider>,
    );

  it("renders the variables it was given", () => {
    const { container } = mount({ variables: { username: "Ada" } });
    expect(container.textContent).toContain("username");
    expect(container.textContent).toContain("Ada");
  });

  it("omits a rendered block that carries nothing", () => {
    // `rendered` is always an object and is empty for a sensitive template.
    // An empty `{}` under a heading reads as data that is not there.
    const { container } = mount({ rendered: {} });
    expect(container.textContent).not.toContain("Rendered");
  });

  it("renders the rendered block when it holds something", () => {
    const { container } = mount({ rendered: { subject: "Welcome" } });
    expect(container.textContent).toContain("Rendered");
    expect(container.textContent).toContain("Welcome");
  });

  it("explains a purged outbox row rather than looking empty", () => {
    const { container } = mount({ outboxAvailable: false });
    expect(container.textContent).toContain("retention window");
  });

  it("says why there is nothing, when the outbox row is still there", () => {
    // Outbox present but every field empty means the template is sensitive.
    // Silence here would read as a rendering failure.
    const { container } = mount({ outboxAvailable: true });
    expect(container.textContent).toContain("sensitive");
  });
});
