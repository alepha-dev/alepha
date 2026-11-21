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
import { AdminParameters } from "../AdminParameters.tsx";

const ORPHAN = "legacy.limits";

/**
 * The parameters admin API, as a fake server. `deleteParameter` answers
 * what `answer` holds, so a case can keep it in flight or refuse it.
 */
class Links extends LinkProvider {
  public answer: () => Promise<unknown> = async () => ({ ok: true });

  override client(): any {
    const actions: Record<string, any> = {
      getParameterTree: async () => [
        {
          name: ORPHAN,
          path: ORPHAN,
          isLeaf: true,
          origin: "orphan",
          children: [],
        },
      ],
      deleteParameter: () => this.answer(),
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

/**
 * Deleting an orphan runs as an action: its button is busy while the DELETE
 * is in flight, and a refusal reaches the app's action-error toaster
 * instead of a toast of the page's own.
 */
describe("AdminParameters orphan delete", () => {
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
          <AdminParameters />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    const toggle = await waitFor(() =>
      screen.getByRole("button", { name: /Show 1 orphan/ }),
    );
    fireEvent.click(toggle);
    return alepha.inject(Links);
  };

  const deleteAndConfirm = async () => {
    const trash = await waitFor(() =>
      screen.getByRole("button", { name: `Delete ${ORPHAN}` }),
    );
    fireEvent.click(trash);
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirm = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Delete",
    )!;
    await act(async () => {
      fireEvent.click(confirm);
    });
    return trash;
  };

  it("marks the delete button busy while the DELETE is in flight", async () => {
    const links = await mount();
    let settle: () => void = () => {};
    links.answer = () =>
      new Promise((resolve) => {
        settle = () => resolve({ ok: true });
      });
    const trash = await deleteAndConfirm();
    await waitFor(() => expect(trash.getAttribute("aria-busy")).toBe("true"));
    await act(async () => {
      settle();
    });
  });

  it("hands a refused delete to the action-error toaster", async () => {
    const links = await mount();
    const reported: unknown[] = [];
    alepha!.events.on("react:action:error", ({ error }) => {
      reported.push(error);
    });
    links.answer = async () => {
      throw new Error("403 Forbidden");
    };
    await deleteAndConfirm();
    await waitFor(() => expect(reported).toHaveLength(1));
  });
});
