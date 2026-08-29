import { Toaster } from "@alepha/ui/components/ui/sonner";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "@/api/schemas/questResourceSchema.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import QuestViewObjectives from "./QuestViewObjectives.tsx";

/**
 * Stands in for the HTTP-backed `useClient<QuestController>()`, with
 * `completeObjective` rejecting. Same substitution seam as
 * `QuestDependencyPicker.browser.spec.tsx` (`CLAUDE.md`: never `vi.mock` /
 * `vi.spyOn`).
 */
class FailingLinkProvider extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  calls = 0;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      completeObjective: async () => {
        this.calls++;
        throw new Error("nope");
      },
    };
  }

  public quest(): QuestResource {
    return {
      ...this.faker.generate(questResourceSchema),
      id: 1,
      shortId: 1,
      projectId: 1,
      title: "Ship it",
      acceptedAt: "2026-08-26T10:00:00.000Z",
      completedAt: undefined,
      objectives: [{ id: 0, title: "Write the migration", completed: false }],
    };
  }
}

/**
 * A failed objective toggle has to say so.
 *
 * The checkbox is driven by `quest.objectives`, which a failed call never
 * replaces — so the box snaps back on its own and the screen ends up in the
 * state it started in. That is indistinguishable from "the click did not
 * register", and for a while it was also indistinguishable from success,
 * because the catch wrote to `console.error` and nothing else.
 */
describe("QuestViewObjectives", () => {
  it("toasts when the server refuses the toggle", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: FailingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();

    const links = alepha.inject(FailingLinkProvider);
    const quest = links.quest();

    render(
      <AlephaContext.Provider value={alepha}>
        <QuestViewObjectives quest={quest} />
        <Toaster />
      </AlephaContext.Provider>,
    );

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(links.calls).toBe(1));

    // The message itself, not just "a toast happened": a catch that fired the
    // success toast would satisfy the weaker assertion.
    await waitFor(() =>
      expect(screen.getByText("Could not update the objective.")).toBeTruthy(),
    );
  });
});
