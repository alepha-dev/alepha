import { TriageRunRegistry } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { useTriageInboxRun } from "../src/web/app/components/project/feedback/useTriageInboxRun.ts";
import { WorkShell } from "../src/web/app/shell/WorkShell.ts";

/**
 * One Triage action for feedback and errors (#Q4240): Plan registers its
 * triage run on core, so the Errors page, in Ship, offers the very entries
 * the Feedback page does.
 */
describe("the triage run", () => {
  it("is Plan's, registered on core for the Errors page to read", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.inject(WorkShell);

    expect(alepha.inject(TriageRunRegistry).use).toBe(useTriageInboxRun);
  });

  it("offers nothing when Plan is not booted", ({ expect }) => {
    const registry = Alepha.create().inject(TriageRunRegistry);

    expect(registry.use()).toEqual([]);
  });

  it("refuses a second registration", ({ expect }) => {
    const alepha = Alepha.create();
    alepha.inject(WorkShell);

    expect(() => alepha.inject(TriageRunRegistry).register(() => [])).toThrow(
      /registered twice/,
    );
  });
});
