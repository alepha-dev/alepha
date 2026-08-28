import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminNotificationsStatusBadge } from "../admin-notifications-status-badge.tsx";

/**
 * The status column used to render `job_executions.status`, which never
 * wrote `sent`, `delivered` or `bounced` - so every badge fell through to
 * the neutral variant and the column told an operator nothing. These assert
 * the receipt vocabulary reaches the screen and that the three tiers are
 * actually distinguished.
 */
describe("AdminNotificationsStatusBadge", () => {
  it("renders the status text", () => {
    const { getByText } = render(
      <AdminNotificationsStatusBadge status="delivered" />,
    );
    expect(getByText("delivered")).toBeTruthy();
  });

  /**
   * Asserted on `data-variant` and not on the markup: the Badge's class list
   * names every variant it supports (`data-[variant=destructive]:…`), so a
   * substring match on `innerHTML` passes for all of them and proves
   * nothing.
   */
  const variantOf = (status?: string): string | null => {
    const { container } = render(
      <AdminNotificationsStatusBadge status={status} />,
    );
    return container
      .querySelector("[data-slot='badge']")
      ?.getAttribute("data-variant") as string | null;
  };

  it("marks the states an operator has to act on as destructive", () => {
    for (const status of ["bounced", "complained", "failed", "rejected"]) {
      expect(variantOf(status)).toBe("destructive");
    }
  });

  it("does NOT mark a skipped send as a failure", () => {
    // The gate refusing to mail someone who unsubscribed is the system
    // working. Colouring it like a bounce would send operators hunting for
    // a problem that is not there.
    expect(variantOf("skipped")).not.toBe("destructive");
  });

  it("distinguishes a confirmed delivery from a mere acceptance", () => {
    expect(variantOf("delivered")).not.toBe(variantOf("sent"));
  });

  it("falls back to sent rather than rendering nothing", () => {
    const { getByText } = render(<AdminNotificationsStatusBadge />);
    expect(getByText("sent")).toBeTruthy();
  });
});
