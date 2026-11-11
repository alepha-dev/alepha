import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { MyPasskey, RealmConfig } from "alepha/api/users";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactAuth, PasskeyClient } from "alepha/react/auth";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { HttpError } from "alepha/server";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { MemoryPasskeyClient } from "alepha/testing/webauthn";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { AccountPasskeys } from "../AccountPasskeys.tsx";

const LAPTOP: MyPasskey = {
  id: "00000000-0000-4000-8000-000000000021",
  name: "Laptop",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastUsedAt: "2026-11-05T10:00:00.000Z",
  backedUp: true,
  usable: true,
};

/**
 * Stands in for `MyPasskeyController`: answers the list with a given proof,
 * refuses a wrong password, and records every write.
 */
class Links extends LinkProvider {
  public proof: "password" | "passkey" | "none" = "password";
  public items: MyPasskey[] = [LAPTOP];
  public writes: Array<{ name: string; input: any }> = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "getMyPasskeys") {
              return { proof: this.proof, items: this.items };
            }
            if (name === "createMyPasskeyOptions") {
              return {
                rp: { id: "localhost", name: "Test" },
                user: { id: "dXNlcg", name: "ada", displayName: "Ada" },
                challenge: "Y3JlYXRl",
                pubKeyCredParams: [{ type: "public-key", alg: -7 }],
              };
            }
            if (name === "createMyPasskeyProofOptions") {
              return { challenge: "cHJvb2Y", rpId: "localhost" };
            }
            if (
              (name === "createMyPasskey" || name === "deleteMyPasskey") &&
              input?.body?.proof?.currentPassword === "wrong"
            ) {
              throw new HttpError(
                { status: 400 },
                { message: "Current password is incorrect" },
              );
            }
            this.writes.push({ name, input });
            return { ok: true };
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

/**
 * The account's Passkeys card, with `PasskeyClient` substituted by its
 * memory twin: the list, and the proof the list names before an add or a
 * removal.
 */
describe("AccountPasskeys", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    setup: (links: Links, client: MemoryPasskeyClient) => void = () => {},
    realmConfig?: RealmConfig,
  ) => {
    alepha = Alepha.create()
      .with({ provide: PasskeyClient, use: MemoryPasskeyClient })
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactAuth);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const links = alepha.inject(LinkProvider) as Links;
    const client = alepha.inject(MemoryPasskeyClient);
    setup(links, client);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AccountPasskeys realmConfig={realmConfig} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("Laptop");
    return { links, client };
  };

  /**
   * Fill and confirm the name prompt.
   */
  const confirmName = async () => {
    fireEvent.click(screen.getAllByText("Add a passkey").at(-1)!);
    const confirm = await screen.findByRole("button", {
      name: "Add a passkey",
    });
    fireEvent.click(confirm);
  };

  it("lists the passkeys with their synced badge", async () => {
    await mount();
    expect(screen.getByText("Synced")).toBeTruthy();
    expect(screen.getByText(/last used/)).toBeTruthy();
  });

  it("asks for the current password before adding, and keeps the dialog open on a wrong one", async () => {
    const { links } = await mount();
    await confirmName();

    const password = await screen.findByLabelText("Current password");
    fireEvent.change(password, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Current password is incorrect");
    expect(links.writes).toEqual([]);

    fireEvent.change(password, { target: { value: "Secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(links.writes.map((it) => it.name)).toEqual(["createMyPasskey"]),
    );
    expect(links.writes[0]!.input.body.proof).toEqual({
      currentPassword: "Secret-123",
    });
  });

  it("adds with no dialog when the account owes no proof", async () => {
    const { links } = await mount((it) => {
      it.proof = "none";
    });
    await confirmName();
    await waitFor(() =>
      expect(links.writes.map((it) => it.name)).toEqual(["createMyPasskey"]),
    );
    expect(links.writes[0]!.input.body.proof).toBeUndefined();
  });

  it("proves with an existing passkey, then creates the new one", async () => {
    const { links, client } = await mount((it) => {
      it.proof = "passkey";
    });
    // The device holds the account's existing passkey.
    await client.create({
      rp: { id: "localhost", name: "Test" },
      user: { id: "dXNlcg", name: "ada", displayName: "Ada" },
      challenge: "c2VlZA",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    });
    await confirmName();
    expect(await screen.findByText(/two prompts/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(links.writes.map((it) => it.name)).toEqual(["createMyPasskey"]),
    );
    expect(links.writes[0]!.input.body.proof.assertion.type).toBe("public-key");
    expect(client.calls.get).toBe(1);
  });

  it("writes nothing when the ceremony is dismissed", async () => {
    const { links, client } = await mount((it) => {
      it.proof = "none";
    });
    client.cancelNext = true;
    await confirmName();
    await waitFor(() => expect(client.calls.create).toBe(1));
    expect(links.writes).toEqual([]);
  });

  it("removes after a confirm and the password", async () => {
    const { links } = await mount();
    fireEvent.click(screen.getByLabelText("Remove Laptop"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.change(await screen.findByLabelText("Current password"), {
      target: { value: "Secret-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(links.writes.map((it) => it.name)).toEqual(["deleteMyPasskey"]),
    );
  });

  it("keeps a passkey enrolled before the realm turned them off listed, with no add", async () => {
    await mount(() => {}, {
      settings: { passkeys: "disabled" },
    } as unknown as RealmConfig);
    expect(screen.getByText("Laptop")).toBeTruthy();
    expect(screen.queryByText("Add a passkey")).toBeNull();
  });
});
