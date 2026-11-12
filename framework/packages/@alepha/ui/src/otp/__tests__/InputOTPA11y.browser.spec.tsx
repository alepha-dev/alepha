import { cleanup, render } from "@testing-library/react";
import { expectAccessible, setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "../InputOTP.tsx";

/**
 * axe on the one-time-code field, under jsdom (#Q3338).
 */
describe("InputOTP passes axe", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("six slots in two groups, named by its label", async () => {
    render(
      <main>
        <InputOTP maxLength={6} aria-label="Verification code">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </main>,
    );
    await expectAccessible();
  });
});
