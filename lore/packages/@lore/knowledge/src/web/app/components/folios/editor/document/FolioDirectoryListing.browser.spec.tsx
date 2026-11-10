import { I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, expect, it } from "vitest";

import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import FolioDirectoryListing, {
  type FolioDirectoryListingProps,
} from "./FolioDirectoryListing.tsx";

const SPECS = "11111111-1111-4111-8111-111111111111";
const DRAFTS = "22222222-2222-4222-8222-222222222222";
const EMPTY = "33333333-3333-4333-8333-333333333333";

class Routes {
  folio = $page({
    name: "projectFoliosFolio",
    path: "/:projectSlug/folios/:shortId",
    component: () => null,
  });
  folios = $page({
    name: "projectFolios",
    path: "/:projectSlug/folios",
    component: () => null,
  });
}

const folioOf = (
  shortId: number,
  title: string,
  directoryId?: string,
  extra: { summary?: string; updatedAt?: string; pinned?: boolean } = {},
) => ({
  id: `4444444${shortId}-4444-4444-8444-444444444444`,
  shortId,
  projectId: 1,
  title,
  summary: extra.summary ?? "",
  directoryId,
  pinned: extra.pinned ?? false,
  protected: false,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: extra.updatedAt ?? "2026-09-04T10:00:00.000Z",
});

/**
 * The listing the empty folio workspace shows. It reads the tree's two
 * atoms, so seeding them is the whole fixture: no client, no fetch.
 */
describe("FolioDirectoryListing", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: Partial<FolioDirectoryListingProps> = {}) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    alepha.store.set(projectDirectoriesAtom, [
      { id: SPECS, shortId: 1, name: "specs" },
      { id: DRAFTS, shortId: 2, name: "drafts", parentId: SPECS },
      { id: EMPTY, shortId: 3, name: "empty" },
    ]);
    alepha.store.set(userFoliosAtom, [
      folioOf(1, "Zebra at the root", undefined, {
        updatedAt: "2026-09-01T10:00:00.000Z",
      }),
      folioOf(2, "Alpha at the root", undefined, {
        summary: "What the alpha folio decides.",
        pinned: true,
        updatedAt: "2026-09-02T10:00:00.000Z",
      }),
      folioOf(3, "Planning", SPECS),
    ]);

    return render(
      <AlephaContext.Provider value={alepha}>
        <FolioDirectoryListing projectSlug="club" {...props} />
      </AlephaContext.Provider>,
    );
  };

  const rowTexts = (): string[] =>
    Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        "[data-slot=folio-directory-listing] a[href]",
      ),
    )
      .filter((a) => a.closest("nav") === null)
      .map((a) => a.textContent ?? "");

  it("lists the root: directories first, then folios by name, with summary and pin", async () => {
    await mount();

    const rows = rowTexts();
    expect(rows[0]).toContain("empty");
    expect(rows[1]).toContain("specs");
    expect(rows[1]).toContain("2 items");
    expect(rows[2]).toContain("Alpha at the root");
    expect(rows[3]).toContain("Zebra at the root");
    expect(rows).toHaveLength(4);

    expect(screen.getByText("What the alpha folio decides.")).not.toBeNull();
    expect(screen.getByLabelText("Pinned")).not.toBeNull();
    expect(
      screen.getByText("Alpha at the root").closest("a")?.getAttribute("href"),
    ).toBe("/club/folios/2");
    expect(screen.getByText("specs").closest("a")?.getAttribute("href")).toBe(
      "/club/folios?dir=1",
    );
  });

  it("sorts folios newest first when Updated is clicked", async () => {
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /Updated/ }));

    const rows = rowTexts();
    expect(rows[2]).toContain("Alpha at the root");
    expect(rows[3]).toContain("Zebra at the root");

    fireEvent.click(screen.getByRole("button", { name: /Updated/ }));
    expect(rowTexts()[2]).toContain("Zebra at the root");
  });

  it("lists a directory with its breadcrumb and a parent row", async () => {
    await mount({ directoryShortId: 2 });

    const nav = screen.getByRole("navigation");
    expect(nav.textContent).toBe("Foliosspecsdrafts");
    expect(screen.getByText("specs").closest("a")?.getAttribute("href")).toBe(
      "/club/folios?dir=1",
    );
    expect(screen.getByLabelText("Parent directory").getAttribute("href")).toBe(
      "/club/folios?dir=1",
    );
    expect(screen.getByText("This directory is empty.")).not.toBeNull();
  });

  it("falls back to the root for a directory that no longer exists", async () => {
    await mount({ directoryShortId: 99 });

    expect(screen.queryByLabelText("Parent directory")).toBeNull();
    expect(rowTexts()).toHaveLength(4);
  });

  it("creates in the listed directory, and offers no button to a reader who cannot", async () => {
    const created: Array<string | undefined> = [];
    const view = await mount({
      directoryShortId: 1,
      onCreateFolio: (id) => created.push(id),
      onCreateDirectory: (id) => created.push(`dir:${id}`),
    });

    fireEvent.click(screen.getByRole("button", { name: /New folio/ }));
    fireEvent.click(screen.getByRole("button", { name: /New directory/ }));
    expect(created).toEqual([SPECS, `dir:${SPECS}`]);

    view.unmount();
    await alepha?.stop();
    await mount();
    expect(screen.queryByRole("button", { name: /New folio/ })).toBeNull();
  });
});
