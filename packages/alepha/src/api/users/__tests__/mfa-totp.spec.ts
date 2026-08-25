import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import { TotpService } from "../services/TotpService.ts";

/**
 * RFC 6238 appendix B reference secret: the ASCII string "12345678901234567890"
 * in base32. Every vector below is taken from that table, truncated to the
 * 6 digits authenticator apps actually show.
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const totp = alepha.inject(TotpService);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  // Freeze the clock so `currentStep()` cannot roll over mid-assertion.
  dateTime.pause();
  return { totp, dateTime };
};

describe("alepha/api/users - TotpService", () => {
  it("should derive the RFC 6238 reference codes from their counters", async ({
    expect,
  }) => {
    const { totp } = await setup();

    // T=59s → counter 1, T=1111111109 → counter 37037036, and so on.
    expect(totp.codeForCounter(RFC_SECRET, 1)).toBe("287082");
    expect(totp.codeForCounter(RFC_SECRET, 37037036)).toBe("081804");
    expect(totp.codeForCounter(RFC_SECRET, 37037037)).toBe("050471");
    expect(totp.codeForCounter(RFC_SECRET, 41152263)).toBe("005924");
    expect(totp.codeForCounter(RFC_SECRET, 66666666)).toBe("279037");
    expect(totp.codeForCounter(RFC_SECRET, 666666666)).toBe("353130");
  });

  it("should accept a code from the current step or one step either side", async ({
    expect,
  }) => {
    const { totp } = await setup();
    const step = totp.currentStep();

    // The returned step is what the caller persists for replay protection,
    // so it has to identify which step actually matched.
    expect(totp.verify(RFC_SECRET, totp.codeForCounter(RFC_SECRET, step))).toBe(
      step,
    );
    expect(
      totp.verify(RFC_SECRET, totp.codeForCounter(RFC_SECRET, step - 1)),
    ).toBe(step - 1);
    expect(
      totp.verify(RFC_SECRET, totp.codeForCounter(RFC_SECRET, step + 1)),
    ).toBe(step + 1);
  });

  it("should reject a code from outside the accepted window", async ({
    expect,
  }) => {
    const { totp } = await setup();
    const step = totp.currentStep();

    expect(
      totp.verify(RFC_SECRET, totp.codeForCounter(RFC_SECRET, step + 2)),
    ).toBeUndefined();
    expect(
      totp.verify(RFC_SECRET, totp.codeForCounter(RFC_SECRET, step - 2)),
    ).toBeUndefined();
    expect(totp.verify(RFC_SECRET, "000000")).toBeUndefined();
  });

  it("should move the current step forward as time passes", async ({
    expect,
  }) => {
    const { totp, dateTime } = await setup();
    const step = totp.currentStep();

    await dateTime.travel(30, "seconds");

    expect(totp.currentStep()).toBe(step + 1);
  });

  it("should generate a distinct 160-bit secret every time", async ({
    expect,
  }) => {
    const { totp } = await setup();

    const first = totp.generateSecret();
    const second = totp.generateSecret();

    expect(first).not.toBe(second);
    // 160 bits is the RFC 4226 recommendation, which is 32 base32 characters.
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    // A generated secret has to survive the round trip through our own
    // decoder, otherwise enrollment hands out codes nothing can verify.
    expect(
      totp.verify(first, totp.codeForCounter(first, totp.currentStep())),
    ).toBe(totp.currentStep());
  });

  it("should build an otpauth URI an authenticator app can consume", async ({
    expect,
  }) => {
    const { totp } = await setup();

    const uri = new URL(
      totp.otpauthUri({
        secret: RFC_SECRET,
        account: "ada@example.com",
        issuer: "Capacity Portal",
      }),
    );

    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe(
      "/Capacity Portal:ada@example.com",
    );
    expect(uri.searchParams.get("secret")).toBe(RFC_SECRET);
    expect(uri.searchParams.get("issuer")).toBe("Capacity Portal");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });

  it("should render the enrollment URI as a self-contained SVG QR code", async ({
    expect,
  }) => {
    const { totp } = await setup();

    const svg = totp.qrSvg(
      totp.otpauthUri({
        secret: RFC_SECRET,
        account: "ada@example.com",
        issuer: "Capacity Portal",
      }),
    );

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    // No external references: the SVG is inlined into a page that a strict
    // CSP may well be guarding. The xmlns declaration is a namespace name,
    // not something the browser fetches, so it does not count.
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("href");
  });
});
