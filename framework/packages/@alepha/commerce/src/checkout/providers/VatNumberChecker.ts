import { $inject } from "alepha";
import { HttpClient } from "alepha/server";

/**
 * What a registry says about a VAT number.
 *
 * `unavailable` is its own answer: VIES goes down, member states' registers go
 * offline at night, and "could not ask" is not "invalid".
 */
export type VatNumberCheck =
  | { status: "valid"; name?: string }
  | { status: "invalid" }
  | { status: "unavailable" };

/**
 * Asks whether a VAT number exists. Abstract so a shop can use its own source
 * and a spec does not need the European Commission to be up.
 */
export abstract class VatNumberChecker {
  /**
   * @param vatNumber normalised: upper case, no separators, country prefix first.
   */
  abstract check(vatNumber: string): Promise<VatNumberCheck>;
}

/**
 * The European Commission's VIES service, through its public REST API. Called
 * for real when this was written: a known number answered `valid`, a made-up one
 * `invalid`.
 */
export class ViesVatNumberChecker extends VatNumberChecker {
  public static readonly URL =
    "https://ec.europa.eu/taxation_customs/vies/rest-api";

  protected readonly http = $inject(HttpClient);

  public async check(vatNumber: string): Promise<VatNumberCheck> {
    const country = vatNumber.slice(0, 2);
    const number = vatNumber.slice(2);
    try {
      const { data } = await this.http.fetch(
        `${ViesVatNumberChecker.URL}/ms/${country}/vat/${number}`,
      );
      const answer = data as {
        isValid?: boolean;
        userError?: string;
        name?: string;
      };
      if (answer.isValid) {
        return { status: "valid", name: answer.name };
      }
      // `isValid: false` is not always a verdict: a member state whose register
      // is down answers it too, with `MS_UNAVAILABLE` in `userError`.
      return answer.userError === "INVALID"
        ? { status: "invalid" }
        : { status: "unavailable" };
    } catch {
      // Any failure to get an answer: the check did not happen.
      return { status: "unavailable" };
    }
  }
}
