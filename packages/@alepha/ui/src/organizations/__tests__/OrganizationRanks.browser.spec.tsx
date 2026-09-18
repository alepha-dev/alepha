import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { OrganizationRanks } from "../OrganizationRanks.tsx";

const organizationId = "00000000-0000-4000-8000-000000000041";

class Links extends LinkProvider {
  public saved: any[] = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "getOrganizationRanks") {
              return {
                items: [
                  {
                    key: "owner",
                    name: "Owner",
                    permissions: ["*"],
                    builtin: true,
                    editable: false,
                  },
                  {
                    key: "member",
                    name: "Member",
                    permissions: [],
                    builtin: true,
                    editable: true,
                  },
                  {
                    key: "editor",
                    name: "Editor",
                    permissions: ["document:read"],
                    builtin: false,
                    editable: true,
                  },
                ],
              };
            }
            if (name === "getOrganizationRankCatalogue") {
              return {
                groups: [
                  {
                    name: "documents",
                    label: "Documents",
                    permissions: [
                      { name: "document:read", label: "Read documents" },
                      { name: "document:edit", label: "Edit documents" },
                      { name: "document:secret", label: "Secret documents" },
                    ],
                  },
                ],
              };
            }
            if (name === "getOrganizationMembers") return [];
            if (name === "saveOrganizationRank") this.saved.push(input);
            return { ok: true };
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

describe("OrganizationRanks", () => {
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

  const mount = async () => {
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
          <OrganizationRanks
            organizationId={organizationId}
            filterPermission={(permission) =>
              permission.name !== "document:secret"
            }
            label={(key, fallback) => key ?? fallback}
            presets={[
              {
                key: "reviewer",
                name: "Reviewer",
                permissions: ["document:read"],
              },
            ]}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await view.findByText("Documents");
    return { links: alepha.inject(Links), view };
  };

  it("keeps owner all-on and read-only while member stays editable", async () => {
    const { view } = await mount();

    const read = view.getAllByLabelText("document:read");
    expect(read[0].hasAttribute("data-disabled")).toBe(true);
    expect(read[0].hasAttribute("data-checked")).toBe(true);
    expect(read[1].hasAttribute("data-disabled")).toBe(false);
    expect(view.queryByText("Secret documents")).toBeNull();
    expect(view.getByText(/up to 30 seconds/i)).toBeDefined();
    expect(view.getByText(/demotions take effect immediately/i)).toBeDefined();
  });

  it("saves an edited built-in member rank", async () => {
    const { links, view } = await mount();

    fireEvent.click(view.getAllByLabelText("document:read")[1]);
    fireEvent.click(view.getByRole("button", { name: "Save ranks" }));

    await waitFor(() =>
      expect(links.saved).toContainEqual({
        params: { organizationId, key: "member" },
        body: { name: "Member", permissions: ["document:read"] },
      }),
    );
  });

  it("creates a custom rank from a caller-provided preset", async () => {
    const { links, view } = await mount();

    fireEvent.click(view.getByRole("button", { name: "Create rank" }));
    fireEvent.click(await view.findByText("Start from Reviewer"));
    fireEvent.click(await view.findByRole("button", { name: "Create" }));

    await waitFor(() => expect(links.saved).toHaveLength(1));
    expect(links.saved[0].params.organizationId).toBe(organizationId);
    expect(links.saved[0].params.key).toMatch(/^r/);
    expect(links.saved[0].body).toEqual({
      name: "Reviewer",
      permissions: ["document:read"],
    });
  });
});
