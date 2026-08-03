/**
 * What one country expects of a postal address.
 */
export interface CountryAddressRule {
  /** Human name, for error messages. */
  name: string;
  /**
   * Postal-code pattern, matched against the *normalised* value (upper-cased,
   * inner whitespace collapsed to one space, surrounding whitespace trimmed).
   */
  postalCode: RegExp;
  /** An example, quoted back to the buyer when their entry does not match. */
  example: string;
  /** Whether the country uses a province/state field that must be filled. */
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
      AT: { name: "Autriche", postalCode: /^\d{4}$/, example: "1010" },
      BE: { name: "Belgique", postalCode: /^\d{4}$/, example: "1000" },
      BG: { name: "Bulgarie", postalCode: /^\d{4}$/, example: "1000" },
      CY: { name: "Chypre", postalCode: /^\d{4}$/, example: "1010" },
      CZ: { name: "Tchéquie", postalCode: /^\d{3} ?\d{2}$/, example: "110 00" },
      DE: { name: "Allemagne", postalCode: /^\d{5}$/, example: "10115" },
      DK: { name: "Danemark", postalCode: /^\d{4}$/, example: "1050" },
      EE: { name: "Estonie", postalCode: /^\d{5}$/, example: "10111" },
      ES: { name: "Espagne", postalCode: /^\d{5}$/, example: "28001" },
      FI: { name: "Finlande", postalCode: /^\d{5}$/, example: "00100" },
      FR: { name: "France", postalCode: /^\d{5}$/, example: "75001" },
      GR: { name: "Grèce", postalCode: /^\d{3} ?\d{2}$/, example: "104 31" },
      HR: { name: "Croatie", postalCode: /^\d{5}$/, example: "10000" },
      HU: { name: "Hongrie", postalCode: /^\d{4}$/, example: "1051" },
      // Eircode: routing key (letter + 2 alphanumerics) + 4-character identifier.
      IE: {
        name: "Irlande",
        postalCode: /^[A-Z]\d[\dW] ?[\dA-Z]{4}$/,
        example: "D02 AF30",
      },
      IT: { name: "Italie", postalCode: /^\d{5}$/, example: "00184" },
      LT: {
        name: "Lituanie",
        postalCode: /^(LT-)?\d{5}$/,
        example: "LT-01100",
      },
      LU: { name: "Luxembourg", postalCode: /^(L-)?\d{4}$/, example: "L-1111" },
      LV: { name: "Lettonie", postalCode: /^(LV-)?\d{4}$/, example: "LV-1050" },
      // Three letters, then four digits.
      MT: {
        name: "Malte",
        postalCode: /^[A-Z]{3} ?\d{4}$/,
        example: "VLT 1117",
      },
      NL: {
        name: "Pays-Bas",
        postalCode: /^\d{4} ?[A-Z]{2}$/,
        example: "1012 AB",
      },
      PL: { name: "Pologne", postalCode: /^\d{2}-?\d{3}$/, example: "00-001" },
      PT: {
        name: "Portugal",
        postalCode: /^\d{4}-?\d{3}$/,
        example: "1000-001",
      },
      RO: { name: "Roumanie", postalCode: /^\d{6}$/, example: "010011" },
      SE: { name: "Suède", postalCode: /^\d{3} ?\d{2}$/, example: "111 20" },
      SI: { name: "Slovénie", postalCode: /^\d{4}$/, example: "1000" },
      SK: {
        name: "Slovaquie",
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

  public isSupported(country: string): boolean {
    return country.toUpperCase() in this.rules();
  }

  public countries(): string[] {
    return Object.keys(this.rules()).sort();
  }
}
