/**
 * What one country expects of a postal address.
 */
export interface CountryAddressRule {
  /**
   * Human name, for error messages.
   */
  name: string;
  /**
   * Postal-code pattern, matched against the *normalised* value (upper-cased,
   * inner whitespace collapsed to one space, surrounding whitespace trimmed).
   */
  postalCode: RegExp;
  /**
   * An example, quoted back to the buyer when their entry does not match.
   */
  example: string;
  /**
   * Whether the country uses a province/state field that must be filled.
   */
  requiresRegion?: boolean;
}

/**
 * Per-country address rules for the EU.
 *
 * ### Why this is a provider and not a constant
 *
 * The day the shop sells to Switzerland or the UK, the list needs one more
 * entry — and editing a framework package to add a country you sell to is
 * absurd. Substituting the provider is the supported answer:
 *
 * ```ts
 * class MyRules extends AddressRulesProvider {
 *   override rules() {
 *     return { ...super.rules(), CH: { name: "Suisse", postalCode: /^\d{4}$/, example: "8001" } };
 *   }
 * }
 * alepha.with({ provide: AddressRulesProvider, use: MyRules });
 * ```
 *
 * The patterns are deliberately shape-only. Validating that a postcode *exists*
 * requires a carrier's address database, which is a paid API and a different
 * concern; what this catches is the typo and the wrong-country paste, which is
 * most of what goes wrong.
 */
export class AddressRulesProvider {
  /**
   * The EU-27. Ireland and Malta are the two that break the "just digits"
   * assumption, and Portugal, Poland, Latvia and Lithuania are the ones whose
   * separators people omit — those are the entries worth reading.
   */
  public rules(): Record<string, CountryAddressRule> {
    return {
      AT: { name: "Austria", postalCode: /^\d{4}$/, example: "1010" },
      BE: { name: "Belgium", postalCode: /^\d{4}$/, example: "1000" },
      BG: { name: "Bulgaria", postalCode: /^\d{4}$/, example: "1000" },
      CY: { name: "Cyprus", postalCode: /^\d{4}$/, example: "1010" },
      CZ: { name: "Czechia", postalCode: /^\d{3} ?\d{2}$/, example: "110 00" },
      DE: { name: "Germany", postalCode: /^\d{5}$/, example: "10115" },
      DK: { name: "Denmark", postalCode: /^\d{4}$/, example: "1050" },
      EE: { name: "Estonia", postalCode: /^\d{5}$/, example: "10111" },
      ES: { name: "Spain", postalCode: /^\d{5}$/, example: "28001" },
      FI: { name: "Finland", postalCode: /^\d{5}$/, example: "00100" },
      FR: { name: "France", postalCode: /^\d{5}$/, example: "75001" },
      GR: { name: "Greece", postalCode: /^\d{3} ?\d{2}$/, example: "104 31" },
      HR: { name: "Croatia", postalCode: /^\d{5}$/, example: "10000" },
      HU: { name: "Hungary", postalCode: /^\d{4}$/, example: "1051" },
      // Eircode: routing key (letter + 2 alphanumerics) + 4-character identifier.
      IE: {
        name: "Ireland",
        postalCode: /^[A-Z]\d[\dW] ?[\dA-Z]{4}$/,
        example: "D02 AF30",
      },
      IT: { name: "Italy", postalCode: /^\d{5}$/, example: "00184" },
      LT: {
        name: "Lithuania",
        postalCode: /^(LT-)?\d{5}$/,
        example: "LT-01100",
      },
      LU: { name: "Luxembourg", postalCode: /^(L-)?\d{4}$/, example: "L-1111" },
      LV: { name: "Latvia", postalCode: /^(LV-)?\d{4}$/, example: "LV-1050" },
      // Three letters, then four digits.
      MT: {
        name: "Malta",
        postalCode: /^[A-Z]{3} ?\d{4}$/,
        example: "VLT 1117",
      },
      NL: {
        name: "Netherlands",
        postalCode: /^\d{4} ?[A-Z]{2}$/,
        example: "1012 AB",
      },
      PL: { name: "Poland", postalCode: /^\d{2}-?\d{3}$/, example: "00-001" },
      PT: {
        name: "Portugal",
        postalCode: /^\d{4}-?\d{3}$/,
        example: "1000-001",
      },
      RO: { name: "Romania", postalCode: /^\d{6}$/, example: "010011" },
      SE: { name: "Sweden", postalCode: /^\d{3} ?\d{2}$/, example: "111 20" },
      SI: { name: "Slovenia", postalCode: /^\d{4}$/, example: "1000" },
      SK: {
        name: "Slovakia",
        postalCode: /^\d{3} ?\d{2}$/,
        example: "811 01",
      },
    };
  }

  /**
   * Normalise a postal code before matching: upper case, collapse inner runs of
   * whitespace to one space, trim. This is why every pattern above can treat the
   * separator as optional rather than guessing at the buyer's spacing.
   */
  public normalisePostalCode(value: string): string {
    return value.trim().toUpperCase().replace(/\s+/g, " ");
  }

  public countries(): string[] {
    return Object.keys(this.rules()).sort();
  }
}
