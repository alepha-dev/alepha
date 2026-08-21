import { PaymentStatus } from "@mollie/api-client";
import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { MolliePaymentProvider } from "../MolliePaymentProvider.ts";

class TestMollieProvider extends MolliePaymentProvider {
  public toAmount = this.toMollieAmount.bind(this);
  public status = this.mapStatus.bind(this);
}

const make = () =>
  Alepha.create({
    env: { MOLLIE_API_KEY: "test_dummyApiKeyForUnitTests" },
  }).inject(TestMollieProvider);

describe("MolliePaymentProvider", () => {
  describe("toMollieAmount", () => {
    it("formats two-decimal currencies from minor units", () => {
      const provider = make();
      expect(provider.toAmount(1050, "EUR")).toEqual({
        value: "10.50",
        currency: "EUR",
      });
      expect(provider.toAmount(1, "USD")).toEqual({
        value: "0.01",
        currency: "USD",
      });
    });

    it("uppercases the currency code", () => {
      const provider = make();
      expect(provider.toAmount(200, "eur").currency).toBe("EUR");
    });

    it("formats zero-decimal currencies without a decimal point", () => {
      const provider = make();
      // ¥1000 is stored as 1000 minor units (the yen has no subunit).
      expect(provider.toAmount(1000, "JPY")).toEqual({
        value: "1000",
        currency: "JPY",
      });
      expect(provider.toAmount(500, "ISK")).toEqual({
        value: "500",
        currency: "ISK",
      });
      expect(provider.toAmount(250, "KRW")).toEqual({
        value: "250",
        currency: "KRW",
      });
    });

    it("formats three-decimal currencies with three decimals", () => {
      const provider = make();
      expect(provider.toAmount(1234, "BHD")).toEqual({
        value: "1.234",
        currency: "BHD",
      });
      expect(provider.toAmount(5, "KWD")).toEqual({
        value: "0.005",
        currency: "KWD",
      });
    });
  });

  describe("mapStatus", () => {
    it("maps paid to captured", () => {
      expect(make().status(PaymentStatus.paid)).toBe("captured");
    });

    it("maps authorized to authorized", () => {
      expect(make().status(PaymentStatus.authorized)).toBe("authorized");
    });

    it("maps terminal failure states to failed", () => {
      const provider = make();
      expect(provider.status(PaymentStatus.failed)).toBe("failed");
      expect(provider.status(PaymentStatus.expired)).toBe("failed");
      expect(provider.status(PaymentStatus.canceled)).toBe("failed");
    });

    it("returns null for transient states", () => {
      const provider = make();
      expect(provider.status(PaymentStatus.open)).toBe(null);
      expect(provider.status(PaymentStatus.pending)).toBe(null);
    });
  });
});
