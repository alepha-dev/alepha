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
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { I18n } from "../../services/I18n.ts";
import { AutomationSubscriptionBell } from "./AutomationSubscriptionBell.tsx";

/**
 * The server's side of the subscription, in memory: what the bell reads on
 * load and what each toggle sent. Substitution rather than `vi.mock`.
 */
class FakeLinkProvider extends LinkProvider {
  public subscribed = false;
  public sets: Array<Record<string, unknown>> = [];
  public gets = 0;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async (input: any) => {
          if (prop === "getAutomationSubscription") {
            this.gets++;
            return this.state();
          }
          if (prop === "setAutomationSubscription") {
            this.sets.push(input.body);
            this.subscribed = input.body.subscribed;
            return this.state();
          }
          return {};
        },
      },
    );
  }

  protected state() {
    return this.subscribed
      ? {
          subscribed: true,
          automationId: RULE,
          channel: "email",
          channels: ["email", "inbox"],
        }
      : { subscribed: false };
  }
}

const RULE = "00000000-0000-4000-8000-000000000042";

describe("AutomationSubscriptionBell", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    // The channel choice is a `Segmented`, which measures its own thumb.
    setupJsdomMocks();
  });
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (over: { subscribed?: boolean; work?: boolean } = {}) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    const server = alepha.inject(FakeLinkProvider);
    server.subscribed = over.subscribed ?? false;
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({
        capabilities: (over.work ?? true) ? ["plan"] : [],
      }),
    );
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AutomationSubscriptionBell
            presetKey="feedback-created"
            label="Notify me of new feedback"
            description="A rule will notify you of every new feedback."
            offDescription="You will no longer be notified of new feedback."
            testId="bell"
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return server;
  };

  const bell = () => screen.getByTestId("bell");

  it("reads its state from the server on load", async ({ expect }) => {
    const server = await show({ subscribed: true });
    await waitFor(() =>
      expect(bell().getAttribute("aria-pressed")).toBe("true"),
    );
    expect(server.gets).toBe(1);
  });

  it("turns on through a dialog offering in-app, email or both (#Q3602)", async ({
    expect,
  }) => {
    const server = await show();
    await waitFor(() => expect(bell().hasAttribute("disabled")).toBe(false));
    expect(bell().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(bell());
    await screen.findByText("A rule will notify you of every new feedback.");
    const inApp = screen.getByRole("checkbox", { name: "In-app" });
    const email = screen.getByRole("checkbox", { name: "Email" });
    expect(inApp.getAttribute("aria-checked")).toBe("true");
    expect(email.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(email);
    // At least one: with none ticked there is nothing to subscribe.
    fireEvent.click(inApp);
    fireEvent.click(email);
    await waitFor(() =>
      expect(
        screen
          .getByTestId("automation-subscription-confirm")
          .hasAttribute("disabled"),
      ).toBe(true),
    );
    fireEvent.click(inApp);
    fireEvent.click(email);
    fireEvent.click(screen.getByTestId("automation-subscription-confirm"));

    await waitFor(() =>
      expect(server.sets).toEqual([
        { subscribed: true, channels: ["inbox", "email"] },
      ]),
    );
    await waitFor(() =>
      expect(bell().getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("reopens on its channels, and turns off after a confirmation, not when it is cancelled", async ({
    expect,
  }) => {
    const server = await show({ subscribed: true });
    await waitFor(() =>
      expect(bell().getAttribute("aria-pressed")).toBe("true"),
    );

    // Reopening shows the channels the subscription has (#Q3602).
    fireEvent.click(bell());
    await screen.findByText("A rule will notify you of every new feedback.");
    expect(
      screen
        .getByRole("checkbox", { name: "In-app" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("checkbox", { name: "Email" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByText("You will no longer be notified of new feedback.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByText("You will no longer be notified of new feedback."),
      ).toBeNull(),
    );
    expect(server.sets).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByText("You will no longer be notified of new feedback.");
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Unsubscribe",
      }),
    );
    await waitFor(() => expect(server.sets).toEqual([{ subscribed: false }]));
    await waitFor(() =>
      expect(bell().getAttribute("aria-pressed")).toBe("false"),
    );
  });

  it("is not drawn when the project has Work off", async ({ expect }) => {
    const server = await show({ work: false });
    expect(screen.queryByTestId("bell")).toBeNull();
    expect(server.gets).toBe(0);
  });
});
