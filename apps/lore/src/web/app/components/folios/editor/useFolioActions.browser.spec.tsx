import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";
import type { Folio } from "@/api/entities/folios.ts";
import {
  type UseFolioActionsResult,
  useFolioActions,
} from "./useFolioActions.ts";
import { useFolioDraft } from "./useFolioDraft.ts";

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

  // biome-ignore lint/suspicious/noExplicitAny: matches the real client's own loose virtual-action shape
  override client<T extends object>(): any {
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
        panes: {
          tree: false,
          inspector: false,
          toggleTree: () => {},
          toggleInspector: () => {},
          toggleFocus: () => {},
        },
        find: { show: () => {} },
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
  }) => {
    const draft = useFolioDraft(props.folio);
    props.onActions(
      useFolioActions({
        folio: props.folio,
        draft,
        panes: {
          tree: false,
          inspector: false,
          toggleTree: () => {},
          toggleInspector: () => {},
          toggleFocus: () => {},
        },
        find: { show: () => {} },
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
});
