import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { StorageStats } from "alepha/api/files";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

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

  const mount = async (value: StorageStats) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminFilesUsageCard stats={value} />
      </AlephaContext.Provider>,
    );
  };

  const legend = () =>
    screen.getAllByRole("listitem").map((item) => item.textContent);

  const segment = (view: ReturnType<typeof render>, bucket: string) =>
    view.container.querySelector<HTMLElement>(`[data-bucket="${bucket}"]`);

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

    expect(segment(view, "artifacts")?.style.width).toBe(
      `${((150 * MB) / (10 * GB)) * 100}%`,
    );
  });

  it("without a quota, says what is used and splits the bar between buckets", async () => {
    const view = await mount(stats(0));
    const text = view.container.textContent;

    expect(text).toContain("200.0 MB");
    expect(text).toContain("used");
    expect(text).toContain("14 file(s), no quota");
    expect(text).not.toContain("free");
    expect(segment(view, "artifacts")?.style.width).toBe(
      `${((150 * MB) / (200 * MB + 1024)) * 100}%`,
    );
  });

  it("opens a panel of that bucket's figures when a segment is clicked", async () => {
    // Was a tooltip on both the segment and the legend entry: unreadable on a
    // touch screen, and the same sentence twice.
    const view = await mount(stats(10 * GB));

    fireEvent.click(segment(view, "backups")!);

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

  it("names each segment for a reader who cannot see the bar", async () => {
    const view = await mount(stats(10 * GB));

    expect(segment(view, "artifacts")!.getAttribute("aria-label")).toBe(
      "artifacts: 150.0 MB",
    );
  });

  it("leaves the quota row out when there is no quota", async () => {
    const view = await mount(stats(0));

    fireEvent.click(segment(view, "backups")!);

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
});
