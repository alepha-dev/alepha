import { DialogProvider } from "@alepha/ui";
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
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { I18n } from "../../services/I18n.ts";
import { SubscriptionBell } from "./SubscriptionBell.tsx";

const ME = "00000000-0000-4000-8000-000000000007";

/**
 * The server's side, in memory: the viewer's subscription rows and every
 * call the bell made. Substitution rather than `vi.mock`.
 */
class FakeLinkProvider extends LinkProvider {
  public rows: Array<Record<string, unknown>> = [];
  public calls: string[] = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async (input: any) => {
          this.calls.push(prop);
          if (prop === "listSubscriptions") return { items: this.rows };
          if (prop === "listProjectChannels") {
            return {
              items: [
                { id: "inapp", kind: "inapp", name: "Inbox", builtIn: true },
                {
                  id: "ch-1",
                  kind: "discord",
                  name: "Team Discord",
                  builtIn: false,
                },
              ],
            };
          }
          if (prop === "setSubscription") {
            const existing = this.rows.find(
              (it) =>
                it.event === input.body.event &&
                it.channelId === input.body.channelId,
            );
            if (existing) existing.channels = input.body.channels;
            else
              this.rows.push({
                id: `row-${this.rows.length}`,
                projectId: 1,
                event: input.body.event,
                ...(input.body.filter ? { filter: input.body.filter } : {}),
                ...(input.body.channelId
                  ? { channelId: input.body.channelId, channels: [] }
                  : { memberId: ME, channels: input.body.channels }),
                ...(input.body.notMine ? { notMine: true } : {}),
                ...(input.body.notMembers ? { notMembers: true } : {}),
                createdAt: "2026-11-18T00:00:00.000Z",
              });
            return this.rows.at(-1);
          }
          if (prop === "deleteSubscription") {
            this.rows = this.rows.filter((it) => it.id !== input.params.id);
            return { ok: true };
          }
          if (prop === "getProjectEventCatalog") return { items: [] };
          return {};
        },
      },
    );
  }
}

/**
 * The bell is a plain subscription (#Q3892): one click turns it on, in the
 * app, scoped to the page's resource, and it creates no automation.
 */
describe("SubscriptionBell", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (
    events: string[],
    filter?: string,
    rows: Array<Record<string, unknown>> = [],
    authors?: {
      allLabel: string;
      notMineLabel: string;
      notMembersLabel: string;
    },
    permissions?: string[],
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture(permissions ? { permissions } : {}),
    );
    alepha.store.set(currentUserAtom, { id: ME, roles: ["user"] } as never);
    alepha.inject(FakeLinkProvider).rows = rows;
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <SubscriptionBell
            events={events}
            {...(filter ? { filter } : {})}
            label="Notify me"
            description="You are notified of it."
            offDescription="You are no longer notified."
            {...(authors ? { authors } : {})}
            testId="bell"
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return alepha.inject(FakeLinkProvider);
  };
  const bell = () => screen.getByTestId("bell");

  it("subscribes its viewer in one click, in the app, scoped to the page's resource", async ({
    expect,
  }) => {
    const server = await show(["monitor.down", "monitor.up"], "mon-1");
    await waitFor(() => expect(bell().hasAttribute("disabled")).toBe(false));
    fireEvent.click(bell());
    await waitFor(() => expect(server.rows).toHaveLength(2));
    expect(server.rows).toEqual([
      expect.objectContaining({
        event: "monitor.down",
        filter: "mon-1",
        channels: ["inapp"],
      }),
      expect.objectContaining({ event: "monitor.up", filter: "mon-1" }),
    ]);
    expect(
      server.calls.some((it) => it.toLowerCase().includes("automation")),
    ).toBe(false);
    await waitFor(() =>
      expect(bell().getAttribute("aria-pressed")).toBe("true"),
    );
  });

  const AUTHORS = {
    allLabel: "All feedback",
    notMineLabel: "All except mine",
    notMembersLabel: "All except project members'",
  };
  // Picks an option of the Control select inside `testId`.
  const pick = async (testId: string, option: string) => {
    const trigger = within(screen.getByTestId(testId)).getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: option }));
  };
  const MEMBER = ["project:read", "feedback:read", "subscription:read"];

  it("asks whose events through a From whom select, and keeps out the members' (#Q4055, #Q4290)", async ({
    expect,
  }) => {
    const server = await show(["feedback.created"], undefined, [], AUTHORS);
    await waitFor(() => expect(bell().hasAttribute("disabled")).toBe(false));

    // The first click opens the dialog rather than subscribing.
    fireEvent.click(bell());
    await screen.findByRole("dialog");
    expect(server.calls).not.toContain("setSubscription");

    await pick("subscription-bell-from", "All except project members'");
    fireEvent.click(screen.getByTestId("subscription-bell-confirm"));

    await waitFor(() => expect(server.rows).toHaveLength(1));
    expect(server.rows[0]).toEqual(
      expect.objectContaining({
        event: "feedback.created",
        channels: ["inapp"],
        notMembers: true,
      }),
    );
    expect(server.rows[0]?.notMine).toBeUndefined();
  });

  it("offers a plain member In-app and Email only, and never asks for the project's channels (#Q4290)", async ({
    expect,
  }) => {
    const server = await show(
      ["feedback.created"],
      undefined,
      [],
      AUTHORS,
      MEMBER,
    );
    await waitFor(() => expect(bell().hasAttribute("disabled")).toBe(false));
    fireEvent.click(bell());
    await screen.findByRole("dialog");
    const trigger = within(
      screen.getByTestId("subscription-bell-channels"),
    ).getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const options = (await screen.findAllByRole("option")).map(
      (it) => it.textContent,
    );
    expect(options).toEqual(["Inbox", "By email"]);
    expect(server.calls).not.toContain("listProjectChannels");
  });

  it("lets an admin route the bell to a project channel too: one channel row, no notMine on it, read back as picked (#Q4290)", async ({
    expect,
  }) => {
    const server = await show(["feedback.created"], undefined, [], AUTHORS);
    await waitFor(() => expect(bell().hasAttribute("disabled")).toBe(false));
    fireEvent.click(bell());
    await screen.findByRole("dialog");
    await waitFor(() => expect(server.calls).toContain("listProjectChannels"));

    await pick("subscription-bell-channels", "Team Discord");
    await pick("subscription-bell-from", "All except mine");
    fireEvent.click(screen.getByTestId("subscription-bell-confirm"));

    await waitFor(() => expect(server.rows).toHaveLength(2));
    const own = server.rows.find((it) => it.memberId === ME);
    const channel = server.rows.find((it) => it.channelId === "ch-1");
    expect(own).toEqual(
      expect.objectContaining({ channels: ["inapp"], notMine: true }),
    );
    expect(channel).toEqual(
      expect.objectContaining({ event: "feedback.created", channelId: "ch-1" }),
    );
    expect(channel?.notMine).toBeUndefined();

    // Opened again, the channel reads as picked; unpicked, its row goes.
    await waitFor(() =>
      expect(bell().getAttribute("aria-pressed")).toBe("true"),
    );
    fireEvent.click(bell());
    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        screen.getByTestId("subscription-bell-channels").textContent,
      ).toContain("Team Discord"),
    );
    await pick("subscription-bell-channels", "Team Discord");
    fireEvent.click(screen.getByTestId("subscription-bell-confirm"));
    await waitFor(() =>
      expect(server.rows.some((it) => it.channelId === "ch-1")).toBe(false),
    );
    expect(server.rows).toHaveLength(1);
  });

  it("shows partly on, and stops from its dialog", async ({ expect }) => {
    const server = await show(["monitor.down", "monitor.up"], undefined, [
      {
        id: "row-0",
        projectId: 1,
        event: "monitor.down",
        memberId: ME,
        channels: ["inapp"],
        createdAt: "2026-11-18T00:00:00.000Z",
      },
    ]);
    await waitFor(() =>
      expect(bell().getAttribute("data-partial")).toBe("true"),
    );
    fireEvent.click(bell());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stop notifying me" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Stop notifying me" }),
    );
    await waitFor(() => expect(server.rows).toHaveLength(0));
  });
});
