import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { MyOrganizationInvitations } from "../MyOrganizationInvitations.tsx";

const invitationId = "00000000-0000-4000-8000-000000000031";
const organizationId = "00000000-0000-4000-8000-000000000032";

class Links extends LinkProvider {
  public accepted: string[] = [];
  public declined: string[] = [];
  public pending = true;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "getMyOrganizationInvitations") {
              return this.pending
                ? [
                    {
                      id: invitationId,
                      organizationId,
                      organizationName: "Acme",
                      invitedBy: "00000000-0000-4000-8000-000000000033",
                      email: "kim@example.com",
                      status: "pending",
                      rank: "member",
                      expiresAt: "2026-10-01T10:00:00.000Z",
                      createdAt: "2026-09-01T10:00:00.000Z",
                      updatedAt: "2026-09-01T10:00:00.000Z",
                      version: 1,
                    },
                  ]
                : [];
            }
            if (name === "acceptOrganizationInvitation") {
              this.accepted.push(input.params.invitationId);
              this.pending = false;
              return { organizationId };
            }
            if (name === "declineOrganizationInvitation") {
              this.declined.push(input.params.invitationId);
              this.pending = false;
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

/**
 * The invitations table: a row per pending invitation, Accept and Decline as
 * buttons on the row, and the list re-read after either.
 */
describe("MyOrganizationInvitations", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  /** Clicks the named button on the first row. */
  const runRowAction = async (label: string) => {
    const button = await waitFor(() => {
      const found = [...document.querySelectorAll("tbody tr button")].find(
        (it) => it.textContent?.includes(label),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(button);
  };

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (onAccepted?: (id: string) => void) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <MyOrganizationInvitations onAccepted={onAccepted} />
      </AlephaContext.Provider>,
    );
    await view.findByText("Acme");
    return { links: alepha.inject(Links), view };
  };

  it("renders a row per invitation, with its rank", async () => {
    const { view } = await mount();

    expect(
      view
        .getAllByTestId("my-invitation-organization")
        .map((it) => it.textContent),
    ).toEqual(["AcmePending"]);
    expect(view.getByText("member")).toBeTruthy();
    expect(view.getByText("kim@example.com")).toBeTruthy();
  });

  it("shows the empty state when nothing is pending", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(Links).pending = false;
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <MyOrganizationInvitations />
      </AlephaContext.Provider>,
    );

    expect(
      await view.findByText("You have no pending invitations."),
    ).toBeTruthy();
  });

  it("accepts an invitation, removes it, and reports the joined organization", async () => {
    const joined: string[] = [];
    const { links, view } = await mount((id) => joined.push(id));

    await runRowAction("Accept");

    await waitFor(() => expect(links.accepted).toEqual([invitationId]));
    await waitFor(() => expect(joined).toEqual([organizationId]));
    await waitFor(() => expect(view.queryByText("Acme")).toBeNull());
  });

  it("declines an invitation and removes it", async () => {
    const { links, view } = await mount();

    await runRowAction("Decline");

    await waitFor(() => expect(links.declined).toEqual([invitationId]));
    await waitFor(() => expect(view.queryByText("Acme")).toBeNull());
  });

  it("uses caller-provided invitation actions when an app adapts a legacy API", async () => {
    const accepted: string[] = [];
    const declined: string[] = [];
    const joined: string[] = [];
    const load = async () => [
      {
        id: invitationId,
        organizationId,
        organizationName: "Legacy project",
        email: "kim@example.com",
      },
    ];

    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <MyOrganizationInvitations
          load={load}
          accept={async (id) => {
            accepted.push(id);
            return organizationId;
          }}
          decline={async (id) => {
            declined.push(id);
          }}
          onAccepted={(id) => {
            joined.push(id);
          }}
        />
      </AlephaContext.Provider>,
    );

    await view.findByText("Legacy project");
    await runRowAction("Accept");

    await waitFor(() => expect(accepted).toEqual([invitationId]));
    expect(declined).toEqual([]);
    expect(joined).toEqual([organizationId]);
  });
});
