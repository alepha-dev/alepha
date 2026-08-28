import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../ui/sonner.tsx";
import { DialogProvider, useDialog } from "../use-dialog.tsx";

/**
 * Pins the standalone recipe documented on `AccountRouter` and `AdminRouter`.
 *
 * Neither shell mounts these providers itself - a second `<Toaster />` under
 * an application that already has one shows every toast twice - so the JSDoc
 * tells you to wrap them. That instruction is only worth writing if the two
 * lines it gives actually work, and if the failure without them is the clear
 * throw the doc claims rather than something subtler.
 */
describe("useDialog provider requirement", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const Consumer = () => {
    useDialog();
    return <span>mounted</span>;
  };

  const mount = async (element: React.ReactElement) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
    );
  };

  it("throws by name when no DialogProvider is above it", async () => {
    await expect(mount(<Consumer />)).rejects.toThrow(
      "useDialog requires <DialogProvider>",
    );
  });

  it("mounts under the two lines the routers' JSDoc gives", async () => {
    await mount(
      <DialogProvider>
        <Toaster />
        <Consumer />
      </DialogProvider>,
    );

    expect(screen.getByText("mounted")).toBeTruthy();
  });
});
