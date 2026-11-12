import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { StorageStats } from "alepha/api/files";
import { AlephaContext } from "alepha/react";
import { $dictionary, AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { uiFr } from "../../i18n/fr/uiFr.ts";
import { AdminFilesUsageCard } from "../AdminFilesUsageCard.tsx";

const MB = 1024 * 1024;
const GB = 1024 * MB;

const stats = (quota: number): StorageStats => ({
  totalSize: 150 * MB + 50 * MB + 1024,
  totalFiles: 14,
  byBucket: [
    { bucket: "backups", totalSize: 50 * MB, fileCount: 3 },
    { bucket: "seeds", totalSize: 1024, fileCount: 1 },
    { bucket: "artifacts", totalSize: 150 * MB, fileCount: 10 },
  ],
  byMimeType: [],
  quota,
});

/**
 * The storage tile of the admin Files page (#Q2412): used of the quota, the
 * free space, a bar split by bucket, a legend.
 */
describe("AdminFilesUsageCard", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (value: StorageStats, persistenceKey?: string) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminFilesUsageCard stats={value} persistenceKey={persistenceKey} />
      </AlephaContext.Provider>,
    );
  };

  const legend = () =>
    screen.getAllByRole("listitem").map((item) => item.textContent);

  const segment = (view: ReturnType<typeof render>, bucket: string) =>
    view.container.querySelector<HTMLElement>(`[data-bucket="${bucket}"]`);

  const entry = (view: ReturnType<typeof render>, bucket: string) =>
    view.container.querySelector<HTMLElement>(
      `[data-legend-bucket="${bucket}"]`,
    );

  // A segment's width in percent. jsdom, like a browser, serializes a CSS
  // percentage to six significant digits, so it is compared as a number.
  const width = (view: ReturnType<typeof render>, bucket: string) =>
    Number.parseFloat(segment(view, bucket)?.style.width ?? "0");

  it("says what is used out of the quota, and what is free", async () => {
    const view = await mount(stats(10 * GB));
    const text = view.container.textContent;

    expect(text).toContain("200.0 MB");
    expect(text).toContain("of 10.0 GB used");
    expect(text).toContain("9.8 GB free · 2% used");
  });

  it("lists the buckets largest first, with their sizes", async () => {
    await mount(stats(10 * GB));

    expect(legend()).toEqual([
      "artifacts150.0 MB",
      "backups50.0 MB",
      "seeds1.0 KB",
    ]);
  });

  it("draws each bucket as its share of the quota", async () => {
    const view = await mount(stats(10 * GB));

    expect(width(view, "artifacts")).toBeCloseTo(
      ((150 * MB) / (10 * GB)) * 100,
      3,
    );
  });

  it("without a quota, says what is used and splits the bar between buckets", async () => {
    const view = await mount(stats(0));
    const text = view.container.textContent;

    expect(text).toContain("200.0 MB");
    expect(text).toContain("used");
    expect(text).toContain("14 files, no quota");
    expect(text).not.toContain("free");
    expect(width(view, "artifacts")).toBeCloseTo(
      ((150 * MB) / (200 * MB + 1024)) * 100,
      3,
    );
  });

  /**
   * The file count is a plural entry (#Q3360): its English is the call site's
   * `default`, its French `uiFr`'s, and French `one` covers 0.
   */
  it.each([
    ["en", 0, "0 files, no quota"],
    ["en", 1, "1 file, no quota"],
    ["en", 2, "2 files, no quota"],
    ["fr", 0, "0 fichier, sans quota"],
    ["fr", 1, "1 fichier, sans quota"],
    ["fr", 2, "2 fichiers, sans quota"],
  ])("counts the files in %s for %d", async (lang, totalFiles, expected) => {
    class Catalogs {
      en = $dictionary({ lazy: async () => ({ default: {} }) });
      fr = $dictionary({ lazy: async () => ({ default: { ...uiFr } }) });
    }
    alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(Catalogs);
    // The store, not `setLang`: `setLang` writes the `lang` cookie, which
    // jsdom keeps for every later test of the file.
    alepha.store.set("alepha.react.i18n.lang", lang);
    await alepha.start();
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <AdminFilesUsageCard stats={{ ...stats(0), totalFiles }} />
      </AlephaContext.Provider>,
    );

    expect(view.container.textContent).toContain(expected);
  });

  it("opens a panel of that bucket's figures when its legend entry is clicked", async () => {
    // Was a tooltip on both the segment and the legend entry (unreadable on a
    // touch screen), then a click on the segment, a 12x10 px target for a
    // small bucket (#Q3488).
    const view = await mount(stats(10 * GB));

    fireEvent.click(entry(view, "backups")!);

    const panel = await screen.findByRole("dialog");
    expect(panel.textContent).toContain("50.0 MB");
    // 3 of the bucket's files, 0.5% of a 10 GB quota, 25% of 200 MB used.
    expect(panel.textContent).toContain("Files");
    expect(panel.textContent).toContain("3");
    expect(panel.textContent).toContain("Share of quota");
    expect(panel.textContent).toContain("0.5%");
    expect(panel.textContent).toContain("Share of used");
    expect(panel.textContent).toContain("25%");
  });

  it("names each legend entry, and hides the decorative bar", async () => {
    const view = await mount(stats(10 * GB));

    // Named by its visible text, so the name says what the eye reads.
    expect(entry(view, "artifacts")!.hasAttribute("aria-label")).toBe(false);
    expect(entry(view, "artifacts")!.textContent).toBe("artifacts150.0 MB");
    expect(entry(view, "artifacts")!.className).toContain("min-h-6");
    expect(
      segment(view, "artifacts")!.parentElement!.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(segment(view, "artifacts")!.tagName).toBe("DIV");
  });

  it("leaves the quota row out when there is no quota", async () => {
    const view = await mount(stats(0));

    fireEvent.click(entry(view, "backups")!);

    const panel = await screen.findByRole("dialog");
    expect(panel.textContent).toContain("Share of used");
    expect(panel.textContent).not.toContain("Share of quota");
  });

  it("picks one bucket out when its legend entry is hovered", async () => {
    const view = await mount(stats(10 * GB));

    fireEvent.mouseEnter(screen.getByText("backups"));

    expect(segment(view, "backups")?.className).not.toContain("opacity-30");
    expect(segment(view, "artifacts")?.className).toContain("opacity-30");

    fireEvent.mouseLeave(screen.getByText("backups"));

    expect(segment(view, "artifacts")?.className).not.toContain("opacity-30");
  });
  describe("the bar's mode (#Q2500)", () => {
    const shareOption = () => screen.getByRole("radio", { name: "Share" });
    const quotaOption = () => screen.getByRole("radio", { name: "Of quota" });

    it("draws against the quota by default, with the toggle at the top", async () => {
      const view = await mount(stats(10 * GB));

      expect(quotaOption().getAttribute("aria-checked")).toBe("true");
      expect(width(view, "artifacts")).toBeCloseTo(
        ((150 * MB) / (10 * GB)) * 100,
        3,
      );
      expect(screen.queryAllByTestId("usage-share")).toEqual([]);
    });

    it("fills the bar with the used total in share mode, each bucket its percentage", async () => {
      const view = await mount(stats(10 * GB));

      fireEvent.click(shareOption());

      const total = 150 * MB + 50 * MB + 1024;
      const widths = ["artifacts", "backups", "seeds"].map((bucket) =>
        width(view, bucket),
      );
      expect(widths[0]).toBeCloseTo(((150 * MB) / total) * 100, 3);
      expect(widths.reduce((sum, w) => sum + w, 0)).toBeCloseTo(100, 3);
      expect(
        screen.getAllByTestId("usage-share").map((node) => node.textContent),
      ).toEqual(["75%", "25%", "0%"]);
    });

    it("remembers the mode under the persistence key", async () => {
      window.localStorage.removeItem("usage-spec.usageMode");
      await mount(stats(10 * GB), "usage-spec");
      fireEvent.click(shareOption());
      expect(window.localStorage.getItem("usage-spec.usageMode")).toBe(
        '"share"',
      );

      await alepha?.stop();
      document.body.innerHTML = "";
      await mount(stats(10 * GB), "usage-spec");
      expect(shareOption().getAttribute("aria-checked")).toBe("true");
      window.localStorage.removeItem("usage-spec.usageMode");
    });

    it("offers no toggle without a quota", async () => {
      await mount(stats(0));
      expect(screen.queryByRole("radio", { name: "Share" })).toBeNull();
    });
  });
});
