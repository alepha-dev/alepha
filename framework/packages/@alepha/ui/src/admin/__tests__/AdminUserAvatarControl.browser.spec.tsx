import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { UserResource } from "alepha/api/users";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../core/Toaster.tsx";
import { AdminUserAvatarControl } from "../AdminUserAvatarControl.tsx";
import { AdminUserDetailIdentityAside } from "../AdminUserDetailIdentityAside.tsx";

/**
 * The avatar endpoints, faked at the link layer. `avatars` false is a realm
 * with avatars off: the actions are unregistered, so `can()` is false.
 */
class Links extends LinkProvider {
  public avatars = true;
  public calls: string[] = [];

  override client(): any {
    const actions: Record<string, any> = {
      updateUserAvatar: async () => {
        this.calls.push("updateUserAvatar");
        return { ...user, picture: "file-2" };
      },
      deleteUserAvatar: async () => {
        this.calls.push("deleteUserAvatar");
        return { ...user, picture: undefined };
      },
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => this.avatars;
        return action;
      },
    });
  }
}

const user = {
  id: "00000000-0000-4000-8000-0000000000a1",
  email: "ada@example.com",
  username: "ada",
  firstName: "Ada",
  lastName: "Lovelace",
  picture: "file-1",
  roles: ["user"],
  enabled: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
} as unknown as UserResource;

/**
 * The admin user page's avatar as its own edit control (#Q3663), and the
 * identity header that no longer repeats the email.
 */
describe("AdminUserAvatarControl", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    who: UserResource,
    options: { avatars?: boolean } = {},
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    const links = alepha.inject(LinkProvider) as Links;
    links.avatars = options.avatars ?? true;
    const changed: UserResource[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <Toaster />
        <AdminUserDetailIdentityAside
          user={who}
          renderAvatar={(avatar) => (
            <AdminUserAvatarControl
              user={who}
              onChanged={(next) => changed.push(next)}
            >
              {avatar}
            </AdminUserAvatarControl>
          )}
        />
      </AlephaContext.Provider>,
    );
    return { links, changed };
  };

  const openMenu = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    return await waitFor(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      if (items.length === 0) throw new Error("menu not open yet");
      return items.map((it) => it.textContent);
    });
  };

  it("titles the header by name, never by the email", async () => {
    await mount(user);

    const header = screen.getByTitle("Ada Lovelace");
    expect(header.textContent).toBe("Ada Lovelace");
    // The email is a row of the list, once, not the header too.
    expect(screen.getAllByText("ada@example.com")).toHaveLength(1);
  });

  it("falls back to @username", async () => {
    await mount({ ...user, firstName: undefined, lastName: undefined });
    expect(screen.getByTitle("@ada")).toBeTruthy();
  });

  it("is a labelled button opening Upload and Remove when the user has a picture", async () => {
    const { links, changed } = await mount(user);

    const button = screen.getByRole("button", { name: "Change avatar" });
    expect(button.tagName).toBe("BUTTON");
    expect(await openMenu()).toEqual([
      "Upload a new picture",
      "Remove picture",
    ]);

    fireEvent.click(screen.getByTestId("admin-avatar-remove"));
    await waitFor(() => expect(links.calls).toEqual(["deleteUserAvatar"]));
    await waitFor(() => expect(changed).toHaveLength(1));
  });

  it("offers Upload a picture alone when there is none, and uploads the file", async () => {
    const { links } = await mount({ ...user, picture: undefined });

    expect(await openMenu()).toEqual(["Upload a picture"]);
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("admin-avatar-file"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(links.calls).toEqual(["updateUserAvatar"]));
  });

  it("is the plain picture on a realm without avatars", async () => {
    await mount(user, { avatars: false });

    expect(screen.queryByRole("button", { name: "Change avatar" })).toBeNull();
    expect(screen.queryByTestId("admin-avatar-file")).toBeNull();
  });
});
