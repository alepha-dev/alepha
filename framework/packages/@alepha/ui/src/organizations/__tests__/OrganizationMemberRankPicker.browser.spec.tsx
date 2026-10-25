import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { OrganizationMemberRankPicker } from "../OrganizationMemberRankPicker.tsx";

describe("OrganizationMemberRankPicker", () => {
  const organizationId = "00000000-0000-4000-8000-000000000002";
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

  class Links extends LinkProvider {
    public fails = false;
    public calls: Array<Record<string, unknown>> = [];

    override client(): any {
      return new Proxy(
        {},
        {
          get: (_target, name) => {
            const action: any = async (input: Record<string, unknown>) => {
              if (name === "assignOrganizationRank") {
                this.calls.push(input);
                if (this.fails) {
                  throw new Error("You cannot change your own rank");
                }
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

  const ranks = [
    { key: "owner", name: "Owner", permissions: [] },
    { key: "member", name: "Member", permissions: [] },
    { key: "r1x9k2", name: "Release manager", permissions: [] },
  ] as never;

  const mount = async (rank = "member") => {
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
        <OrganizationMemberRankPicker
          organizationId={organizationId}
          userId="00000000-0000-4000-8000-000000000001"
          rank={rank}
          ranks={ranks}
          self={false}
          canAssign
          onAssigned={() => {}}
        />
      </AlephaContext.Provider>,
    );
    return { links, view };
  };

  const trigger = () => screen.getByTestId("member-rank");

  const pick = async (name: string) => {
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name }));
  };

  it("renders a custom rank name instead of its opaque key", async () => {
    await mount("r1x9k2");

    expect(trigger().textContent).toContain("Release manager");
    expect(trigger().textContent).not.toContain("r1x9k2");
  });

  it("restores the held rank when the server refuses the assignment", async () => {
    const { links } = await mount();
    links.fails = true;

    await pick("Release manager");

    await waitFor(() => expect(trigger().textContent).toContain("Member"));
    expect(links.calls).toHaveLength(1);
  });
});
