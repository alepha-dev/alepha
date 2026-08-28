import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { beforeAll, describe, expect, it } from "vitest";

import { AdminNotificationsStatusBadge } from "../admin-notifications-status-badge.tsx";
import {
  NOTIFICATION_STATUS_ICON,
  NOTIFICATION_STATUS_TONE,
  NOTIFICATION_STATUSES,
} from "../admin-notifications-status-tones.ts";

/**
 * The status column used to render `job_executions.status`, which never wrote
 * `sent`, `delivered` or `bounced` - so every badge fell through to the
 * neutral variant and the column told an operator nothing.
 *
 * It then had three shadcn variants for eight statuses, which left `sent`,
 * `deferred` and `skipped` identical. These assert that every status is
 * distinguishable, and that the two axes carrying the distinction (tone and
 * glyph) are both doing work.
 */
describe("AdminNotificationsStatusBadge", () => {
  /**
   * The badge reads its labels through `useI18n`, which needs a container in
   * context. `AlephaReactI18n` with no catalogue resolves every key to its
   * English default, which is what these assertions expect.
   */
  let alepha: Alepha;

  beforeAll(async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
  });

  const renderBadge = (status?: string) =>
    render(
      <AlephaContext.Provider value={alepha}>
        <AdminNotificationsStatusBadge status={status} />
      </AlephaContext.Provider>,
    );

  /**
   * Asserted on `data-tone`, never on the markup: the Badge's class list
   * names every tone it supports, so a substring match on `innerHTML` passes
   * for all of them and proves nothing.
   */
  const toneOf = (status?: string): string | null => {
    const { container } = renderBadge(status);
    return container
      .querySelector("[data-slot='badge']")
      ?.getAttribute("data-tone") as string | null;
  };

  it("gives every status a tone", () => {
    for (const status of NOTIFICATION_STATUSES) {
      expect(toneOf(status)).toBeTruthy();
    }
  });

  it("marks the states an operator has to act on as danger", () => {
    for (const status of ["bounced", "complained", "failed", "rejected"]) {
      expect(toneOf(status)).toBe("danger");
    }
  });

  it("does NOT mark a skipped send as a failure", () => {
    // The gate refusing to mail someone who unsubscribed is the system
    // working. Colouring it like a bounce sends operators hunting for a
    // problem that is not there.
    expect(toneOf("skipped")).toBe("neutral");
  });

  it("distinguishes a confirmed delivery from a mere acceptance", () => {
    expect(toneOf("delivered")).not.toBe(toneOf("sent"));
  });

  /**
   * Four statuses share the danger tone, so colour alone cannot separate
   * them. The glyph is what carries the distinction, and it is also what
   * keeps the column readable in monochrome.
   */
  it("gives each danger status its own glyph", () => {
    const glyphs = ["bounced", "complained", "failed", "rejected"].map(
      (status) =>
        NOTIFICATION_STATUS_ICON[
          status as keyof typeof NOTIFICATION_STATUS_ICON
        ],
    );
    expect(new Set(glyphs).size).toBe(4);
  });

  it("covers every status in both maps, with no extras", () => {
    // A status present in one map and missing from the other renders a chip
    // with no colour or no glyph, silently.
    expect(Object.keys(NOTIFICATION_STATUS_TONE).sort()).toEqual(
      [...NOTIFICATION_STATUSES].sort(),
    );
    expect(Object.keys(NOTIFICATION_STATUS_ICON).sort()).toEqual(
      [...NOTIFICATION_STATUSES].sort(),
    );
  });

  it("renders a label for the status", () => {
    const { getByText } = renderBadge("delivered");
    expect(getByText("Delivered")).toBeTruthy();
  });

  it("falls back to sent rather than rendering nothing", () => {
    const { getByText } = renderBadge();
    expect(getByText("Sent")).toBeTruthy();
  });

  it("renders an unknown status as itself rather than blank", () => {
    // A transport could report a status this build does not know about.
    // Showing the raw value beats showing an empty chip.
    const { getByText } = renderBadge("quarantined");
    expect(getByText("quarantined")).toBeTruthy();
  });
});
