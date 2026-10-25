import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { MyOrganizations } from "../MyOrganizations.tsx";

const organizationId = "00000000-0000-4000-8000-000000000041";
const createdId = "00000000-0000-4000-8000-000000000042";

class Links extends LinkProvider {
  public created: string[] = [];
  public organizations = [
    {
      id: organizationId,
      name: "Acme",
      rank: "owner",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "getMyOrganizations") return this.organizations;
            if (name === "createOrganization") {
              this.created.push(input.body.name);
              const organization = {
                id: createdId,
                name: input.body.name,
                createdAt: "2026-09-02T10:00:00.000Z",
                updatedAt: "2026-09-02T10:00:00.000Z",
              };
              this.organizations.push({ ...organization, rank: "owner" });
              return organization;
            }
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

describe("MyOrganizations", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (onOpen?: (id: string) => void) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <MyOrganizations
            onOpen={(organization) => onOpen?.(organization.id)}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await view.findByText("Acme");
    return { links: alepha.inject(Links), view };
  };

  it("lists organizations with the caller rank and opens one", async () => {
    const opened: string[] = [];
    const { view } = await mount((id) => opened.push(id));

    expect(view.getByText("Owner")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Open Acme" }));

    expect(opened).toEqual([organizationId]);
  });

  it("creates an organization, refreshes the list, and opens it", async () => {
    const opened: string[] = [];
    const { links, view } = await mount((id) => opened.push(id));

    fireEvent.click(view.getByRole("button", { name: "Create organization" }));
    fireEvent.change(await view.findByLabelText("Organization name"), {
      target: { value: "Northstar" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(links.created).toEqual(["Northstar"]));
    expect(await view.findByText("Northstar")).toBeDefined();
    expect(opened).toEqual([createdId]);
  });
});
