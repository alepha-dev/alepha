import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { virtualClientFake } from "@/testing/virtualClientFake.ts";

import { I18n } from "../../services/I18n.ts";
import MyInvitations from "./MyInvitations.tsx";

/**
 * Holds `declineInvitation` open until the test lets it fail.
 */
class FakeLinkProvider extends LinkProvider {
  release?: () => void;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      declineInvitation: () =>
        new Promise((_resolve, reject) => {
          this.release = () =>
            reject(new Error("Invitation already answered (spec)"));
        }),
    });
  }
}

const invitation = (id: string, projectTitle: string) =>
  ({
    id,
    resourceId: "7",
    projectTitle,
    inviterName: "Ada",
  }) as never;

/**
 * The epic's before-and-after page (#E59, #Q2325). A refused decline was
 * caught and toasted by hand; it is toasted once by the root listener now.
 * And busy is page-wide: `run()` drops a call made while one is in flight,
 * so every row's buttons wait, not only the row that was clicked.
 */
describe("MyInvitations", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("holds every row while a decline runs, and toasts its refusal once", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const fake = alepha.inject(FakeLinkProvider);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <MyInvitations
            invitations={[
              invitation("inv-1", "Atlas"),
              invitation("inv-2", "Borealis"),
            ]}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const declines = screen.getAllByRole("button", { name: /decline/i });
    const accepts = screen.getAllByRole("button", { name: /accept/i });
    fireEvent.click(declines[0]);

    await waitFor(() => expect(fake.release).toBeDefined());
    for (const button of [...declines, ...accepts]) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }

    fake.release!();

    await waitFor(() =>
      expect(
        screen.getAllByText("Invitation already answered (spec)"),
      ).toHaveLength(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      screen.getAllByText("Invitation already answered (spec)"),
    ).toHaveLength(1);
    // Refused, so both rows are still there and usable again.
    expect(screen.getByText("Atlas")).toBeTruthy();
    expect(
      (
        screen.getAllByRole("button", {
          name: /decline/i,
        })[1] as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
