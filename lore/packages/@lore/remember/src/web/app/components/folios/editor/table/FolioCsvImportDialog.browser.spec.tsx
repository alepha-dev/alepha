import { DialogProvider } from "@alepha/ui";
import { I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, expect, it } from "vitest";

import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
// Imported at the top: the tree and the grid load it as a lazy chunk.
import FolioCsvImportDialog, {
  type FolioCsvImportTarget,
} from "./FolioCsvImportDialog.tsx";

/**
 * The CSV import dialog's preview (#Q3517): what is read, what is guessed,
 * and what is refused before anything is written.
 */
describe("FolioCsvImportDialog", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (target: FolioCsvImportTarget, file: File) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <FolioCsvImportDialog
            open
            onOpenChange={() => {}}
            target={target}
            file={file}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  const csv = (text: string, name = "budget.csv") =>
    new File([text], name, { type: "text/csv" });

  it("previews the rows, with RFC 4180 quoting and a type guessed per column", async () => {
    await mount(
      { kind: "new" },
      csv(
        '﻿Name;Amount;Due;Done\n"Smith; J";12;2026-11-20;true\n"Line\nbreak";3,5x;2026-11-21;false\n',
      ),
    );
    await waitFor(() => expect(screen.getByText("Smith; J")).toBeTruthy());
    expect(screen.getByText(/Line\s+break/)).toBeTruthy();
    const types = screen
      .getAllByRole("combobox")
      .map((it) => it.textContent?.trim());
    expect(types).toEqual(["text", "text", "date", "checkbox"]);
    expect(screen.getByRole("button", { name: "Import 2 rows" })).toBeTruthy();
  });

  it("refuses a file over the caps before any write", async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `r${i}`).join("\n");
    await mount({ kind: "new" }, csv(`Name\n${rows}\n`));
    await waitFor(() =>
      expect(screen.getByText(/has 2001 rows and 1 columns/)).toBeTruthy(),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Import 2001 rows",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("lists the columns an open table has no name for, without regard to case", async () => {
    const columns: FolioColumnResource[] = [
      { id: "a", position: 0, name: "Name", type: "text", options: {} },
    ];
    await mount(
      { kind: "into", folioId: "f", columns },
      csv("name,Extra\nAnother,ignored\n"),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/No column of this table is named: Extra/),
      ).toBeTruthy(),
    );
    expect(screen.queryAllByRole("combobox")).toEqual([]);
  });

  it("reads the first line as a row when told it is not a header", async () => {
    await mount({ kind: "new" }, csv("a,b\nc,d\n"));
    await waitFor(() => expect(screen.getByText("c")).toBeTruthy());
    fireEvent.click(
      screen
        .getAllByLabelText("The first line names the columns")
        .find(
          (it) =>
            it.tagName !== "INPUT" ||
            (it as HTMLInputElement).type !== "hidden",
        )!,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Import 2 rows" }),
      ).toBeTruthy(),
    );
  });
});
