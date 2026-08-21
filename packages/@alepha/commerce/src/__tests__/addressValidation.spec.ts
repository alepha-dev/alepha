import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { AddressRulesProvider } from "../checkout/providers/AddressRulesProvider.ts";
import { AddressService } from "../checkout/services/AddressService.ts";

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceCheckout);
  const addresses = alepha.inject(AddressService);
  const rules = alepha.inject(AddressRulesProvider);
  await alepha.start();
  return { alepha, addresses, rules };
};

const base = {
  fullName: "Camille Dupont",
  line1: "12 rue des Orfèvres",
  locality: "Paris",
  postalCode: "75001",
  country: "FR",
};

describe("EU address validation", () => {
  it("covers all 27 member states", async ({ expect }) => {
    const { rules } = await setup();
    expect(rules.countries()).toHaveLength(27);
  });

  it("accepts a well-formed French address", async ({ expect }) => {
    const { addresses } = await setup();
    const clean = addresses.validate(base);
    expect(clean.postalCode).toBe("75001");
    expect(clean.country).toBe("FR");
  });

  it("rejects a postal code that belongs to another country", async ({
    expect,
  }) => {
    const { addresses } = await setup();
    // Four digits is Belgian, not French.
    expect(() => addresses.validate({ ...base, postalCode: "1000" })).toThrow(
      /not a valid postal code for France.*75001/s,
    );
  });

  it("reports the offending field, so a form can highlight it", async ({
    expect,
  }) => {
    const { addresses } = await setup();
    try {
      addresses.validate({ ...base, postalCode: "ABCDE" });
      expect.unreachable("should have thrown");
    } catch (error: any) {
      expect(error.field).toBe("postalCode");
    }
  });

  it("normalises case and spacing rather than rejecting it", async ({
    expect,
  }) => {
    const { addresses } = await setup();
    const nl = addresses.validate({
      ...base,
      locality: "Amsterdam",
      postalCode: "  1012   ab ",
      country: "nl",
    });
    expect(nl.postalCode).toBe("1012 AB");
    expect(nl.country).toBe("NL");
  });

  it("accepts the formats that break the just-digits assumption", async ({
    expect,
  }) => {
    const { addresses } = await setup();

    // Irish Eircode, with and without the space.
    expect(
      addresses.validate({ ...base, postalCode: "D02 AF30", country: "IE" })
        .postalCode,
    ).toBe("D02 AF30");
    expect(
      addresses.validate({ ...base, postalCode: "d02af30", country: "IE" })
        .postalCode,
    ).toBe("D02AF30");

    // Maltese: three letters then four digits.
    expect(
      addresses.validate({ ...base, postalCode: "VLT 1117", country: "MT" })
        .postalCode,
    ).toBe("VLT 1117");

    // Dutch, Portuguese, Polish, Luxembourgish, Lithuanian separators.
    for (const [country, code] of [
      ["NL", "1012 AB"],
      ["PT", "1000-001"],
      ["PL", "00-001"],
      ["LU", "L-1111"],
      ["LT", "LT-01100"],
      ["LV", "LV-1050"],
      ["SE", "111 20"],
      ["CZ", "110 00"],
      ["RO", "010011"],
    ] as const) {
      expect(() =>
        addresses.validate({ ...base, postalCode: code, country }),
      ).not.toThrow();
    }
  });

  it("accepts a separator-less form where the country allows it", async ({
    expect,
  }) => {
    const { addresses } = await setup();
    expect(() =>
      addresses.validate({ ...base, postalCode: "1000001", country: "PT" }),
    ).not.toThrow();
    expect(() =>
      addresses.validate({ ...base, postalCode: "00001", country: "PL" }),
    ).not.toThrow();
  });

  it("refuses a country the shop does not deliver to", async ({ expect }) => {
    const { addresses } = await setup();
    expect(() =>
      addresses.validate({ ...base, postalCode: "8001", country: "CH" }),
    ).toThrow(/'CH' is not a country this shop delivers to/);
  });

  it("lets an application add a country by substituting the rules", async ({
    expect,
  }) => {
    class SwissRules extends AddressRulesProvider {
      override rules() {
        return {
          ...super.rules(),
          CH: { name: "Suisse", postalCode: /^\d{4}$/, example: "8001" },
        };
      }
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      // Before the module: a substitution recorded after the service has been
      // instantiated throws TooLateSubstitutionError.
      .with({ provide: AddressRulesProvider, use: SwissRules })
      .with(AlephaCommerceCheckout);
    const addresses = alepha.inject(AddressService);
    await alepha.start();

    expect(
      addresses.validate({ ...base, postalCode: "8001", country: "CH" })
        .country,
    ).toBe("CH");
  });

  it("stores an address and hands back the address book", async ({
    expect,
  }) => {
    const { addresses } = await setup();
    const userId = crypto.randomUUID();

    await addresses.create(base, { userId });
    const second = await addresses.create(
      { ...base, line1: "3 place Vendôme" },
      { userId, isDefault: true },
    );

    const book = await addresses.listOf(userId);
    expect(book).toHaveLength(2);
    // Default first.
    expect(book[0]!.id).toBe(second.id);
  });
});
