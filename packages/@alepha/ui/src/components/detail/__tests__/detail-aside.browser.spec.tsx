import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DetailAside } from "../detail-aside.tsx";

/**
 * The identity panel shared by every detail page. What it pins is the row
 * contract: a `copy` row renders its own value and a working copy button, a
 * plain row renders exactly what it was given, and the copy affordance names
 * the row it belongs to — a page with several copyable rows would otherwise
 * offer a screen reader several buttons all called "Copy".
 */
describe("DetailAside", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("renders the title and each row's label and value", async () => {
    await mount(
      <DetailAside
        title="Bague Aurore"
        rows={[
          { label: "Reference", value: <span>bague-aurore</span> },
          { label: "Price", value: "89,00 €" },
        ]}
      />,
    );

    expect(screen.getByText("Bague Aurore")).toBeTruthy();
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("bague-aurore")).toBeTruthy();
    expect(screen.getByText("89,00 €")).toBeTruthy();
  });

  it("renders a copy row's text as its own value", async () => {
    await mount(
      <DetailAside
        title="Bague Aurore"
        rows={[{ label: "ID", copy: "0192aaaa-0000-7000-8000-000000000001" }]}
      />,
    );

    expect(
      screen.getByText("0192aaaa-0000-7000-8000-000000000001"),
    ).toBeTruthy();
  });

  it("names the copy button after its row", async () => {
    await mount(
      <DetailAside
        title="Bague Aurore"
        rows={[
          { label: "ID", copy: "id-1" },
          { label: "Reference", copy: "bague-aurore" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Copy ID" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Reference" })).toBeTruthy();
  });

  it("writes the row's copy text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await mount(
      <DetailAside
        title="Bague Aurore"
        rows={[
          { label: "ID", copy: "id-1" },
          { label: "Reference", copy: "bague-aurore" },
        ]}
      />,
    );

    screen.getByRole("button", { name: "Copy Reference" }).click();

    expect(writeText).toHaveBeenCalledWith("bague-aurore");
  });

  it("falls back to the title's initial when there is no image", async () => {
    await mount(<DetailAside title="bague aurore" rows={[]} />);

    expect(screen.getByText("B")).toBeTruthy();
  });

  it("renders no header at all with neither title nor avatar", async () => {
    await mount(
      <DetailAside
        avatar={false}
        rows={[{ label: "Reference", value: "bague-aurore" }]}
      />,
    );

    // The row survives; nothing above it does. Guards the case a caller
    // reaches for when a breadcrumb already names the thing.
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.queryAllByText("?")).toHaveLength(0);
  });

  it("drops the avatar entirely on avatar={false}", async () => {
    await mount(<DetailAside avatar={false} title="bague aurore" rows={[]} />);

    // The initial and nothing else — asserted as the ABSENCE of the "B",
    // because the title is still rendered and starts with the same letter.
    // `queryAllByText` on the exact string is what separates the avatar's
    // lone initial from the title beside it.
    expect(screen.queryAllByText("B")).toHaveLength(0);
    expect(screen.getByText("bague aurore")).toBeTruthy();
  });
});
