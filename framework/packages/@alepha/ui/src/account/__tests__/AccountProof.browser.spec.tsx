import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import type { MyIdentity, PasskeyProofKind } from "alepha/api/users";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactAuth, PasskeyClient } from "alepha/react/auth";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { HttpError } from "alepha/server";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { MemoryPasskeyClient } from "alepha/testing/webauthn";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { usePasskey } from "../../auth/usePasskey.ts";
import { DialogProvider } from "../../core/useDialog.tsx";
import { AccountMfaDialog } from "../AccountMfaDialog.tsx";
import { AccountPasswordDialog } from "../AccountPasswordDialog.tsx";
import AccountSecurity from "../AccountSecurity.tsx";

const PASSWORD: MyIdentity = {
  id: "00000000-0000-4000-8000-000000000031",
  provider: "credentials",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const GITHUB: MyIdentity = {
  id: "00000000-0000-4000-8000-000000000032",
  provider: "github",
  providerUserId: "12345",
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
};

/**
 * The dialogs as `AccountSecurityView` mounts them: `prove` is the page's
 * `usePasskey().prove`.
 */
const MfaDialog = (props: { proof?: PasskeyProofKind }) => (
  <AccountMfaDialog
    open
    proof={props.proof}
    prove={usePasskey().prove}
    onOpenChange={() => {}}
  />
);

/**
 * The two-factor dialog behind a button, opened and closed as the Security
 * page does it: it stays mounted while closed.
 */
const MfaDialogToggle = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <AccountMfaDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

const PasswordDialog = (props: { proof: PasskeyProofKind }) => (
  <AccountPasswordDialog
    open
    hasPassword={false}
    proof={props.proof}
    prove={usePasskey().prove}
    onOpenChange={() => {}}
  />
);

/**
 * A refusal as the server names it, so the page can tell a refused proof
 * from a refused code.
 */
const refusal = (name: string, message: string) =>
  Object.assign(new HttpError({ status: 400 }, { message }), { name });

/**
 * Stands in for the account controllers: answers the reads, refuses the
 * password `wrong` and the code `000000` as the server does, and records
 * every write.
 */
class Links extends LinkProvider {
  public proof: PasskeyProofKind = "password";
  public identities: MyIdentity[] = [PASSWORD, GITHUB];
  public writes: Array<{ name: string; input: any }> = [];
  public enrollFails = false;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "listMyIdentities") return this.identities;
            if (name === "getRealmConfig") return undefined;
            if (name === "getMyMfa") {
              return {
                totp: { enabled: false, pending: false, recoveryCodesLeft: 0 },
              };
            }
            if (name === "getMyPasskeys") {
              return { proof: this.proof, items: [] };
            }
            if (name === "enrollTotp") {
              if (this.enrollFails) {
                throw refusal("BAD_REQUEST", "Enrollment refused");
              }
              return {
                secret: "JBSWY3DPEHPK3PXP",
                uri: "otpauth://totp/Test:ada",
                qrSvg: "<svg></svg>",
              };
            }
            if (name === "createMyPasskeyProofOptions") {
              return { challenge: "cHJvb2Y", rpId: "localhost" };
            }
            const password =
              input?.body?.proof?.currentPassword ??
              input?.body?.currentPassword;
            if (password === "wrong") {
              throw refusal(
                "PASSKEY_PASSWORD_PROOF",
                "Current password is incorrect",
              );
            }
            if (name === "activateTotp" && input?.body?.code === "000000") {
              throw refusal("BAD_REQUEST", "That code is not valid");
            }
            this.writes.push({ name, input });
            if (name === "activateTotp") {
              return { recoveryCodes: ["7k2m-9xqa-0fzt-h3wd"] };
            }
            // Both writes change the proof the server asks for next, as
            // `PasskeyService.proofKind` does: a password once there is one,
            // nothing once it is gone (no passkey here is usable).
            if (name === "setMyFirstPassword") {
              this.identities = [PASSWORD, ...this.identities];
              this.proof = "password";
            }
            if (name === "removeMyPassword") {
              this.identities = [GITHUB];
              this.proof = "none";
              return { otherSessionsRevoked: 0 };
            }
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
 * The proof a change to how the account signs in asks for, on the three
 * account screens that make one outside the passkey card: turning two-factor
 * on, removing the password, setting a first password.
 */
describe("account - proof before a sign-in change", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    node: ReactNode,
    setup: (links: Links) => void = () => {},
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
    setup(links);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{node}</DialogProvider>
      </AlephaContext.Provider>,
    );
    return { links, client };
  };

  /**
   * The device holds one of the account's passkeys.
   */
  const holdPasskey = (client: MemoryPasskeyClient) =>
    client.create({
      rp: { id: "localhost", name: "Test" },
      user: { id: "dXNlcg", name: "ada", displayName: "Ada" },
      challenge: "c2VlZA",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    });

  const typeCode = async (code: string) => {
    await screen.findByText("Cannot scan the code?");
    const input = document.querySelector<HTMLInputElement>(
      "input[data-input-otp]",
    )!;
    fireEvent.change(input, { target: { value: code } });
  };

  const typePassword = async (value: string) => {
    fireEvent.change(await screen.findByLabelText("Current password"), {
      target: { value },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  };

  describe("AccountMfaDialog", () => {
    it("asks for the current password once the code is typed, and sends both", async () => {
      const { links } = await mount(<MfaDialog proof="password" />);
      await typeCode("123456");

      await typePassword("wrong");
      // Under the field, with the dialog and the code kept.
      await screen.findByText("Current password is incorrect");
      expect(links.writes).toEqual([]);

      await typePassword("Secret-123");
      await screen.findByText("7k2m-9xqa-0fzt-h3wd");
      expect(links.writes).toEqual([
        {
          name: "activateTotp",
          input: {
            body: {
              code: "123456",
              proof: { currentPassword: "Secret-123" },
            },
          },
        },
      ]);
    });

    it("shows a refused code above the code field and closes the proof", async () => {
      const { links } = await mount(<MfaDialog proof="password" />);
      await typeCode("000000");
      await typePassword("Secret-123");

      await screen.findByText("That code is not valid");
      await waitFor(() =>
        expect(screen.queryByLabelText("Current password")).toBeNull(),
      );
      expect(links.writes).toEqual([]);
    });

    it("confirms with a passkey when that is the account's proof", async () => {
      const { links, client } = await mount(<MfaDialog proof="passkey" />);
      await holdPasskey(client);
      await typeCode("123456");
      fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

      await screen.findByText("7k2m-9xqa-0fzt-h3wd");
      expect(links.writes[0]!.input.body.proof.assertion.type).toBe(
        "public-key",
      );
    });

    it("keeps nothing of the enrollment once closed", async () => {
      const { links } = await mount(<MfaDialogToggle />);
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      await typeCode("123456");
      expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
      fireEvent.click(
        await screen.findByRole("button", { name: "I have saved them" }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      // Reopened, the next enrollment fails: the activated seed of the last
      // one must not be shown, because it must not be kept at all.
      links.enrollFails = true;
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      await screen.findByText(/Could not start the enrollment/);
      expect(screen.queryByText("JBSWY3DPEHPK3PXP")).toBeNull();
    });

    it("asks nothing of an account that owes no proof", async () => {
      const { links } = await mount(<MfaDialog />);
      await typeCode("123456");

      await screen.findByText("7k2m-9xqa-0fzt-h3wd");
      expect(links.writes).toEqual([
        { name: "activateTotp", input: { body: { code: "123456" } } },
      ]);
    });
  });

  describe("AccountSecurity", () => {
    const openRemove = async (provider: string) => {
      fireEvent.click(await screen.findByLabelText(`Remove ${provider}`));
      fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    };

    it("removes the password through its own route, with the current password", async () => {
      const { links } = await mount(<AccountSecurity />);
      await openRemove("credentials");

      await typePassword("wrong");
      await screen.findByText("Current password is incorrect");
      expect(links.writes).toEqual([]);

      await typePassword("Secret-123");
      await waitFor(() =>
        expect(links.writes).toEqual([
          {
            name: "removeMyPassword",
            input: { body: { currentPassword: "Secret-123" } },
          },
        ]),
      );
      // The list is read again: the password row is gone.
      await waitFor(() =>
        expect(screen.queryByLabelText("Remove credentials")).toBeNull(),
      );
    });

    it("unlinks a provider identity with no proof", async () => {
      const { links } = await mount(<AccountSecurity />);
      await openRemove("github");

      await waitFor(() =>
        expect(links.writes).toEqual([
          { name: "unlinkMyIdentity", input: { params: { id: GITHUB.id } } },
        ]),
      );
      expect(screen.queryByLabelText("Current password")).toBeNull();
    });

    const openMfaSetUp = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
      await typeCode("123456");
    };

    it("asks for the new password, not the passkey, once a first password is set", async () => {
      const { links, client } = await mount(<AccountSecurity />, (links) => {
        links.identities = [GITHUB];
        links.proof = "passkey";
      });
      await holdPasskey(client);

      fireEvent.click(
        await screen.findByRole("button", { name: "Set a password" }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/^New password/), {
        target: { value: "Correct-Horse-1" },
      });
      fireEvent.change(within(dialog).getByLabelText(/^Confirm new password/), {
        target: { value: "Correct-Horse-1" },
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Set a password" }),
      );
      await screen.findByLabelText("Remove credentials");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      await openMfaSetUp();
      await typePassword("Secret-123");
      await screen.findByText("7k2m-9xqa-0fzt-h3wd");
      expect(links.writes.at(-1)).toEqual({
        name: "activateTotp",
        input: {
          body: { code: "123456", proof: { currentPassword: "Secret-123" } },
        },
      });
    });

    it("asks for no password once the password is removed", async () => {
      const { links } = await mount(<AccountSecurity />);
      await openRemove("credentials");
      await typePassword("Secret-123");
      await waitFor(() =>
        expect(screen.queryByLabelText("Remove credentials")).toBeNull(),
      );
      await waitFor(() =>
        expect(screen.queryByLabelText("Current password")).toBeNull(),
      );

      await openMfaSetUp();
      await screen.findByText("7k2m-9xqa-0fzt-h3wd");
      expect(screen.queryByLabelText("Current password")).toBeNull();
      expect(links.writes.at(-1)).toEqual({
        name: "activateTotp",
        input: { body: { code: "123456" } },
      });
    });
  });

  describe("AccountPasswordDialog", () => {
    const setFirstPassword = async () => {
      fireEvent.change(await screen.findByLabelText(/^New password/), {
        target: { value: "Correct-Horse-1" },
      });
      fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
        target: { value: "Correct-Horse-1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Set a password" }));
    };

    it("confirms a first password with the account's passkey", async () => {
      const { links, client } = await mount(<PasswordDialog proof="passkey" />);
      await holdPasskey(client);
      expect(screen.getByText(/confirm with a passkey first/)).toBeTruthy();
      await setFirstPassword();

      await waitFor(() =>
        expect(links.writes.map((it) => it.name)).toEqual([
          "setMyFirstPassword",
        ]),
      );
      expect(links.writes[0]!.input.body.password).toBe("Correct-Horse-1");
      expect(links.writes[0]!.input.body.proof.assertion.type).toBe(
        "public-key",
      );
      expect(client.calls.get).toBe(1);
    });

    it("sets nothing when the passkey prompt is dismissed", async () => {
      const { links, client } = await mount(<PasswordDialog proof="passkey" />);
      await holdPasskey(client);
      client.cancelNext = true;
      await setFirstPassword();

      await waitFor(() => expect(client.calls.get).toBe(1));
      expect(links.writes).toEqual([]);
    });

    it("sends no proof from an account that holds none", async () => {
      const { links } = await mount(<PasswordDialog proof="none" />);
      await setFirstPassword();

      await waitFor(() =>
        expect(links.writes).toEqual([
          {
            name: "setMyFirstPassword",
            input: { body: { password: "Correct-Horse-1", proof: undefined } },
          },
        ]),
      );
    });
  });
});
