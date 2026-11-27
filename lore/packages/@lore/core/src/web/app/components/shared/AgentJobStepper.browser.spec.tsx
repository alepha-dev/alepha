import type { AgentJobStepsValue } from "@lore/core/schemas";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { I18n } from "../../services/I18n.ts";
import AgentJobStepper, {
  type AgentJobStepperProps,
} from "./AgentJobStepper.tsx";

const NOW = "2026-11-26T12:00:00.000Z";

/**
 * A clock stopped at {@link NOW}.
 */
class FixedClock extends DateTimeProvider {
  override nowMillis(): number {
    return Date.parse(NOW);
  }
}

const steps = (over: Partial<AgentJobStepsValue>): AgentJobStepsValue => ({
  unit: "quest",
  total: 3,
  done: 1,
  quests: [
    {
      shortId: 11,
      title: "First",
      acceptedAt: "2026-11-26T11:00:00.000Z",
      completedAt: "2026-11-26T11:20:00.000Z",
      objectives: { total: 2, done: 2, waived: 0 },
    },
    {
      shortId: 12,
      title: "Second",
      acceptedAt: "2026-11-26T11:00:00.000Z",
      objectives: { total: 4, done: 1, waived: 0 },
    },
    {
      shortId: 13,
      title: "Third",
      acceptedAt: "2026-11-26T11:00:00.000Z",
      objectives: { total: 1, done: 0, waived: 0 },
    },
  ],
  pending: [],
  current: 12,
  lastStepAt: "2026-11-26T11:48:00.000Z",
  stepTimes: ["2026-11-26T11:20:00.000Z"],
  ...over,
});

/**
 * The stepped bar of a running agent job (#Q4434): a segment per quest, the
 * current one's objectives as sub-steps, quest k of N, the time since the
 * last step and the elapsed time against the ceiling; the wrapping up line
 * once every quest is done; the final count of an ended job.
 */
describe("AgentJobStepper", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (props: AgentJobStepperProps) => {
    alepha = Alepha.create()
      .with({ provide: DateTimeProvider, use: FixedClock })
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <AgentJobStepper {...props} />
      </AlephaContext.Provider>,
    );
  };

  it("draws a segment per quest, the current quest's objectives, quest k of N and the times", async ({
    expect,
  }) => {
    await show({
      steps: steps({}),
      running: true,
      startedAt: "2026-11-26T11:00:00.000Z",
      timeoutSeconds: 43_200,
      mark: 13,
    });
    const segments = screen.getAllByTestId("job-steps-segment");
    expect(segments).toHaveLength(3);
    expect(segments[0]?.dataset.done).toBe("true");
    expect(segments[1]?.dataset.current).toBe("true");
    expect(segments[2]?.dataset.marked).toBe("true");
    expect(screen.getByTestId("job-steps-text").textContent).toBe(
      "Quest 2 of 3",
    );
    expect(screen.getByTestId("job-steps-objectives").textContent).toContain(
      "1 of 4 objectives",
    );
    expect(screen.getByTestId("job-steps-current").textContent).toContain(
      "#12 Second",
    );
    expect(screen.getByTestId("job-steps-elapsed").textContent).toContain(
      "of 12 h",
    );
    expect(screen.getByTestId("job-steps-time").textContent).toContain(
      "Last step",
    );
  });

  it("fills a quest worked earlier but not completed yet by its ticks, below full, apart from the current one (#Q4544)", async ({
    expect,
  }) => {
    await show({
      steps: steps({
        total: 2,
        done: 0,
        quests: [
          {
            shortId: 21,
            title: "Worked first",
            acceptedAt: "2026-11-26T11:00:00.000Z",
            objectives: { total: 5, done: 5, waived: 0 },
          },
          {
            shortId: 22,
            title: "Worked now",
            acceptedAt: "2026-11-26T11:00:00.000Z",
            objectives: { total: 6, done: 3, waived: 0 },
          },
        ],
        current: 22,
      }),
      running: true,
    });
    const segments = screen.getAllByTestId("job-steps-segment");
    const fillOf = (segment: HTMLElement | undefined) =>
      (segment?.firstElementChild as HTMLElement | null)?.style.width;
    // The first quest's 5/5 ticks fill it to the cap, not to 0 and not to full.
    expect(fillOf(segments[0])).toBe("95%");
    expect(segments[0]?.dataset.done).toBeUndefined();
    expect(segments[0]?.dataset.current).toBeUndefined();
    expect(segments[0]?.firstElementChild?.className).toContain(
      "bg-primary/40",
    );
    // The current one keeps its own shade.
    expect(fillOf(segments[1])).toBe("50%");
    expect(segments[1]?.dataset.current).toBe("true");
    expect(segments[1]?.firstElementChild?.className).toContain(
      "bg-primary/70",
    );
    // The headline and the bar's value still count completed quests.
    expect(screen.getByTestId("job-steps-text").textContent).toBe(
      "Quest 2 of 2",
    );
    expect(
      screen.getByTestId("job-steps-bar").getAttribute("aria-valuenow"),
    ).toBe("0");
  });

  it("gives the steps left as a range, and warns when they may not fit before the timeout (#Q4436)", async ({
    expect,
  }) => {
    await show({
      steps: steps({}),
      pace: { left: 2, low: 20, high: 35, warning: false },
      running: true,
    });
    expect(screen.getByTestId("job-pace-range").textContent).toBe(
      "About 20 min to 35 min for the 2 quests left, not counting review, checks and merge",
    );
    expect(screen.queryByTestId("job-pace-warning")).toBeNull();
    cleanup();
    await alepha?.stop();
    await show({
      steps: steps({}),
      pace: { left: 2, low: 90, high: 140, warning: true },
      running: true,
    });
    expect(screen.getByTestId("job-pace-warning").textContent).toContain(
      "may not fit before the job's timeout",
    );
    expect(screen.getByTestId("job-pace-range").textContent).toContain(
      "1 h 30 min to 2 h 20 min",
    );
  });

  it("flags the warning on a table row, and says nothing of pace once the job ended", async ({
    expect,
  }) => {
    await show({
      steps: steps({}),
      pace: { left: 2, low: 90, high: 140, warning: true },
      running: true,
      compact: true,
    });
    expect(screen.getByTestId("job-pace-warning")).toBeTruthy();
    cleanup();
    await alepha?.stop();
    await show({
      steps: steps({}),
      pace: { left: 2, low: 90, high: 140, warning: true },
      running: false,
    });
    expect(screen.queryByTestId("job-pace-warning")).toBeNull();
    expect(screen.queryByTestId("job-pace-range")).toBeNull();
  });

  it("adds a work-epic job's pending quests as empty segments", async ({
    expect,
  }) => {
    await show({
      steps: steps({
        total: 5,
        pending: [
          { shortId: 14, title: "Fourth" },
          { shortId: 15, title: "Fifth" },
        ],
      }),
      running: true,
    });
    expect(screen.getAllByTestId("job-steps-segment")).toHaveLength(5);
    expect(screen.getByTestId("job-steps-text").textContent).toBe(
      "Quest 2 of 5",
    );
  });

  it("says a job whose every quest is done is wrapping up", async ({
    expect,
  }) => {
    await show({
      steps: steps({ total: 1, done: 1, quests: steps({}).quests.slice(0, 1) }),
      running: true,
    });
    expect(screen.getByTestId("job-steps-text").textContent).toContain(
      "wrapping up",
    );
    expect(screen.queryByTestId("job-steps-current")).toBeNull();
  });

  it("keeps an ended job's final count, with no current quest and no times", async ({
    expect,
  }) => {
    await show({ steps: steps({}), running: false });
    expect(screen.getByTestId("job-steps-text").textContent).toBe(
      "1 of 3 quests done",
    );
    expect(screen.queryByTestId("job-steps-current")).toBeNull();
    expect(screen.queryByTestId("job-steps-time")).toBeNull();
    expect(
      screen
        .getAllByTestId("job-steps-segment")
        .some((it) => it.dataset.current === "true"),
    ).toBe(false);
  });

  it("counts a work-quest job's objectives, and draws the compact form for a row", async ({
    expect,
  }) => {
    await show({
      steps: steps({
        unit: "objective",
        total: 4,
        done: 1,
        quests: steps({}).quests.slice(1, 2),
        stepTimes: [],
      }),
      running: true,
      compact: true,
    });
    expect(screen.getAllByTestId("job-steps-segment")).toHaveLength(1);
    expect(screen.getByTestId("job-steps").textContent).toContain("1/4");
    expect(screen.queryByTestId("job-steps-text")).toBeNull();
  });
});
