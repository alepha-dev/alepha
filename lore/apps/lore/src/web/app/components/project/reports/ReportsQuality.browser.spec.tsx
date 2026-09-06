import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { QualityRunResource } from "@/api/schemas/qualityRunSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ReportsQualityEmpty from "./ReportsQualityEmpty.tsx";
import ReportsQualityStaleness from "./ReportsQualityStaleness.tsx";

/**
 * The two things this tab has to say that no other Reports tab does.
 *
 * Overview, Quests and Members are derived from rows Lore owns: nothing there
 * can be absent for want of a foreign system, and nothing there can be stale.
 * Quality is pushed by a CI job that can stop running, so both states are real
 * and both are easy to leave out - the charts render fine without them, which
 * is exactly the problem.
 *
 * Rendered as the two extracted components rather than through `ReportsQuality`
 * itself: the parent mounts recharts, which measures with a `ResizeObserver`
 * jsdom does not implement, and neither property under test involves a chart.
 */
const aRun: QualityRunResource = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: 1,
  createdAt: "2026-08-30T09:41:00.000Z",
  // Deliberately later than `createdAt`: the staleness line must render the
  // push that was kept, not the day's first one.
  updatedAt: "2026-08-30T17:12:00.000Z",
  day: "2026-08-30",
  commitSha: "0b35cb375f2a1c9d",
  branch: "main",
  coverageLines: 71.2,
  coverageStatements: 70.9,
  coverageFunctions: 64.4,
  coverageBranches: 82.1,
  testsTotal: 8526,
  testsPassed: 8524,
  testsFailed: 0,
  testsSkipped: 2,
  durationMs: 132_000,
};

describe("the Quality tab's two ingested-data states", () => {
  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      // The catalogue itself. Without it `tr()` echoes the key, so every
      // assertion below would pass against the key name and prove nothing.
      .with(I18n);
    await alepha.start();

    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Lore",
      slug: "lore",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      // Empty until the surfaces read capabilities: this spec is
      // about something else, and a fixture that claims capabilities it
      // does not exercise is a lie the next reader has to check.
      capabilities: [],
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);

    return alepha;
  };

  describe("nothing pushed yet", () => {
    /**
     * The one useful thing an empty Quality tab can say. A reader who has
     * never run the command cannot guess it, and the project slug is part of
     * it, so a generic "no data" would leave them exactly where they started.
     */
    it("prints the command, with this project's slug in it", async ({
      expect,
    }) => {
      const alepha = await mount();

      const view = render(
        <AlephaContext.Provider value={alepha}>
          <ReportsQualityEmpty projectSlug="lore" />
        </AlephaContext.Provider>,
      );

      const code = view.container.querySelector("code")?.textContent ?? "";
      expect(code).toContain("alepha test --coverage");
      expect(code).toContain("lore quality push --project lore");
    });

    it("names the credential the push needs", async ({ expect }) => {
      const alepha = await mount();

      const view = render(
        <AlephaContext.Provider value={alepha}>
          <ReportsQualityEmpty projectSlug="lore" />
        </AlephaContext.Provider>,
      );

      // The dictionaries are `lazy`, one dynamic import per locale, so the
      // first paint carries keys rather than copy.
      await waitFor(() =>
        expect(view.container.textContent).toContain("LORE_API_KEY"),
      );
    });
  });

  describe("how stale the figures are", () => {
    /**
     * A coverage figure with no date on it is indistinguishable from a current
     * one six months after CI stopped running. Branch and commit are the other
     * half: a run pushed from a topic branch is not the project's coverage.
     */
    it("says when, from which branch, and at which commit", async ({
      expect,
    }) => {
      const alepha = await mount();

      const view = render(
        <AlephaContext.Provider value={alepha}>
          <ReportsQualityStaleness latest={aRun} />
        </AlephaContext.Provider>,
      );

      await waitFor(() => expect(view.container.textContent).toContain("main"));

      const text = view.container.textContent ?? "";
      // Short sha, not the full one: the line is a subtitle, not a record.
      expect(text).toContain("0b35cb3");
      expect(text).not.toContain(aRun.commitSha);
      expect(text).toMatch(/2026/);

      // ⚠️ The stamp is `updatedAt` (17:12), never `createdAt` (09:41): one
      // row is one branch-day, so `createdAt` is that day's FIRST push and
      // rendering it would date the figures hours before they were measured.
      // Asserted on the minutes, which no timezone shifts.
      expect(text).toContain(":12");
      expect(text).not.toContain(":41");
    });
  });
});
