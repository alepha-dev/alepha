import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { AdminKeys } from "../AdminKeys.tsx";

/**
 * The admin API, as a fake server. `listApiKeys` (the admin's own keys, read
 * when the create dialog opens) answers what `ownKeys` holds.
 */
class Links extends LinkProvider {
  public ownKeys: () => Promise<unknown> = async () => [];

  override client(): any {
    const empty = {
      content: [],
      page: {
        number: 0,
        size: 10,
        offset: 0,
        numberOfElements: 0,
        totalElements: 0,
        totalPages: 0,
        isEmpty: true,
        isFirst: true,
        isLast: true,
      },
    };
    const actions: Record<string, any> = {
      listApiKeys: () => this.ownKeys(),
      getApiKeyOptions: async () => ({
        expiry: { default: "30d", maxDays: 0, presets: ["30d", "never"] },
        permissions: { groups: [] },
      }),
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => empty);
        action.can = () => true;
        return action;
      },
    });
  }
}

/**
 * Add API key first reads the admin's own keys, for the names the new one
 * may not take. That read is an action: the button holds while it runs, a
 * failure reaches the action-error toaster, and the dialog still opens (the
 * server refuses a clash on its own).
 */
describe("AdminKeys create", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AdminKeys />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    const add = await waitFor(() =>
      screen.getByRole("button", { name: /Add API key/ }),
    );
    return { links: alepha.inject(Links), add: add as HTMLButtonElement };
  };

  it("holds the button while the admin's own keys are read", async () => {
    const { links, add } = await mount();
    let settle: () => void = () => {};
    links.ownKeys = () =>
      new Promise((resolve) => {
        settle = () => resolve([]);
      });
    await act(async () => {
      fireEvent.click(add);
    });
    await waitFor(() => expect(add.disabled).toBe(true));
    await act(async () => {
      settle();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("reports a failed read and still opens the dialog", async () => {
    const { links, add } = await mount();
    const reported: string[] = [];
    alepha!.events.on("react:action:error", ({ error }) => {
      reported.push(error.message);
    });
    links.ownKeys = async () => {
      throw new Error("own keys unavailable");
    };
    await act(async () => {
      fireEvent.click(add);
    });
    await waitFor(() => expect(reported).toContain("own keys unavailable"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });
});
