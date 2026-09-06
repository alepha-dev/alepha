import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import AppCreateDialog from "./AppCreateDialog.tsx";

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

/**
 * ⚠️ The id is a real uuid, padded from a counter. It used to be built from
 * the two names' lengths, which produced a 14-character last group for
 * `docs/production` - and `currentInstancesAtom` PARSES what it is handed, so
 * the write threw and the row silently never appeared.
 */
let instanceSeq = 0;
const anInstance = (app: string, env: string): AppInstanceResource => ({
  id: `00000000-0000-4000-8000-${String(++instanceSeq).padStart(12, "0")}`,
  projectId: 1,
  app,
  env,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
});

/**
 * Records what the dialog asks for and answers what a case set. Same
 * substitution seam as the other browser specs here (`CLAUDE.md`: never
 * `vi.mock` / `vi.spyOn`).
 */
class RecordingLinkProvider extends LinkProvider {
  public calls: Array<{ action: string; body: unknown }> = [];
  public responses: Record<string, unknown> = {};

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get:
          (_target, action: string) =>
          async (config: { body?: unknown } = {}) => {
            this.calls.push({ action, body: config.body });
            const answer = this.responses[action];
            // An `Error` in the table is a refusal, which is the only way to
            // drive the failure paths: the real client rejects, it does not
            // answer one.
            if (answer instanceof Error) throw answer;
            return answer ?? {};
          },
      },
    );
  }
}

describe("AppCreateDialog", () => {
  const mount = async (
    instances: AppInstanceResource[],
    responses: Record<string, unknown> = {},
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    alepha.store.set(currentProjectAtom, aProject as never);
    alepha.store.set(currentInstancesAtom, instances as never);

    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = responses;

    const created: Array<{ app: string; env: string }> = [];
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <AppCreateDialog
          open
          onOpenChange={() => {}}
          onCreated={(instance) => created.push(instance)}
        />
      </AlephaContext.Provider>,
    );

    return { alepha, links, created, view };
  };

  /**
   * Picks the app through the combobox, the way a person does: open the
   * trigger, type into the popup's own search field, click the row.
   *
   * ⚠️ The popup is a portal, so the rows are queried off `document` rather
   * than off the render's container - and `role="combobox"` matches TWO
   * elements once it is open (the trigger button, then the search input), which
   * is why this reaches for the input by tag.
   *
   * When `name` is not among the existing apps the row that appears is the
   * explicit `Create "name"` one, which is the affordance this field exists
   * for: without it a typo would silently become a second app.
   */
  const pickApp = async (name: string) => {
    fireEvent.click(document.querySelector("button[role=combobox]")!);
    const search = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(
        "input[role=combobox]",
      );
      if (!input) throw new Error("the combobox popup did not open");
      return input;
    });
    fireEvent.change(search, { target: { value: name } });

    const option = await waitFor(() => {
      const rows = [...document.querySelectorAll("[role=option]")];
      const match = rows.find((row) => row.textContent?.includes(name));
      if (!match) throw new Error(`no row offering ${name}`);
      return match;
    });
    fireEvent.click(option);
  };

  const typeEnv = (value: string) => {
    const field = document.querySelector<HTMLInputElement>("#app-create-env")!;
    fireEvent.change(field, { target: { value } });
  };

  it("creates an instance and mints nothing", async ({ expect }) => {
    const { links, created, view } = await mount([anInstance("club", "prod")], {
      createApp: anInstance("club", "staging"),
    });

    // The combobox holds the app; the env is a plain field.
    await pickApp("club");
    typeEnv("staging");
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(links.calls).toHaveLength(1));
    expect(links.calls[0]).toEqual({
      action: "createApp",
      body: { app: "club", env: "staging" },
    });
    // No `createSigil` beside it: the checkbox is off by default, and it must
    // stay that way - a required credential at creation is the model this epic
    // removed.
    expect(links.calls.map((it) => it.action)).not.toContain("createSigil");
    await waitFor(() =>
      expect(created).toEqual([{ app: "club", env: "staging" }]),
    );
  });

  it("normalises both halves the way the server does", async ({ expect }) => {
    // Trimmed and lowercased before the round trip, so an operator learns the
    // rule without paying for a request. The server's check is the real one.
    const { links, view } = await mount([], {
      createApp: anInstance("club", "b14-production"),
    });

    await pickApp("Club");
    typeEnv("  B14-Production ");
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(links.calls).toHaveLength(1));
    expect(links.calls[0].body).toEqual({
      app: "club",
      env: "b14-production",
    });
  });

  it("composes the two calls when the checkbox is ticked, and holds the token", async ({
    expect,
  }) => {
    // The token exists in cleartext exactly once, so it is shown INSIDE the
    // dialog: carrying it across the navigation `onCreated` triggers would be a
    // second place to lose it.
    const { links, created, view } = await mount([], {
      createApp: anInstance("club", "production"),
      createSigil: {
        id: "00000000-0000-4000-8000-000000000099",
        tokenPrefix: "sg_alepha_ab",
        kinds: ["beacon"],
        createdAt: "2026-09-01T10:00:00.000Z",
        token: "sg_alepha_abcdef",
      },
    });

    await pickApp("club");
    // Base UI renders the box as a `span[role=checkbox]` over a hidden input,
    // and jsdom does not forward a click on the span to it.
    fireEvent.click(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
    );
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(links.calls).toHaveLength(2));
    expect(links.calls.map((it) => it.action)).toEqual([
      "createApp",
      "createSigil",
    ]);

    // Still open, on the token, and nothing has navigated yet. Read off the
    // document: the dialog is a portal, so it is not under the render's own
    // container.
    await waitFor(() =>
      expect(document.body.textContent).toContain("sg_alepha_abcdef"),
    );
    expect(created).toEqual([]);

    fireEvent.click(view.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(created).toEqual([{ app: "club", env: "production" }]),
    );
  });

  /**
   * `ProjectApps` runs `AlephaTable` in static-data mode over this atom, where
   * `refresh()` re-fires nothing. A create that does not hand the table a new
   * array leaves the row invisible until a reload, which reads as a broken
   * create.
   */
  it("writes a new array into the instances atom", async ({ expect }) => {
    const existing = anInstance("club", "prod");
    const { alepha, view } = await mount([existing], {
      createApp: anInstance("docs", "production"),
    });

    await pickApp("docs");
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const rows = alepha.store.get(currentInstancesAtom) ?? [];
      expect(rows.map((it) => `${it.app}/${it.env}`)).toEqual([
        "club/prod",
        "docs/production",
      ]);
    });
  });

  it("keeps a server refusal in the dialog, beside what was typed", async ({
    expect,
  }) => {
    // A pair that already exists and a name the URL cannot carry are both fixed
    // by editing a value that is already on screen, so the message stays here
    // rather than going to a toast that outlives the dialog.
    const { created, view } = await mount([], {
      createApp: new Error('"club/production" already exists'),
    });

    await pickApp("club");
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(document.body.textContent).toContain("already exists"),
    );
    // Open, holding the app that was typed, and nothing was reported as
    // created.
    expect(document.querySelector("[role=dialog]")).toBeTruthy();
    expect(document.body.textContent).toContain("club");
    expect(created).toEqual([]);
  });
});
