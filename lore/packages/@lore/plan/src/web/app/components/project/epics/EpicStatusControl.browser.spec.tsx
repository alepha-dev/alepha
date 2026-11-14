import { DialogProvider } from "@alepha/ui";
import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import EpicStatusControl from "./EpicStatusControl.tsx";

/**
 * Records every status write, and answers it with the epic moved.
 */
class FakeLinkProvider extends LinkProvider {
  public writes: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      setEpicStatus: async (request: { body: { status: string } }) => {
        this.writes.push(request.body.status);
        return { ...anEpic, status: request.body.status };
      },
    });
  }
}

const anEpic = {
  id: 1,
  projectId: 1,
  number: 121,
  title: "Epic reviews",
  status: "draft",
  progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
} as unknown as EpicResource;

/**
 * Marking an epic ready with review questions open asks first, and never
 * refuses (#E121): the confirm names the count and offers the Review tab as
 * the way out.
 */
describe("EpicStatusControl, with review questions open", () => {
  const mount = async (openQuestions: number) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const changes: string[] = [];
    let reviewed = 0;
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <EpicStatusControl
            epic={{ ...anEpic, openQuestions }}
            onChange={(epic) => changes.push(epic.status)}
            onReview={() => {
              reviewed += 1;
            }}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark as ready" }),
    );
    return {
      alepha,
      changes,
      reviewed: () => reviewed,
      writes: alepha.inject(FakeLinkProvider).writes,
    };
  };

  it("names the count, and marks it ready anyway on confirm", async ({
    expect,
  }) => {
    const ctx = await mount(3);

    expect(
      await screen.findByText("3 review questions are still open"),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark as ready anyway" }),
    );

    await waitFor(() => expect(ctx.writes).toEqual(["ready"]));
    expect(ctx.changes).toEqual(["ready"]);
    expect(ctx.reviewed()).toBe(0);

    await ctx.alepha.stop();
  });

  it("opens the Review tab, writing nothing, when the reader backs out", async ({
    expect,
  }) => {
    const ctx = await mount(1);

    expect(
      await screen.findByText("1 review question is still open"),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Open the Review tab" }),
    );

    await waitFor(() => expect(ctx.reviewed()).toBe(1));
    expect(ctx.writes).toEqual([]);

    await ctx.alepha.stop();
  });

  it("asks the usual question when nothing is open", async ({ expect }) => {
    const ctx = await mount(0);

    expect(await screen.findByText("Mark this epic as ready?")).toBeDefined();
    expect(
      screen.queryByText(/review questions? (are|is) still open/),
    ).toBeNull();

    await ctx.alepha.stop();
  });
});
