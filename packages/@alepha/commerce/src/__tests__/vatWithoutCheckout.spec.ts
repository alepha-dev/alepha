import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";
import { AlephaCommerce } from "../index.ts";
import { VatCalculator } from "../services/VatCalculator.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The VAT arithmetic has to be reachable without checkout.
 *
 * It shipped under `invoicing/`, exported only through a module that imports
 * checkout — so a point-of-sale wanting nothing but the maths had to take carts
 * and checkout sessions with it, the very tables this package tells a POS not to
 * carry. A receipt needs a per-rate breakdown and never issues an invoice, and
 * the application this code was ported from is a POS.
 */
describe("VAT without checkout", () => {
  it("computes from the core module alone", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerce);
    const vat = alepha.inject(VatCalculator);
    await alepha.start();

    const buckets = vat.ventilate([
      { ttcCents: 2000, rateBps: 2000 },
      { ttcCents: 1000, rateBps: 550 },
    ]);
    expect(buckets.map((b) => b.rateBps)).toEqual([550, 2000]);
    expect(vat.totals(buckets).ttcCents).toBe(3000);
  });

  /**
   * The guarantee behind the `@alepha/commerce/vat` export, and the one worth
   * pinning: this file pulls nothing else in the package, so the subpath cannot
   * transitively register a module a consumer did not ask for. An import added
   * here later — even an innocent-looking type — is what would quietly undo it.
   */
  it("pulls in nothing else from the package", () => {
    const source = readFileSync(
      join(here, "../services/VatCalculator.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

    expect(imports).toEqual([]);
  });

  it("is exported on its own subpath", () => {
    const pkg = JSON.parse(
      readFileSync(join(here, "../../package.json"), "utf8"),
    );

    expect(pkg.exports["./vat"]).toBe("./src/services/VatCalculator.ts");
  });
});
