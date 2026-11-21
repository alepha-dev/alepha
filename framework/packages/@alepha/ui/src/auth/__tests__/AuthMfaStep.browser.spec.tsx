import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactAuth, ReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AuthMfaStep } from "../AuthMfaStep.tsx";

/**
 * `loginMfa` with no server behind it: records what was sent, and refuses
 * the code `refused` as a wrong one is refused.
 */
class RecordingReactAuth extends ReactAuth {
  public sent: Array<{ challenge: string; code: string }> = [];

  public override async loginMfa(challenge: string, code: string) {
    this.sent.push({ challenge, code });
    if (code === "refused") {
      throw new HttpError({ status: 401 }, { message: "Invalid code" });
    }
    return {} as never;
  }
}

/**
 * The second step of a sign-in takes a recovery code, which the six-slot
 * code field cannot carry: longer than six, with letters and hyphens.
 */
describe("AuthMfaStep - recovery code", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (methods: Array<"totp" | "emailCode">) => {
    alepha = Alepha.create()
      .with({ provide: ReactAuth, use: RecordingReactAuth })
      .with(AlephaReactI18n)
      .with(AlephaReactRouter)
      .with(AlephaReactAuth)
      .with(AlephaServerLinks);
    await alepha.start();
    const verified: number[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <AuthMfaStep
          challenge={{ challenge: "c", methods, passkey: false }}
          onVerified={() => {
            verified.push(1);
          }}
          onCancel={() => {}}
        />
      </AlephaContext.Provider>,
    );
    return { auth: alepha.inject(ReactAuth) as RecordingReactAuth, verified };
  };

  const submitRecovery = async (code: string) => {
    fireEvent.change(await screen.findByLabelText(/^Recovery code/), {
      target: { value: code },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  };

  it.each([
    ["the current format", "7k2m-9xqa-0fzt-h3wd"],
    ["the earlier format", "tyw8u-x5kp9"],
  ])("sends a recovery code in %s as typed", async (_label, code) => {
    const { auth, verified } = await mount(["totp"]);
    fireEvent.click(screen.getByText("Use a recovery code"));
    await submitRecovery(` ${code} `);

    await waitFor(() => expect(verified).toHaveLength(1));
    expect(auth.sent).toEqual([{ challenge: "c", code }]);
  });

  it("reports a refused recovery code and keeps the field", async () => {
    const { auth, verified } = await mount(["totp"]);
    fireEvent.click(screen.getByText("Use a recovery code"));
    await submitRecovery("refused");

    await screen.findByText("That code is not valid. Try again.");
    expect(auth.sent).toHaveLength(1);
    expect(verified).toEqual([]);
    expect(screen.getByLabelText(/^Recovery code/)).toBeTruthy();
  });

  it("goes back to the six-digit code", async () => {
    await mount(["totp"]);
    fireEvent.click(screen.getByText("Use a recovery code"));
    await screen.findByLabelText(/^Recovery code/);

    fireEvent.click(screen.getByText("Use a code from your authenticator app"));

    expect(screen.queryByLabelText(/^Recovery code/)).toBeNull();
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
  });

  it("offers no recovery code on an emailed code", async () => {
    await mount(["emailCode"]);

    expect(screen.queryByText("Use a recovery code")).toBeNull();
  });
});
