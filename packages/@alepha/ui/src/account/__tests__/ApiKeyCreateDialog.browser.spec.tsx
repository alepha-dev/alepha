import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { ApiKeyOptionsResponse } from "alepha/api/keys";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { AlephaServerLinks } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { ApiKeyCreateDialog } from "../ApiKeyCreateDialog.tsx";

/**
 * The scope half of the create dialog: full access by default, a matrix only
 * when asked for, and every permission the caller may grant on it, labelled
 * or not.
 */
const OPTIONS: ApiKeyOptionsResponse = {
  expiry: { default: "90d", maxDays: 0, presets: ["7d", "90d", "never"] },
  permissions: {
    groups: [
      {
        name: "reports",
        label: "Reports",
        permissions: [
          { name: "reports:read", label: "Read reports" },
          { name: "reports:export", label: "Export reports" },
        ],
      },
      {
        // The framework's own permissions carry no label, and they are what
        // a CI key gets scoped to: they must render, by their raw names.
        name: "api-key",
        permissions: [{ name: "api-key:create" }],
      },
    ],
  },
};

describe("ApiKeyCreateDialog scope", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
    alepha = Alepha.create().with(AlephaReactI18n).with(AlephaServerLinks);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ApiKeyCreateDialog
            open
            onOpenChange={() => {}}
            onCreated={() => {}}
            options={OPTIONS}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  const cell = (permission: string) =>
    document.querySelector(
      `[aria-label="${permission}"]`,
    ) as HTMLElement | null;

  const isChecked = (element: HTMLElement) =>
    element.getAttribute("data-checked") !== null ||
    element.getAttribute("aria-checked") === "true";

  it("gives full access by default, with no matrix to read", async () => {
    await mount();

    expect(screen.getByText("Full access")).toBeTruthy();
    expect(cell("reports:read")).toBeNull();
  });

  it("reveals the matrix when permissions are to be selected, and hides it again", async () => {
    await mount();

    fireEvent.click(screen.getByText("Select permissions"));
    expect(cell("reports:read")).not.toBeNull();

    fireEvent.click(screen.getByText("Full access"));
    expect(cell("reports:read")).toBeNull();
  });

  it("selects permissions group by group, and keeps an unlabelled group by its raw name", async () => {
    await mount();
    fireEvent.click(screen.getByText("Select permissions"));

    // Labelled group and rows render their labels.
    expect(screen.getByText("Reports")).toBeTruthy();
    expect(screen.getByText("Read reports")).toBeTruthy();
    // The unlabelled group and row are not dropped.
    expect(screen.getAllByText("api-key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("api-key:create").length).toBeGreaterThan(0);

    fireEvent.click(cell("reports:read")!);
    fireEvent.click(cell("api-key:create")!);

    expect(isChecked(cell("reports:read")!)).toBe(true);
    expect(isChecked(cell("api-key:create")!)).toBe(true);
    expect(isChecked(cell("reports:export")!)).toBe(false);
  });

  it("keeps a name typed before the options arrive, and then preselects their default", async () => {
    // Found by the apps/ui e2e: the form was rebuilt when the options landed,
    // and a name typed while they were in flight was silently wiped.
    alepha = Alepha.create().with(AlephaReactI18n).with(AlephaServerLinks);
    await alepha.start();
    const tree = (options?: ApiKeyOptionsResponse) => (
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ApiKeyCreateDialog
            open
            onOpenChange={() => {}}
            onCreated={() => {}}
            options={options}
          />
        </DialogProvider>
      </AlephaContext.Provider>
    );

    const view = render(tree());
    const name = () =>
      document.querySelector('input[name="name"]') as HTMLInputElement;
    fireEvent.change(name(), { target: { value: "CI pipeline" } });
    expect(name().value).toBe("CI pipeline");

    view.rerender(tree(OPTIONS));

    expect(name().value).toBe("CI pipeline");
    expect(
      screen.getByRole("combobox", { name: /Expires after/ }).textContent,
    ).toContain("90 days");
  });
});
