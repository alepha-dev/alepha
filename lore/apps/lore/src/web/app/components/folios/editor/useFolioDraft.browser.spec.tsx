// oxlint-disable react/globals -- Test harness. Each case renders a throwaway
// component whose only job is to hand the hook's return value back to the
// assertion, so the writes to the enclosing `let` are the measurement, not a
// side effect the component depends on.
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

/**
 * `revisionsAt` — the History tab's refetch key, split off from `savedAt`
 * so a writing session stops refetching a revision list that has not
 * changed. The server folds saves inside an hour into one revision and
 * reports which is which; this hook is where that answer is honoured.
 */
describe("useFolioDraft — revisionsAt tracks the revision list, not the save", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const renderDraft = (): { read: () => FolioDraft | undefined } => {
    const alepha = Alepha.create().with(AlephaLogger);
    let draft: FolioDraft | undefined;
    const Widget = () => {
      draft = useFolioDraft(baseFolio());
      return null;
    };
    mount(alepha, <Widget />);
    return { read: () => draft };
  };

  const saved = (title: string): FolioDraftValues => ({
    title,
    summary: "",
    content: "original content",
  });

  it("holds still through ten folded autosaves", async ({ expect }) => {
    const { read } = renderDraft();
    // `baseFolio().updatedAt`, and the value both stamps start at. Every
    // `at` below is deliberately distinct from it AND from every other —
    // an earlier draft of this test cycled minutes with `i % 10`, so the
    // tenth save landed back on the initial value and the assertion held
    // whatever the hook did.
    const before = "2026-01-01T00:00:00.000Z";
    expect(read()?.revisionsAt).toBe(before);

    let last = "";
    for (let i = 1; i <= 10; i++) {
      last = `2026-01-01T${String(i).padStart(2, "0")}:30:00.000Z`;
      act(() => read()?.markSaved(last, saved(`v${i}`), false));
    }

    // The whole point: ten saves, and the key `FolioHistoryTab` refetches
    // on never moved, so it issues no request for any of them.
    expect(read()?.revisionsAt).toBe(before);
    // `savedAt` did move, to the most recent one — the status line still
    // reads "Saved just now", which is the job the two used to share and
    // now do not.
    expect(read()?.savedAt).toBe(last);
    expect(last).not.toBe(before);
  });

  it("moves when the save opened a revision", async ({ expect }) => {
    const { read } = renderDraft();

    act(() => read()?.markSaved("2026-01-01T01:00:00.000Z", saved("v2"), true));

    expect(read()?.revisionsAt).toBe("2026-01-01T01:00:00.000Z");
  });

  it("moves when the caller has no answer to give", async ({ expect }) => {
    // The default. Every `markSaved` call site except the autosave path is
    // reporting a one-off user action (unlock, encrypt, remove protection)
    // with no `revisionsChanged` to consult, and must keep refetching.
    const { read } = renderDraft();

    act(() => read()?.markSaved("2026-01-01T02:00:00.000Z", saved("v3")));

    expect(read()?.revisionsAt).toBe("2026-01-01T02:00:00.000Z");
  });

  it("moves on touchSavedAt, which only reverts use", async ({ expect }) => {
    // A revert always opens its own revision — `appendRevision` refuses to
    // fold one — so this is unconditional on purpose.
    const { read } = renderDraft();

    act(() => read()?.touchSavedAt("2026-01-01T03:00:00.000Z"));

    expect(read()?.revisionsAt).toBe("2026-01-01T03:00:00.000Z");
  });
});

describe("useFolioDraft — adoptTitle", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  /**
   * The tree's inline rename cannot reach this buffer: it PATCHes the row
   * and writes `userFoliosAtom`, while the draft was seeded once from the
   * route loader's snapshot. Every save path then sent the stale title, so
   * a rename made before the editor's first save was reverted by it.
   *
   * `adoptTitle` is the narrow way in. The two claims below are what make
   * it narrow, and both were available to get wrong: `markSaved` would have
   * taken the unsaved body with it, `touchSavedAt` would have left the
   * adopted title reading as an unsaved edit of the user's own.
   */
  it("takes the new title and treats it as persisted", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    let draft: FolioDraft | undefined;

    const Widget = () => {
      draft = useFolioDraft(baseFolio());
      return (
        <div>
          <span data-testid="title">{draft.values.title}</span>
          <span data-testid="dirty">{draft.dirty ? "dirty" : "clean"}</span>
        </div>
      );
    };

    const { getByTestId } = mount(alepha, <Widget />);
    expect(getByTestId("title").textContent).toBe("Original title");

    act(() => {
      draft?.adoptTitle("Renamed in the tree", "2026-01-01T00:05:00.000Z");
    });

    await waitFor(() =>
      expect(getByTestId("title").textContent).toBe("Renamed in the tree"),
    );
    // Not an unsaved edit: the server is where this title came from.
    expect(getByTestId("dirty").textContent).toBe("clean");
    expect(draft?.savedAt).toBe("2026-01-01T00:05:00.000Z");
  });

  it("leaves an unsaved body edit dirty, and intact", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    let draft: FolioDraft | undefined;

    const Widget = () => {
      draft = useFolioDraft(baseFolio());
      return (
        <div>
          <input
            data-testid="content"
            value={draft.values.content}
            onChange={(e) => draft?.form.input.content.set(e.target.value)}
          />
          <span data-testid="title">{draft.values.title}</span>
          <span data-testid="dirty">{draft.dirty ? "dirty" : "clean"}</span>
        </div>
      );
    };

    const { getByTestId } = mount(alepha, <Widget />);

    fireEvent.change(getByTestId("content"), {
      target: { value: "a paragraph the server has never seen" },
    });
    await waitFor(() => expect(getByTestId("dirty").textContent).toBe("dirty"));

    act(() => {
      draft?.adoptTitle("Renamed in the tree", "2026-01-01T00:05:00.000Z");
    });

    await waitFor(() =>
      expect(getByTestId("title").textContent).toBe("Renamed in the tree"),
    );
    // The half `markSaved` would have got wrong: adopting the whole buffer
    // as the baseline would report "Saved" over a body nothing persisted.
    expect(getByTestId("dirty").textContent).toBe("dirty");
    expect((getByTestId("content") as HTMLInputElement).value).toBe(
      "a paragraph the server has never seen",
    );
  });
});
