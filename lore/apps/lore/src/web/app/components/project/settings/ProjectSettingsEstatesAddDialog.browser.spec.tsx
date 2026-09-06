import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import ProjectSettingsEstatesAddDialog from "./ProjectSettingsEstatesAddDialog.tsx";

/**
 * Answers the two controllers this dialog talks to, and records what was
 * asked. Substitution rather than `vi.mock`, per `CLAUDE.md`.
 */
class RecordingLinkProvider extends LinkProvider {
  public bodies: Record<string, unknown> = {};
  public responses: Record<string, unknown> = {};

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          const call = async (input?: { body?: unknown }) => {
            this.bodies[prop] = input?.body;
            const answer = this.responses[prop];
            if (answer instanceof Error) {
              throw answer;
            }
            return answer ?? {};
          };
          return Object.assign(call, { can: () => true });
        },
      },
    );
  }
}

const aProject = {
  id: 1,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  title: "Alepha",
  slug: "alepha",
  createdBy: "00000000-0000-4000-8000-000000000001",
  areas: [],
  features: defaultProjectFeatures,
  kanbanColumns: ["In Progress"],
  unlockedFeatures: [],
  unlockHistory: [],
};

const CF_ACCOUNT = "0123456789abcdef0123456789abcdef";

const CF_TOKEN = `cfut_${"a1B2c3D4e5".repeat(4)}0123abcd`;

/**
 * The create-and-lend half of the same form.
 *
 * It shares `EstateCreateFields` with `/account/estates`, so what is pinned
 * here is what only this dialog owns: that the type reaches the ONE call
 * that creates and lends, and that the trust sentence names what is really
 * being granted. A Cloudflare account is not "a machine", and the sentence
 * sits above the button that grants it.
 */
describe("ProjectSettingsEstatesAddDialog", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (responses: Record<string, unknown> = {}) => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, aProject as never);

    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = { listMyEstates: { items: [] }, ...responses };

    return {
      links,
      ...render(
        <AlephaContext.Provider value={alepha}>
          <ProjectSettingsEstatesAddDialog
            open
            onOpenChange={() => {}}
            held={[]}
            onAttached={() => {}}
          />
        </AlephaContext.Provider>,
      ),
    };
  };

  it("creates and lends a cloudflare estate in one call", async ({
    expect,
  }) => {
    const { links, findByTestId, getByTestId } = await show({
      createProjectEstate: {
        id: "00000000-0000-4000-8000-000000000001",
        slug: "cf-1",
        type: "cloudflare",
        online: false,
        deployAllowed: true,
        acceptedRuntimes: ["workerd"],
        credentialStatus: "valid",
        owner: { id: "00000000-0000-4000-8000-0000000000ff", name: "Ada" },
        lentAt: "2026-09-06T00:00:00.000Z",
      },
    });

    // The owner has nothing to lend, so the dialog is already in "new" mode.
    fireEvent.click(await findByTestId("estate-type-cloudflare"));
    fireEvent.change(getByTestId("estate-create-slug"), {
      target: { value: "cf-1" },
    });
    fireEvent.change(getByTestId("estate-create-account"), {
      target: { value: CF_ACCOUNT },
    });
    fireEvent.change(getByTestId("estate-create-token"), {
      target: { value: CF_TOKEN },
    });

    // The trust sentence names an account, not a machine: what is granted is
    // that account's storage and secrets, and the wording is what somebody
    // reads before clicking.
    const warning = await findByTestId("estate-add-trust");
    expect(warning.textContent).toContain("Cloudflare account");
    expect(warning.textContent).not.toContain("machine");

    fireEvent.click(getByTestId("estate-add-submit"));

    // One call, carrying the discriminated body: create-and-lend stays a
    // single step for a cloudflare estate too.
    await waitFor(() =>
      expect(links.bodies.createProjectEstate).toEqual({
        type: "cloudflare",
        slug: "cf-1",
        accountId: CF_ACCOUNT,
        token: CF_TOKEN,
      }),
    );
  });

  it("keeps saying machine for a bay estate", async ({ expect }) => {
    const { findByTestId, getByTestId } = await show();

    fireEvent.change(await findByTestId("estate-create-slug"), {
      target: { value: "ovh-1" },
    });

    const warning = await findByTestId("estate-add-trust");
    expect(warning.textContent).toContain("machine");
    // Bay is the default, so no type had to be chosen to get here, which is
    // what keeps the existing e2e passing unchanged.
    expect(getByTestId("estate-type-bay").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
