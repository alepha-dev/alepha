import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminDetailAside } from "../admin-detail-aside.tsx";

/**
 * The identity panel shared by every detail page. What it pins is the row
 * contract: a `copy` row renders its own value and a working copy button, a
 * plain row renders exactly what it was given, and the copy affordance names
 * the row it belongs to — a page with several copyable rows would otherwise
 * offer a screen reader several buttons all called "Copy".
 */
describe("AdminDetailAside", () => {
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
      <AdminDetailAside
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
      <AdminDetailAside
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
      <AdminDetailAside
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
      <AdminDetailAside
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
    await mount(<AdminDetailAside title="bague aurore" rows={[]} />);

    expect(screen.getByText("B")).toBeTruthy();
  });
});
