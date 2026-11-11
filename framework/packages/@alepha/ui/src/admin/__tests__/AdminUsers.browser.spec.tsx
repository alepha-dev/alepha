import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { UserEntity } from "alepha/api/users";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../core/Toaster.tsx";
import { DialogProvider } from "../../core/useDialog.tsx";
import { AdminUsers } from "../AdminUsers.tsx";

const user = (over: Partial<UserEntity>): UserEntity => ({
  id: "0192e4c4-0000-7000-8000-000000000001",
  version: 0,
  createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  realm: "users",
  email: "ada@example.app",
  roles: ["user"],
  enabled: true,
  emailVerified: true,
  ...over,
});

/**
 * The users admin API, as a fake server. `calls` records every write,
 * `settings` is what the realm config answers, and `denied` names the actions
 * the signed-in admin has no permission for.
 */
class Links extends LinkProvider {
  public calls: Array<{ name: string; args: any }> = [];
  public settings: Record<string, unknown> = {
    email: "required",
    username: "email",
  };
  public denied: string[] = [];
  public users: UserEntity[] = [user({})];

  override client(): any {
    const page = (content: unknown[]) => ({
      content,
      page: {
        number: 0,
        size: 10,
        offset: 0,
        numberOfElements: content.length,
        totalElements: content.length,
        totalPages: 1,
        isEmpty: content.length === 0,
        isFirst: true,
        isLast: true,
      },
    });
    const actions: Record<string, any> = {
      findUsers: async () => page(this.users),
      findRoles: async () => [],
      getRealmConfig: async () => ({ settings: this.settings }),
      createUser: async (args: any) => {
        this.calls.push({ name: "createUser", args });
        const created = user({
          id: "0192e4c4-0000-7000-8000-000000000002",
          email: undefined,
          ...args.body,
        });
        this.users = [...this.users, created];
        return created;
      },
      setUserPassword: async (args: any) => {
        this.calls.push({ name: "setUserPassword", args });
        return { ok: true, id: args.params.id };
      },
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => !this.denied.includes(key);
        return action;
      },
    });
  }
}

describe("AdminUsers", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (setup?: (links: Links) => void) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    const links = alepha.inject(Links);
    setup?.(links);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <AdminUsers />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.getByText("ada@example.app")).toBeTruthy(),
    );
    return links;
  };

  const field = (name: string) =>
    document.querySelector<HTMLInputElement>(
      `[role="dialog"] form [id$="-${name}"]`,
    );

  const openDialog = async (first: string) => {
    fireEvent.click(screen.getByRole("button", { name: /Create user/ }));
    return await waitFor(() => {
      const input = field(first);
      expect(input).toBeTruthy();
      return input!;
    });
  };

  it("creates a user from the dialog, sets the password, and reloads the table", async () => {
    const links = await mount();
    const email = await openDialog("email");
    // The realm derives the username from the email: it is not asked for.
    expect(field("username")).toBeNull();

    fireEvent.change(email, { target: { value: " grace@example.app " } });
    fireEvent.change(field("firstName")!, { target: { value: "Grace" } });
    fireEvent.change(field("password")!, { target: { value: "Sup3rSecret" } });
    fireEvent.submit(email.closest("form")!);

    await waitFor(() => expect(screen.getByText("User created")).toBeTruthy());
    const create = links.calls.find((it) => it.name === "createUser")!;
    // Blank fields are left out rather than sent as "".
    expect(create.args.body).toEqual({
      email: "grace@example.app",
      firstName: "Grace",
    });
    const password = links.calls.find((it) => it.name === "setUserPassword")!;
    expect(password.args.params.id).toBe(
      "0192e4c4-0000-7000-8000-000000000002",
    );
    expect(password.args.body).toEqual({ password: "Sup3rSecret" });

    await waitFor(() =>
      expect(screen.getByText("grace@example.app")).toBeTruthy(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("refuses a blank email on a realm that requires one, without calling the server", async () => {
    const links = await mount();
    const email = await openDialog("email");
    fireEvent.submit(email.closest("form")!);
    await waitFor(() =>
      expect(screen.getByText("Email is required")).toBeTruthy(),
    );
    expect(links.calls).toHaveLength(0);
  });

  it("asks for a username on a realm that collects one, and skips the password call when blank", async () => {
    const links = await mount((it) => {
      it.settings = { email: "none", username: "required" };
    });
    const username = await openDialog("username");
    expect(field("email")).toBeNull();

    fireEvent.change(username, { target: { value: "grace" } });
    fireEvent.submit(username.closest("form")!);
    await waitFor(() => expect(screen.getByText("User created")).toBeTruthy());
    expect(links.calls.map((it) => it.name)).toEqual(["createUser"]);
    expect(links.calls[0].args.body).toEqual({ username: "grace" });
  });

  it("hides the button without the create permission", async () => {
    await mount((it) => {
      it.denied = ["createUser"];
    });
    expect(screen.queryByRole("button", { name: /Create user/ })).toBeNull();
  });
});
