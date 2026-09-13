import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import { AdminJobsStatusBadge } from "../admin-jobs-status-badge.tsx";
import {
  JOB_STATUS_ICON,
  JOB_STATUS_TONE,
} from "../admin-jobs-status-tones.ts";
import { AdminPaymentsStatusBadge } from "../admin-payments-status-badge.tsx";
import {
  PAYMENT_STATUS_ICON,
  PAYMENT_STATUS_TONE,
} from "../admin-payments-status-tones.ts";
import { AdminUsersStatusBadge } from "../admin-users-status-badge.tsx";

/**
 * The users, jobs and payments status chips (feedback #2192, #Q2247): a
 * tinted chip in a semantic tone with a glyph, the design Lore's statuses
 * and `AdminNotificationsStatusBadge` already use. What these pin is that
 * each status is distinguishable, by tone where the meaning differs and by
 * glyph where two statuses share a tone, and that nothing merely ordinary
 * wears the danger tone.
 */
describe("admin status chips", () => {
  let alepha: Alepha;

  beforeAll(async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
  });

  /**
   * Asserted on `data-tone` / `data-variant`, never on the markup: the
   * Badge's class list names every tone it supports, so a substring match
   * proves nothing.
   */
  const chip = (node: ReactNode) => {
    const { container } = render(
      <AlephaContext.Provider value={alepha}>{node}</AlephaContext.Provider>,
    );
    const badge = container.querySelector("[data-slot='badge']");
    return {
      variant: badge?.getAttribute("data-variant"),
      tone: badge?.getAttribute("data-tone"),
      glyph: badge?.querySelector("svg") !== null,
      text: badge?.textContent,
    };
  };

  describe("users", () => {
    it("draws an active account as a success tint with a glyph", () => {
      expect(chip(<AdminUsersStatusBadge enabled />)).toEqual({
        variant: "tint",
        tone: "success",
        glyph: true,
        text: "Active",
      });
    });

    it("draws a disabled account as a danger tint with a glyph", () => {
      expect(chip(<AdminUsersStatusBadge enabled={false} />)).toEqual({
        variant: "tint",
        tone: "danger",
        glyph: true,
        text: "Disabled",
      });
    });
  });

  describe("jobs", () => {
    const statuses = Object.keys(JOB_STATUS_TONE) as Array<
      keyof typeof JOB_STATUS_TONE
    >;

    it("gives every status a tint and a glyph", () => {
      for (const status of statuses) {
        const c = chip(<AdminJobsStatusBadge status={status} />);
        expect(c.variant).toBe("tint");
        expect(c.tone).toBe(JOB_STATUS_TONE[status]);
        expect(c.glyph).toBe(true);
      }
    });

    it("does NOT mark a cancelled run as a failure", () => {
      // Somebody stopped it on purpose; tinting it like an error sends an
      // operator looking for a problem that is not there.
      expect(JOB_STATUS_TONE.cancelled).toBe("neutral");
      expect(JOB_STATUS_TONE.error).toBe("danger");
    });

    it("separates two statuses sharing a tone by their glyph", () => {
      expect(JOB_STATUS_TONE.pending).toBe(JOB_STATUS_TONE.scheduled);
      expect(JOB_STATUS_ICON.pending).not.toBe(JOB_STATUS_ICON.scheduled);
    });
  });

  describe("payments", () => {
    const statuses = Object.keys(PAYMENT_STATUS_TONE) as Array<
      keyof typeof PAYMENT_STATUS_TONE
    >;

    it("gives every status a tint and a glyph", () => {
      for (const status of statuses) {
        const c = chip(<AdminPaymentsStatusBadge status={status} />);
        expect(c.variant).toBe("tint");
        expect(c.tone).toBe(PAYMENT_STATUS_TONE[status]);
        expect(c.glyph).toBe(true);
      }
    });

    it("keeps danger for the one status that means a fault", () => {
      // voided, cancelled and expired were `destructive` before: each is a
      // flow that ended on purpose or by timeout, not something broken.
      const danger = statuses.filter(
        (s) => PAYMENT_STATUS_TONE[s] === "danger",
      );
      expect(danger).toEqual(["failed"]);
    });

    it("gives every status its own glyph", () => {
      const glyphs = new Set(statuses.map((s) => PAYMENT_STATUS_ICON[s]));
      expect(glyphs.size).toBe(statuses.length);
    });
  });
});
