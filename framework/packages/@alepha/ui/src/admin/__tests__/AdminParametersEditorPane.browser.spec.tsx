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
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { AdminParametersEditorPane } from "../AdminParametersEditorPane.tsx";

/**
 * The parameters admin API, as a fake server whose `createVersion` refuses.
 */
class Links extends LinkProvider {
  public versions = 0;

  override client(): any {
    const actions: Record<string, any> = {
      getCurrent: async () => ({
        schema: {
          type: "object",
          properties: { greeting: { type: "string" } },
        },
        defaultValue: { greeting: "hello" },
        currentValue: { greeting: "bonjour" },
      }),
      createVersion: async () => {
        this.versions += 1;
        throw new Error("403 Forbidden");
      },
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => true;
        return action;
      },
    });
  }
}

describe("AdminParametersEditorPane", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  it("keeps the factory-reset dialog open when the reset is refused", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    const links = alepha.inject(Links);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AdminParametersEditorPane
            name="app.greeting"
            reloadKey={0}
            onSaved={() => {}}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const open = await waitFor(() =>
      screen.getByRole("button", { name: /Factory reset/ }),
    );
    fireEvent.click(open);
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    const confirm = [...dialog.querySelectorAll("button")].find((button) =>
      /Factory reset/.test(button.textContent ?? ""),
    )!;
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(links.versions).toBe(1));
    // Settled: the run resolved `{ ok: false }` and the dialog is still up.
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });
});
