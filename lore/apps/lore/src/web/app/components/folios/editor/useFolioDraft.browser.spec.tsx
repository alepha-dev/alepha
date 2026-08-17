import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { act } from "react";
import { describe, it } from "vitest";
import type { Folio } from "@/api/entities/folios.ts";
import {
  type FolioDraft,
  type FolioDraftValues,
  useFolioDraft,
} from "./useFolioDraft.ts";

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

/**
 * Regression guard for a reviewer-found bug in `useFolioActions`'s create-
 * mode catch-up (Task 8): `save()` re-read `input.draft.values` a second
 * time after `await folioApi.create(...)` to see whether the user kept
 * typing during the round-trip, expecting that to be a live read. It
 * wasn't — `input` (and therefore `input.draft`) is fixed for the whole
 * lifetime of the `save()` closure, and `useFolioDraft` rebuilds `values`
 * as a brand new plain object every render, so re-reading `values` off the
 * SAME captured `draft` object always returns the exact snapshot from
 * whenever that closure was created, never anything typed afterward. The
 * "catch-up" comparison silently reduced to comparing a value against
 * itself, so an edit made during the round-trip was discarded by the
 * post-create remount while the status line still read "Saved".
 *
 * The fix, `getLiveValues()`, reads through `form.currentValues` instead —
 * `form` is the ONE object in `FolioDraft` that stays the same instance
 * across every render (memoized in `useForm`), and `.set()` mutates its
 * internal store synchronously and independently of React's render cycle.
 * This test proves that property directly: it captures `draft` exactly
 * once (simulating a `save()` closure created on the first render), types
 * AFTER that capture, and shows `getLiveValues()` — called through the
 * stale-captured object — still sees the edit, while `.values` does not.
 */
describe("useFolioDraft — getLiveValues reads through a closure-frozen `draft`", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  it("sees an edit typed after the draft object was captured; `.values` does not", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    // Captured exactly once, on the FIRST render — exactly what happens
    // when `useFolioActions`'s `save` closure is created on one render and
    // then invoked later (by a click) without itself re-rendering.
    let capturedDraft: FolioDraft | undefined;

    const Widget = () => {
      const draft = useFolioDraft(baseFolio());
      if (!capturedDraft) capturedDraft = draft;
      return (
        <input
          data-testid="title"
          value={draft.values.title}
          onChange={(e) => draft.form.input.title.set(e.target.value)}
        />
      );
    };

    const { getByTestId } = mount(alepha, <Widget />);
    expect(capturedDraft?.values.title).toBe("Original title");

    fireEvent.change(getByTestId("title"), {
      target: { value: "typed after closure capture" },
    });
    await waitFor(() =>
      expect((getByTestId("title") as HTMLInputElement).value).toBe(
        "typed after closure capture",
      ),
    );

    // The frozen snapshot property never saw the edit — this IS the bug:
    // `save()` re-reading `input.draft.values` a second time returned this
    // same stale value, so its "did anything change" comparison always
    // came back "no".
    expect(capturedDraft?.values.title).toBe("Original title");

    // `getLiveValues()`, called through that SAME stale-captured object,
    // sees the edit — it reads through the stable `form` instance, not the
    // per-render `values` snapshot.
    expect(capturedDraft?.getLiveValues().title).toBe(
      "typed after closure capture",
    );
  });
});
