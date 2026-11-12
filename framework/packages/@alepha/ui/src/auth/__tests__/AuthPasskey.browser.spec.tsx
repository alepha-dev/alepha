import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { AlephaContext } from "alepha/react";
import { AlephaReactAuth, PasskeyClient, ReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { AlephaServerLinks } from "alepha/server/links";
import { setupJsdomMocks, expectAccessible } from "alepha/testing/react";
import { MemoryPasskeyClient } from "alepha/testing/webauthn";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { AuthLogin } from "../AuthLogin.tsx";
import { AuthMfaStep } from "../AuthMfaStep.tsx";

/**
 * The sign-in side of passkeys, with `PasskeyClient` substituted by its
 * memory twin: the button and the autofill appear when the realm and the
 * browser allow them, the identifier keeps its hint with `webauthn`
 * appended, the autofill ceremony is aborted on unmount, and the second
 * factor step offers a passkey beside the code field. The full sign-in
 * against a realm is proven in node (`api/users/__tests__/passkey-react-auth.spec.ts`).
 */
/**
 * `loginPasskey` with no server behind it: straight to the ceremony, so the
 * spec sees exactly which ceremonies the page starts and aborts.
 */
class OfflineReactAuth extends ReactAuth {
  public override async loginPasskey(
    options: Parameters<ReactAuth["loginPasskey"]>[0] = {},
  ) {
    const result = await this.passkeys.get(
      { challenge: "Y2hhbGxlbmdl", allowCredentials: [] },
      { mediation: options.mediation, signal: options.signal },
    );
    return result.ok ? ({} as never) : undefined;
  }
}

describe("AuthLogin and AuthMfaStep - passkeys", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const realmConfig = (passkeys: "optional" | "disabled") =>
    ({
      realmName: "default",
      authenticationMethods: [{ type: "CREDENTIALS", name: "credentials" }],
      settings: {
        username: "none",
        email: "required",
        phoneNumber: "none",
        registrationAllowed: true,
        resetPasswordAllowed: false,
        passkeys,
      },
    }) as unknown as RealmConfig;

  const identifierHint = () =>
    document
      .querySelector('input:not([type="password"])[autocomplete]')
      ?.getAttribute("autocomplete");

  const mount = async (node: ReactNode, supported = true) => {
    alepha = Alepha.create()
      .with({ provide: PasskeyClient, use: MemoryPasskeyClient })
      .with({ provide: ReactAuth, use: OfflineReactAuth })
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(AlephaReactAuth)
      .with(AlephaServerLinks);
    await alepha.start();
    const client = alepha.inject(MemoryPasskeyClient);
    client.supported = supported;
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{node}</DialogProvider>
      </AlephaContext.Provider>,
    );
    return { view, client };
  };

  it("offers the passkey button and appends webauthn to the identifier's hint", async () => {
    await mount(<AuthLogin realmConfig={realmConfig("optional")} />);

    expect(screen.getByText("Sign in with a passkey")).toBeTruthy();
    expect(identifierHint()).toBe("email webauthn");
    // axe: the login form with its passkey button (#Q3338).
    await expectAccessible();
  });

  it("starts the autofill ceremony on mount and aborts it on unmount", async () => {
    const { view, client } = await mount(
      <AuthLogin realmConfig={realmConfig("optional")} />,
    );
    await waitFor(() => expect(client.pending).toHaveLength(1));
    view.unmount();
    await waitFor(() => expect(client.calls.aborted).toBe(1));
    expect(client.pending).toHaveLength(0);
  });

  it("aborts the autofill before the button's ceremony, and a dismissal is quiet", async () => {
    const { client } = await mount(
      <AuthLogin realmConfig={realmConfig("optional")} />,
    );
    await waitFor(() => expect(client.pending).toHaveLength(1));
    client.cancelNext = true;

    fireEvent.click(screen.getByText("Sign in with a passkey"));

    await waitFor(() => expect(client.calls.get).toBe(1));
    expect(client.calls.aborted).toBe(1);
    // Dismissed: no error on the page, and the autofill starts again.
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(client.pending).toHaveLength(1));
  });

  it("offers nothing when the realm has passkeys off", async () => {
    await mount(<AuthLogin realmConfig={realmConfig("disabled")} />);

    expect(screen.queryByText("Sign in with a passkey")).toBeNull();
    expect(identifierHint()).toBe("email");
  });

  it("offers nothing when the browser cannot use passkeys", async () => {
    await mount(<AuthLogin realmConfig={realmConfig("optional")} />, false);

    expect(screen.queryByText("Sign in with a passkey")).toBeNull();
  });

  it("offers a passkey beside the code field when the challenge allows it", async () => {
    await mount(
      <AuthMfaStep
        challenge={{ challenge: "c", methods: ["totp"], passkey: true }}
        onVerified={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("Use a passkey")).toBeTruthy();
    expect(screen.getByText("Verify")).toBeTruthy();
  });

  it("offers only the code when the challenge does not allow a passkey", async () => {
    await mount(
      <AuthMfaStep
        challenge={{ challenge: "c", methods: ["totp"], passkey: false }}
        onVerified={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByText("Use a passkey")).toBeNull();
    expect(screen.getByText("Verify")).toBeTruthy();
  });
});
