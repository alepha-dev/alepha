import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import AppSettings from "./AppSettings.tsx";

/**
 * The two routes this page navigates to. Declared here rather than booted from
 * `AppRouter`, which would pull the whole route table and every loader with it.
 */
class Routes {
  appSettings = $page({
    name: "appSettings",
    path: "/:projectSlug/apps/:app/:env/settings",
    component: () => null,
  });
  projectApps = $page({
    name: "projectApps",
    path: "/:projectSlug/apps",
    component: () => null,
  });
}

const aProject = projectFixture({ title: "Alepha", slug: "alepha" });

const anInstance = (over: Partial<AppInstanceResource> = {}) =>
  ({
    id: "00000000-0000-4000-8000-000000000010",
    projectId: 1,
    app: "club",
    env: "production",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...over,
  }) as AppInstanceResource;

class RecordingLinkProvider extends LinkProvider {
  public calls: Array<{ action: string; params?: unknown; body?: unknown }> =
    [];
  public responses: Record<string, unknown> = {};

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get:
          (_target, action: string) =>
          async (config: { params?: unknown; body?: unknown } = {}) => {
            this.calls.push({
              action,
              params: config.params,
              body: config.body,
            });
            const answer = this.responses[action];
            if (answer instanceof Error) throw answer;
            return answer ?? {};
          },
      },
    );
  }
}

/**
 * Answers the confirmation `useDialog()` opened, by clicking its action button.
 *
 * A real `<DialogProvider>` is mounted below rather than stubbed: `useDialog`
 * throws without one, and the confirmation is half of what these rows are - the
 * rename says the address moves, the delete says what goes with the row.
 *
 * Scoped to the `[role=alertdialog]` because the label collides on purpose: the
 * dialog's "Rename" is the same word as the row's own button.
 */
const confirmDialog = async () => {
  const dialog = await waitFor(() => {
    const found = document.querySelector<HTMLElement>("[role=alertdialog]");
    if (!found) throw new Error("no confirmation opened");
    return found;
  });
  const action = [...dialog.querySelectorAll("button")].at(-1)!;
  fireEvent.click(action);
};

describe("the instance Settings tab", () => {
  const mount = async (
    instance: AppInstanceResource,
    responses: Record<string, unknown> = {},
    { owner = true }: { owner?: boolean } = {},
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    alepha.inject(Routes);
    await alepha.start();

    alepha.store.set(currentProjectAtom, aProject as never);
    alepha.store.set(currentProjectMemberAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000001",
      projectId: 1,
      owner,
    } as never);
    alepha.store.set(currentInstanceAtom, instance as never);
    alepha.store.set(currentInstancesAtom, [instance] as never);

    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = responses;

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AppSettings />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    return { alepha, links, router: alepha.inject(ReactRouter), view };
  };

  it("renames one half and sends only that key", async ({ expect }) => {
    // Each row PATCHes its own field, which is what lets five of them share one
    // instance without writing a stale copy of another's draft.
    const { links, view } = await mount(anInstance(), {
      updateApp: anInstance({ env: "staging" }),
    });

    const field =
      view.container.querySelector<HTMLInputElement>("#app-settings-env")!;
    fireEvent.change(field, { target: { value: "staging" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await confirmDialog();

    // The estate section reads its own list on mount, so this filters rather
    // than counting: what matters is the ONE write and its shape.
    const writes = () => links.calls.filter((it) => it.action === "updateApp");
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      action: "updateApp",
      params: { projectId: 1, app: "club", env: "production" },
      body: { env: "staging" },
    });
  });

  it("writes both atoms and moves the address bar", async ({ expect }) => {
    // The redirect resolves the new segments against the list, so a list that
    // does not have them yet sends the reader to a page that 404s.
    const { alepha, router, view } = await mount(anInstance(), {
      updateApp: anInstance({ env: "staging" }),
    });

    const field =
      view.container.querySelector<HTMLInputElement>("#app-settings-env")!;
    fireEvent.change(field, { target: { value: "staging" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await confirmDialog();

    await waitFor(() =>
      expect(alepha.store.get(currentInstanceAtom)?.env).toBe("staging"),
    );
    expect(
      (alepha.store.get(currentInstancesAtom) ?? []).map((it) => it.env),
    ).toEqual(["staging"]);
    await waitFor(() =>
      expect(router.state.url.pathname).toBe(
        "/alepha/apps/club/staging/settings",
      ),
    );
  });

  it("clears the pinned address with an empty field", async ({ expect }) => {
    // The empty field is the way back to the detected host; with omission as
    // the only "no", a wrong pin could never be taken off.
    const { links, view } = await mount(
      anInstance({ url: "https://wrong.example" }),
      { updateApp: anInstance() },
    );

    const field =
      view.container.querySelector<HTMLInputElement>("#app-settings-url")!;
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    const writes = links.calls.filter((it) => it.action === "updateApp");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ url: "" });
  });

  it("offers only the estates the project was lent", async ({ expect }) => {
    const { view } = await mount(anInstance(), {
      listProjectEstates: {
        items: [
          {
            id: "00000000-0000-4000-8000-0000000000e1",
            slug: "ovh-1",
            type: "bay",
            online: true,
            deployAllowed: true,
            acceptedRuntimes: ["node"],
            owner: { id: "00000000-0000-4000-8000-000000000001", name: "Nico" },
            lentAt: "2026-09-01T10:00:00.000Z",
          },
        ],
      },
    });

    const trigger = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>(
        "[data-slot=select-trigger]",
      );
      if (!found) throw new Error("the estate select did not render");
      return found;
    });
    fireEvent.click(trigger);

    await waitFor(() => expect(document.body.textContent).toContain("ovh-1"));
    // The clear row is there too: pointing nowhere is a real state.
    expect(document.body.textContent).toContain("No estate");
  });

  it("says so and links out when nothing is lent", async ({ expect }) => {
    // An empty select would be a control that changes nothing, which is the
    // failure folio #1172 records.
    const { view } = await mount(anInstance(), {
      listProjectEstates: { items: [] },
    });

    await waitFor(() =>
      expect(view.container.textContent).toContain("No estate is lent"),
    );
    expect(
      view.container.querySelector<HTMLAnchorElement>(
        'a[href="/alepha/settings/estates"]',
      ),
    ).toBeTruthy();
    expect(
      view.container.querySelector("[data-slot=select-trigger]"),
    ).toBeNull();
  });

  it("hides every mutation from a member", async ({ expect }) => {
    // Owner-only server-side, and the controls are disabled here purely so a
    // member is not walked through a destructive confirmation only to be
    // refused at the end.
    const { view } = await mount(anInstance(), {}, { owner: false });

    for (const id of [
      "#app-settings-app",
      "#app-settings-env",
      "#app-settings-url",
    ]) {
      expect(view.container.querySelector<HTMLInputElement>(id)?.disabled).toBe(
        true,
      );
    }
    expect(
      view.container
        .querySelector<HTMLButtonElement>('button[aria-label="Delete"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });
});
