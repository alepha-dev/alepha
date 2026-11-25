import { DialogProvider, Toaster } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { StackResource } from "../../../../../api/schemas/stackResourceSchema.ts";
import ProjectStacks from "./ProjectStacks.tsx";

const HOST = "00000000-0000-4000-8000-0000000000aa";

const aStack = (over: Partial<StackResource>): StackResource =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    projectId: 1,
    name: "shop",
    hostId: HOST,
    environments: [],
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...over,
  }) as StackResource;

/**
 * What the API answers, set by each case.
 */
const world: { stacks: StackResource[]; created: unknown[] } = {
  stacks: [],
  created: [],
};

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      listStacks: () => ({ items: world.stacks }),
      listProjectHosts: () => ({ items: [{ id: HOST, slug: "desktop" }] }),
      createStack: (input) => {
        world.created.push(input.body);
        return aStack({ name: input.body.name });
      },
    };
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(async (input: unknown) => answers[name]?.(input), {
            can: () => true,
          }),
      },
    );
  }
}

/**
 * The Stacks page (#Q4320): a DataTable like Apps, its environments as
 * links, and New stack, Add environment and Upload compose in centered
 * dialogs rather than forms on the page.
 */
describe("ProjectStacks", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    world.stacks = [];
    world.created = [];
  });

  const show = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      slug: "acme",
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster />
          <ProjectStacks />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("project-stacks");
  };

  it("lists each stack as a row, its environments linking to their pages, with no form on the page", async ({
    expect,
  }) => {
    world.stacks = [
      aStack({
        latestRevision: 2,
        environments: [
          {
            id: "00000000-0000-4000-8000-0000000000e1",
            env: "production",
            revision: 2,
            members: [{ app: "api" }],
          },
        ] as never,
      }),
    ];
    await show();

    const row = (await screen.findByTestId("stack-row-shop")).closest(
      "tr",
    ) as HTMLElement;
    expect(row.textContent).toContain("revision 2");
    expect(row.textContent).toContain("desktop");
    expect(row.textContent).toContain("api");
    expect(
      within(row)
        .getByTestId("stack-environment-link-production")
        .getAttribute("href"),
    ).toBe("/acme/stacks/shop/production");
    expect(screen.queryByTestId("stack-create-name")).toBeNull();
    expect(screen.queryByTestId("stack-environment-name")).toBeNull();
  });

  it("opens New stack in a dialog from the table, creates it and closes", async ({
    expect,
  }) => {
    await show();
    await screen.findByText("No stack yet");

    fireEvent.click(screen.getAllByRole("button", { name: "New stack" })[0]!);
    const dialog = await screen.findByTestId("stack-create-dialog");
    fireEvent.change(
      within(dialog)
        .getByTestId("stack-create-name")
        .querySelector("input") as HTMLInputElement,
      { target: { value: "shop" } },
    );
    fireEvent.click(within(dialog).getByTestId("stack-create-submit"));

    await waitFor(() => expect(world.created).toEqual([{ name: "shop" }]));
    await waitFor(() =>
      expect(screen.queryByTestId("stack-create-dialog")).toBeNull(),
    );
  });

  it("offers Add environment, Upload compose and, once empty, Delete in a row's menu, each a dialog", async ({
    expect,
  }) => {
    world.stacks = [aStack({})];
    await show();
    await screen.findByTestId("stack-row-shop");

    fireEvent.click(screen.getByRole("button", { name: "Open row actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Delete stack" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Upload compose" }));
    expect(await screen.findByTestId("stack-revision-dialog")).toBeTruthy();
  });
});
