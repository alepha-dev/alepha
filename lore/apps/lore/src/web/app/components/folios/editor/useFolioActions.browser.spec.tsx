// oxlint-disable react/globals -- Test harness. Each case renders a throwaway
// component whose only job is to hand the hook's return value back to the
// assertion, so the writes to the enclosing `let` are the measurement, not a
// side effect the component depends on.
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { Folio } from "@/api/entities/folios.ts";

import {
  forgetAllProtectedKeys,
  forgetProtectedKey,
} from "../protectedFolioKeys.ts";
import {
  type UseFolioActionsResult,
  useFolioActions,
} from "./useFolioActions.ts";
import { type FolioDraft, useFolioDraft } from "./useFolioDraft.ts";

/**
 * Regression guard for a reviewer-found bug: after `confirmEncrypt`
 * (clear → protected, in-session) succeeds, every subsequent `save()` used
 * to read `parseProtectedEnvelope(props.folio.content)` — `props.folio` is
 * the route-loader prop, frozen for the mount's lifetime, so its `content`
 * was STILL the pre-encryption plaintext markdown. Parsing markdown as a
 * crypto envelope returns `null`, so `save()` refused with "invalid
 * envelope" and returned WITHOUT calling `folioApi.update` at all — the
 * folio was unsavable until a full page reload re-fetched the row.
 *
 * Fixed by tracking the envelope's salt as local state (`protectedSalt`),
 * moved by `confirmEncrypt`'s own success rather than re-derived from the
 * stale prop. This test proves the fix at the observable boundary: the
 * fake `LinkProvider` records every `update` call, so "did the follow-up
 * save actually reach the network" is a call-count assertion, not an
 * inference from UI state.
 */

const baseFolio = (overrides: Partial<Folio> = {}): Folio => ({
  id: "22222222-2222-2222-2222-222222222222",
  shortId: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectId: 1,
  title: "A clear folio",
  protected: false,
  content: "some plaintext content",
  tags: [],
  pinned: false,
  directoryId: undefined,
  summary: "",
  searchText: "",
  ...overrides,
});

interface RecordedUpdate {
  id: string;
  body: Record<string, unknown>;
}

/**
 * Stands in for the real HTTP-backed client `useClient<FolioController>()`
 * would otherwise build. Overriding `LinkProvider.client()` is the
 * documented Alepha service-substitution seam (`CLAUDE.md`: never
 * `vi.mock`/`vi.spyOn`) — `useClient` is a one-line `useInject(LinkProvider)
 * .client<T>()`, so substituting the provider substitutes every action call
 * `useFolioActions` makes, with no network and no real server.
 */
class FakeLinkProvider extends LinkProvider {
  updates: RecordedUpdate[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      update: async (config: {
        params: { id: string };
        body: Record<string, unknown>;
      }) => {
        this.updates.push({ id: config.params.id, body: config.body });
        const existing = this.currentFolio;
        const merged = {
          ...existing,
          ...config.body,
          updatedAt: new Date().toISOString(),
        };
        this.currentFolio = merged as Folio;
        return merged;
      },
      create: async () => {
        throw new Error("not used by this test");
      },
      delete: async () => {
        throw new Error("not used by this test");
      },
    };
  }

  // The fake's own tiny in-memory "row", seeded by the test and updated by
  // every recorded `update` call so a second save's `existing.protected`
  // reasoning is realistic.
  currentFolio: Folio = baseFolio();
}

describe("useFolioActions — envelope salt survives an in-session encrypt", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{ui}</DialogProvider>
      </AlephaContext.Provider>,
    );

  it("lets a save reach the network right after confirmEncrypt, without a reload", async ({
    expect,
  }) => {
    const folio = baseFolio();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    const fakeLink = alepha.inject(FakeLinkProvider);
    fakeLink.currentFolio = folio;

    let actions: UseFolioActionsResult | undefined;

    const Widget = () => {
      const draft = useFolioDraft(folio);
      actions = useFolioActions({
        folio,
        draft,
        createDirectory: () => {},
        panes: {
          tree: false,
          inspector: false,
          toggleTree: () => {},
          toggleInspector: () => {},
          toggleFocus: () => {},
          openHistory: () => {},
        },
        find: { show: () => {} },
        mode: { editing: true, toggle: () => {} },
        format: { run: () => {} },
      });
      return <div data-testid="update-count">{fakeLink.updates.length}</div>;
    };

    const { getByTestId } = mount(alepha, <Widget />);

    // Encrypt the clear folio in-session — the transition under test.
    const encryptResult = await actions?.confirmEncrypt("a real passphrase");
    expect(encryptResult).toBeNull();
    await waitFor(() =>
      expect(getByTestId("update-count").textContent).toBe("1"),
    );

    const encryptCall = fakeLink.updates[0];
    expect(encryptCall?.body.protected).toBe(true);
    const envelopeAfterEncrypt = JSON.parse(
      encryptCall?.body.content as string,
    );
    expect(typeof envelopeAfterEncrypt.salt).toBe("string");

    // A normal follow-up save, right after — no reload, no re-navigation.
    // Before the fix, this returned early inside `save()` (toaster.error +
    // `return`), so `folioApi.update` was never called a second time.
    await actions?.handlers["folio.save"]();
    await waitFor(() =>
      expect(getByTestId("update-count").textContent).toBe("2"),
    );

    const secondCall = fakeLink.updates[1];
    expect(secondCall?.body.protected).toBe(true);
    const envelopeAfterSave = JSON.parse(secondCall?.body.content as string);
    // Same envelope family — re-encrypted with the SAME salt `confirmEncrypt`
    // established, proving `save()` read the current salt rather than
    // failing to find one at all.
    expect(envelopeAfterSave.salt).toBe(envelopeAfterEncrypt.salt);
  });
});

/**
 * Regression guard for `applyReverted` (Task 10's inspector History tab).
 * `revertHistory` reverts the row server-side and hands back the new
 * state, but this hook's draft doesn't otherwise see it — `props.folio`
 * is the route-loader snapshot, frozen for the mount's lifetime, same as
 * everywhere else in this file. `applyReverted` is the function that
 * closes that gap by writing the reverted title/tags/content straight
 * into the live form and re-baselining `dirty`.
 */
describe("useFolioActions — applyReverted syncs the draft after a history revert", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{ui}</DialogProvider>
      </AlephaContext.Provider>,
    );

  const Widget = (props: {
    folio: Folio;
    onActions: (actions: UseFolioActionsResult) => void;
    onDraft?: (draft: FolioDraft) => void;
    onCreateDirectory?: () => void;
  }) => {
    const draft = useFolioDraft(props.folio);
    props.onDraft?.(draft);
    props.onActions(
      useFolioActions({
        folio: props.folio,
        draft,
        createDirectory: () => props.onCreateDirectory?.(),
        panes: {
          tree: false,
          inspector: false,
          toggleTree: () => {},
          toggleInspector: () => {},
          toggleFocus: () => {},
          openHistory: () => {},
        },
        find: { show: () => {} },
        mode: { editing: true, toggle: () => {} },
        format: { run: () => {} },
      }),
    );
    return (
      <div>
        <div data-testid="title">{draft.values.title}</div>
        <div data-testid="content">{draft.values.content}</div>
        <div data-testid="dirty">{String(draft.dirty)}</div>
        <div data-testid="savedAt">{draft.savedAt}</div>
      </div>
    );
  };

  it("writes the reverted title/tags/content into the draft and re-baselines dirty", async ({
    expect,
  }) => {
    const folio = baseFolio({
      title: "Original",
      tags: ["a"],
      content: "original body",
    });
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    alepha.inject(FakeLinkProvider).currentFolio = folio;

    let actions: UseFolioActionsResult | undefined;
    const { getByTestId } = mount(
      alepha,
      <Widget folio={folio} onActions={(a) => (actions = a)} />,
    );

    const reverted: Folio = {
      ...folio,
      title: "Reverted title",
      tags: ["b"],
      content: "reverted body",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    await actions?.applyReverted(reverted);

    await waitFor(() =>
      expect(getByTestId("title").textContent).toBe("Reverted title"),
    );
    expect(getByTestId("content").textContent).toBe("reverted body");
    // `dirty` reads false: the revert re-baselined the comparison target
    // together with the live values, not just one of the two — otherwise
    // the status line would falsely read "Unsaved changes" right after a
    // revert nobody has touched yet.
    expect(getByTestId("dirty").textContent).toBe("false");
    expect(getByTestId("savedAt").textContent).toBe("2026-01-02T00:00:00.000Z");
  });

  it("routes Folio ▸ New directory to the tree, instead of nowhere", async ({
    expect,
  }) => {
    const folio = baseFolio({ title: "Anything" });
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    alepha.inject(FakeLinkProvider).currentFolio = folio;

    let actions: UseFolioActionsResult | undefined;
    let created = 0;
    mount(
      alepha,
      <Widget
        folio={folio}
        onActions={(a) => (actions = a)}
        onCreateDirectory={() => created++}
      />,
    );

    // The menubar renders this entry enabled. It was bound to a shared
    // no-op on the document path, so clicking it did nothing at all - while
    // the workspace's own empty state had the same id wired to the same
    // tree action the whole time.
    void actions?.handlers["folio.newDirectory"]();
    expect(created).toBe(1);
  });

  it("does not paint ciphertext as if it were plaintext when a protected folio is reverted while locked", async ({
    expect,
  }) => {
    const folio = baseFolio({
      protected: true,
      content: JSON.stringify({
        v: 1,
        salt: "aa",
        iv: "bb",
        ciphertext: "cc",
        kdf: { iterations: 600_000 },
      }),
    });
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    alepha.inject(FakeLinkProvider).currentFolio = folio;

    let actions: UseFolioActionsResult | undefined;
    const { getByTestId } = mount(
      alepha,
      <Widget folio={folio} onActions={(a) => (actions = a)} />,
    );

    // No passphrase was ever entered this session, so there is no cached
    // key for this folio — `applyReverted` must leave the draft's content
    // untouched (still blank, per `useFolioDraft.initial()`'s protected
    // blanking) rather than write the reverted row's ciphertext into the
    // editor as if it had been decrypted.
    const reverted: Folio = {
      ...folio,
      content: JSON.stringify({
        v: 1,
        salt: "aa",
        iv: "dd",
        ciphertext: "ee",
        kdf: { iterations: 600_000 },
      }),
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    await actions?.applyReverted(reverted);

    expect(getByTestId("content").textContent).toBe("");
    // The row DID change server-side even though content couldn't be
    // shown — `savedAt` must still move to the reverted row's
    // `updatedAt` so `FolioHistoryTab`'s fetch effect (keyed on this
    // exact value, see `FolioInspector`'s `savedAt` prop) notices and
    // re-fetches the revision list. Before this fix, the locked branch
    // returned without ever calling `markSaved`, so this stayed frozen
    // at the folio's ORIGINAL `updatedAt` and the History tab needed its
    // own separate `refresh()` call to catch up — this is the assertion
    // that lets `FolioHistoryTab` drop that redundant call.
    await waitFor(() =>
      expect(getByTestId("savedAt").textContent).toBe(
        "2026-01-02T00:00:00.000Z",
      ),
    );
  });

  /**
   * Reviewer-found bug, round 2: `locked` (`isProtected && !unlocked`)
   * only tracks the React state `unlocked`, not whether a cached key
   * actually still exists — `ensureProtectedKeysAutoLock` can evict the
   * module-level cache in `protectedFolioKeys.ts` after an idle window
   * WITHOUT resetting `unlocked`. So the folio can be genuinely
   * `unlocked === true` (fields editable, real edits in the buffer) at
   * the exact moment a revert lands with no cached key — the SAME
   * `!cachedKey` branch the "locked" test above exercises, but reached
   * from a state where the previous test's assumption ("nothing could
   * have been typed") does not hold.
   */
  it("keeps a diverged live buffer marked unsaved when a revert lands after the cached key was evicted but unlocked is still true", async ({
    expect,
  }) => {
    const folio = baseFolio();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    alepha.inject(FakeLinkProvider).currentFolio = folio;

    let actions: UseFolioActionsResult | undefined;
    let draft: FolioDraft | undefined;
    const { getByTestId } = mount(
      alepha,
      <Widget
        folio={folio}
        onActions={(a) => (actions = a)}
        onDraft={(d) => (draft = d)}
      />,
    );

    // Genuinely unlock the folio in-session (same real crypto path the
    // OTHER describe block above already proves works in this
    // environment) — `unlocked` flips `true`, a real key gets cached.
    const encryptResult = await actions?.confirmEncrypt("a real passphrase");
    expect(encryptResult).toBeNull();

    // Evict the cache the way the idle-timeout auto-lock does, WITHOUT
    // touching `unlocked` — this is the exact gap the bug lives in.
    // `locked` (`isProtected && !unlocked`) still reads `false` here.
    forgetProtectedKey(folio.id);

    // The user is mid-edit: real, un-persisted content sitting in the
    // live buffer, diverged from what was last saved.
    draft?.form.input.content.set("live edit nobody saved yet");
    await waitFor(() =>
      expect(getByTestId("content").textContent).toBe(
        "live edit nobody saved yet",
      ),
    );
    expect(getByTestId("dirty").textContent).toBe("true");

    const reverted: Folio = {
      ...folio,
      protected: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    await actions?.applyReverted(reverted);

    // Wait for `savedAt` to reach the reverted row's timestamp FIRST —
    // `savedAt` is `useState`, so `applyReverted`'s `setSavedAt` call is
    // not guaranteed to have flushed into the DOM by the time the
    // `await` above merely resolves (that promise settles once the
    // synchronous body of `applyReverted` finishes; the React re-render
    // it triggers is a separate, deferred step). Reading `dirty` and
    // `content` from the DOM before this wait would risk observing the
    // PRE-`applyReverted` render — where they already happened to read
    // "true" / the live edit for an unrelated reason (nothing had
    // reverted yet) — which would pass in both the fixed and the broken
    // version and prove nothing. Waiting for `savedAt` to move is a
    // value that MUST change on a genuine update, so it's what actually
    // pins "the post-revert render has landed" before asserting on it.
    await waitFor(() =>
      expect(getByTestId("savedAt").textContent).toBe(
        "2026-01-02T00:00:00.000Z",
      ),
    );
    // NOW check the property under test, on a render we know reflects
    // `applyReverted`'s outcome: the live edit must survive untouched,
    // and `dirty` must NOT have flipped to `false` — that would be the
    // status line falsely reporting "Saved" over content the server has
    // never seen and this session never sent.
    expect(getByTestId("content").textContent).toBe(
      "live edit nobody saved yet",
    );
    expect(getByTestId("dirty").textContent).toBe("true");
  });
});

/**
 * The auto-lock empties the key cache on a timer
 * (`ensureProtectedKeysAutoLock`), with no user action behind it and nothing
 * to re-render. `unlocked` stayed `true`, so the editor believed it was still
 * unlocked: its fields stayed editable, every autosave failed with a toast,
 * the locked panel never appeared, and a reload lost whatever had been typed
 * since the eviction.
 *
 * And separately: after a revert performed while locked, `unlock()` decrypted
 * `input.folio.content` - the route-loader snapshot, i.e. the PRE-revert
 * envelope - so the editor showed the old content and the next autosave wrote
 * it back over the revert.
 */
describe("useFolioActions — the key cache and the current envelope", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{ui}</DialogProvider>
      </AlephaContext.Provider>,
    );

  const Widget = (props: {
    folio: Folio;
    onActions: (actions: UseFolioActionsResult) => void;
    onDraft?: (draft: FolioDraft) => void;
  }) => {
    const draft = useFolioDraft(props.folio);
    props.onDraft?.(draft);
    const actions = useFolioActions({
      folio: props.folio,
      draft,
      createDirectory: () => {},
      panes: {
        tree: false,
        inspector: false,
        toggleTree: () => {},
        toggleInspector: () => {},
        toggleFocus: () => {},
        openHistory: () => {},
      },
      find: { show: () => {} },
      mode: { editing: true, toggle: () => {} },
      format: { run: () => {} },
    });
    props.onActions(actions);
    return (
      <div>
        <div data-testid="content">{draft.values.content}</div>
        <div data-testid="dirty">{String(draft.dirty)}</div>
        <div data-testid="locked">{String(actions.locked)}</div>
      </div>
    );
  };

  const setup = () => {
    const folio = baseFolio();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    const link = alepha.inject(FakeLinkProvider);
    link.currentFolio = folio;

    let actions: UseFolioActionsResult | undefined;
    let draft: FolioDraft | undefined;
    const dom = mount(
      alepha,
      <Widget
        folio={folio}
        onActions={(a) => (actions = a)}
        onDraft={(d) => (draft = d)}
      />,
    );

    return {
      alepha,
      link,
      folio,
      dom,
      actions: () => actions!,
      draft: () => draft!,
    };
  };

  it("flips the editor back to locked when the key is evicted", async ({
    expect,
  }) => {
    const ctx = setup();
    expect(await ctx.actions().confirmEncrypt("a real passphrase")).toBeNull();
    await waitFor(() =>
      expect(ctx.dom.getByTestId("locked").textContent).toBe("false"),
    );

    // Exactly what the idle timer does.
    forgetAllProtectedKeys();

    await waitFor(() =>
      expect(ctx.dom.getByTestId("locked").textContent).toBe("true"),
    );
  });

  it("keeps the pending draft when the key comes back", async ({ expect }) => {
    const ctx = setup();
    expect(await ctx.actions().confirmEncrypt("a real passphrase")).toBeNull();

    // Mid-edit when the auto-lock fires.
    ctx.draft().form.input.content.set("typed after the encrypt");
    await waitFor(() =>
      expect(ctx.dom.getByTestId("dirty").textContent).toBe("true"),
    );
    forgetAllProtectedKeys();
    await waitFor(() =>
      expect(ctx.dom.getByTestId("locked").textContent).toBe("true"),
    );

    expect(await ctx.actions().unlock("a real passphrase")).toBeNull();

    await waitFor(() =>
      expect(ctx.dom.getByTestId("locked").textContent).toBe("false"),
    );
    // The buffer is the user's own unsaved work, not a stale copy of the
    // server's. Overwriting it with the decrypted plaintext here would
    // discard everything typed since the eviction.
    expect(ctx.dom.getByTestId("content").textContent).toBe(
      "typed after the encrypt",
    );
    // And still unsaved, so the autosave that resumes persists it.
    expect(ctx.dom.getByTestId("dirty").textContent).toBe("true");
  });

  it("unlocks into the reverted envelope, not the one the route loaded", async ({
    expect,
  }) => {
    const ctx = setup();
    expect(await ctx.actions().confirmEncrypt("a real passphrase")).toBeNull();

    // The envelope `confirmEncrypt` just wrote, so a second one can be built
    // in the same family (same salt, same iterations, same passphrase).
    const stored = ctx.link.updates.at(-1)!.body.content as string;
    const envelope = JSON.parse(stored) as {
      salt: string;
      kdf: { iterations: number };
    };
    const crypto = ctx.alepha.inject(CryptoProvider);
    const key = await crypto.deriveKeyFromPassphrase(
      "a real passphrase",
      envelope.salt,
      envelope.kdf.iterations,
    );
    const revertedEnvelope = await crypto.encryptWithPassphrase(
      "the reverted body",
      key,
      envelope.salt,
      envelope.kdf.iterations,
    );

    // Lock, then revert. The locked branch of `applyReverted` cannot
    // decrypt, so it leaves the buffer alone - which is correct, and is
    // exactly why `unlock` has to know the envelope moved.
    forgetAllProtectedKeys();
    await waitFor(() =>
      expect(ctx.dom.getByTestId("locked").textContent).toBe("true"),
    );
    await ctx.actions().applyReverted({
      ...ctx.folio,
      protected: true,
      content: revertedEnvelope,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(await ctx.actions().unlock("a real passphrase")).toBeNull();

    await waitFor(() =>
      expect(ctx.dom.getByTestId("content").textContent).toBe(
        "the reverted body",
      ),
    );
  });
});
