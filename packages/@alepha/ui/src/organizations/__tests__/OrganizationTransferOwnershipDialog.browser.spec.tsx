import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { OrganizationTransferOwnershipDialog } from "../OrganizationTransferOwnershipDialog.tsx";

const organizationId = "00000000-0000-4000-8000-000000000051";
const memberId = "00000000-0000-4000-8000-000000000052";

class Links extends LinkProvider {
  public transferred: any[] = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "transferOrganizationOwnership") {
              this.transferred.push(input);
            }
            return { ok: true };
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

describe("OrganizationTransferOwnershipDialog", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("transfers to the selected member and assigns the giver's chosen rank", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const links = alepha.inject(Links);
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <OrganizationTransferOwnershipDialog
            organizationId={organizationId}
            target={{ userId: memberId, name: "Kim" }}
            ranks={
              [
                { key: "owner", name: "Owner", permissions: [] },
                { key: "member", name: "Member", permissions: [] },
                { key: "editor", name: "Editor", permissions: [] },
              ] as never
            }
            onOpenChange={() => {}}
            onTransferred={() => {}}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    fireEvent.keyDown(view.getByTestId("transfer-rank"), { key: "ArrowDown" });
    fireEvent.click(await view.findByRole("option", { name: "Editor" }));
    fireEvent.click(view.getByRole("button", { name: "Transfer ownership" }));
    fireEvent.click(await view.findByRole("button", { name: "Transfer" }));

    await waitFor(() =>
      expect(links.transferred).toEqual([
        {
          params: { organizationId },
          body: { userId: memberId, rank: "editor" },
        },
      ]),
    );
  });
});
