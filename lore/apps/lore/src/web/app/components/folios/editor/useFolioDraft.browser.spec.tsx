import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { act } from "react";
import { describe, it } from "vitest";
import type { Folio } from "@/api/entities/folios.ts";
import { type FolioDraftValues, useFolioDraft } from "./useFolioDraft.ts";

/**
 * Regression guard for a race the reviewer found in the workspace's Save
 * flow: `markSaved` used to reassign the SAME ref that `useForm` reads as
 * `initialValues`, so re-baselining after a save re-triggered
 * `FormModel.setInitialValues` — which wipes the live buffer wholesale.
 *
 * Sequence that broke: edit the title -> click Save (snapshots the
 * buffer) -> keep typing during the round-trip -> the response lands and
 * `markSaved` runs with the STALE pre-edit snapshot. The buffer used to
 * revert to that snapshot, silently discarding whatever was typed during
 * the wait, while `dirty` came back `false` and the status line falsely
 * read "Saved" over an edit the server never received. A second Save
 * would then have persisted the stale snapshot again.
 *
 * `useFolioDraft` now keeps two refs: `formInitial` (fed to `useForm`,
 * only moved by a genuine folio-prop change) and `baseline` (the
 * dirty-comparison target, moved by `markSaved` alone, never touching
 * `useForm`). This exercises `markSaved` directly rather than through a
 * real save action, since the bug lives entirely inside this hook.
 */

const baseFolio = (overrides: Partial<Folio> = {}): Folio => ({
  id: "11111111-1111-1111-1111-111111111111",
  shortId: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectId: 1,
  title: "Original title",
  protected: false,
  content: "original content",
  tags: [],
  pinned: false,
  directoryId: undefined,
  summary: "",
  searchText: "",
  ...overrides,
});

describe("useFolioDraft — markSaved during an in-flight edit", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  it("does not discard an edit typed while the save request is in flight", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    let markSaved: ((at: string, values: FolioDraftValues) => void) | undefined;

    const Widget = () => {
      const draft = useFolioDraft(baseFolio());
      markSaved = draft.markSaved;
      return (
        <div>
          <input
            data-testid="title"
            value={draft.values.title}
            onChange={(e) => draft.form.input.title.set(e.target.value)}
          />
          <span data-testid="dirty">{draft.dirty ? "dirty" : "clean"}</span>
          <span data-testid="status">{draft.statusKey}</span>
        </div>
      );
    };

    const { getByTestId } = mount(alepha, <Widget />);

    // User edits the title — this is what a Save click would snapshot.
    fireEvent.change(getByTestId("title"), {
      target: { value: "Edited before save" },
    });
    await waitFor(() => expect(getByTestId("dirty").textContent).toBe("dirty"));
    const snapshotAtSaveTime: FolioDraftValues = {
      title: "Edited before save",
      tags: [],
      summary: "",
      content: "original content",
    };

    // More typing while the (simulated) request is in flight.
    fireEvent.change(getByTestId("title"), {
      target: { value: "Edited before save, plus more" },
    });

    // The response "lands" and the save action calls markSaved with the
    // snapshot captured BEFORE the extra typing above.
    act(() => {
      markSaved?.("2026-01-01T00:05:00.000Z", snapshotAtSaveTime);
    });

    // The live buffer must still hold what the user actually typed — not
    // reverted to the stale pre-save-click snapshot.
    expect((getByTestId("title") as HTMLInputElement).value).toBe(
      "Edited before save, plus more",
    );
    // And the status must not lie "Saved" over text the server never
    // received.
    await waitFor(() =>
      expect(getByTestId("status").textContent).toBe("unsaved"),
    );
    expect(getByTestId("dirty").textContent).toBe("dirty");
  });

  it("reports Saved when no further edits happened during the round-trip", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    let markSaved: ((at: string, values: FolioDraftValues) => void) | undefined;

    const Widget = () => {
      const draft = useFolioDraft(baseFolio());
      markSaved = draft.markSaved;
      return (
        <div>
          <input
            data-testid="title"
            value={draft.values.title}
            onChange={(e) => draft.form.input.title.set(e.target.value)}
          />
          <span data-testid="status">{draft.statusKey}</span>
        </div>
      );
    };

    const { getByTestId } = mount(alepha, <Widget />);

    fireEvent.change(getByTestId("title"), { target: { value: "Edited" } });
    await waitFor(() =>
      expect(getByTestId("status").textContent).toBe("unsaved"),
    );

    const snapshot: FolioDraftValues = {
      title: "Edited",
      tags: [],
      summary: "",
      content: "original content",
    };
    act(() => {
      markSaved?.("2026-01-01T00:05:00.000Z", snapshot);
    });

    await waitFor(() =>
      expect(getByTestId("status").textContent).toBe("saved"),
    );
  });
});
