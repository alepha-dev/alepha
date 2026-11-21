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
import { AdminUserDetail } from "../AdminUserDetail.tsx";

const USER_ID = "0192e4c4-0000-7000-8000-0000000000a1";

/**
 * The users admin API, as a fake server: a user created without a password,
 * which `setUserPassword` gives a `credentials` identity, as
 * `UserService.setPassword` does.
 */
class Links extends LinkProvider {
  public hasPassword = false;
  public passwordsSet = 0;

  override client(): any {
    const actions: Record<string, any> = {
      getUser: async () => ({
        id: USER_ID,
        username: "ada",
        email: "ada@example.app",
        enabled: true,
        roles: [],
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-01T10:00:00.000Z",
      }),
      findRoles: async () => [],
      findIdentities: async () => ({
        content: this.hasPassword
          ? [{ id: "id-credentials", provider: "credentials" }]
          : [],
        page: {},
      }),
      getRealmConfig: async () => ({ settings: {} }),
      setUserPassword: async () => {
        this.passwordsSet += 1;
        this.hasPassword = true;
        return { ok: true, id: USER_ID };
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

describe("AdminUserDetail", () => {
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
    // `render` runs no navigation: give the page the param a route would.
    const state = alepha.store.get("alepha.react.router.state");
    alepha.store.set("alepha.react.router.state", {
      ...state,
      params: { userId: USER_ID },
    } as any);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AdminUserDetail />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    const security = await waitFor(() =>
      screen.getByRole("radio", { name: /Security/ }),
    );
    await act(async () => {
      fireEvent.click(security);
    });
    await waitFor(() =>
      expect(screen.getByText(/No password is set yet/)).toBeTruthy(),
    );
    return alepha.inject(Links);
  };

  const openPasswordDialog = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Set password/ }));
    return await waitFor(() => screen.getByRole("dialog"));
  };

  it("says the user's sessions are signed out when a password is set", async () => {
    await mount();
    const dialog = await openPasswordDialog();
    expect(dialog.textContent).toContain(
      "Every session the user has open is signed out.",
    );
    expect(dialog.textContent).not.toContain("not revoked");
  });

  it("shows the new password at once, without a reload", async () => {
    const links = await mount();
    const dialog = await openPasswordDialog();
    const input = dialog.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    fireEvent.change(input, { target: { value: "correct-horse" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    await waitFor(() => expect(links.passwordsSet).toBe(1));
    await waitFor(() =>
      expect(screen.getByText(/A password is set/)).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /Change password/ }),
    ).toBeTruthy();
  });
});
