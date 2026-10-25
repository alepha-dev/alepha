/**
 * One VAT bucket inside a ventilation.
 */
export interface VatBucket {
  /**
   * Rate in basis points (2000 = 20.00 %).
   */
  rateBps: number;
  /**
   * Taxable base (excluding tax), in the smallest currency unit.
   */
  baseCents: number;
  /**
   * Tax amount, in the smallest currency unit.
   */
  vatCents: number;
}

/**
 * VAT arithmetic on tax-inclusive amounts.
 *
 * Ported from Club's `caisse`, where French anti-fraud rules forced it into
 * existence: a receipt must show the tax broken down per rate, and the daily
 * closure must aggregate those breakdowns without drift. The same maths is what
 * a compliant invoice needs, so it lives here rather than staying locked in one
 * application.
 *
 * ### Why the core, and not `invoicing`
 *
 * It shipped under `invoicing/`, reachable only through a module that imports
 * checkout — so a point-of-sale wanting nothing but the arithmetic had to take
 * carts and checkout sessions with it, tables this package elsewhere says a POS
 * should not carry. A receipt needs this maths and never issues an invoice, and
 * the very application it came from is a POS. It belongs to the core, and is
 * exported as `@alepha/commerce/vat` for consumers that want only this.
 *
 * The rule that matters, and the reason this is not a one-liner: **the base is
 * rounded and the tax is the remainder**, so `base + vat === ttc` exactly, for
 * every input, forever. Computing both by rounding produces totals that are one
 * cent off often enough to be noticed by an accountant and never often enough to
 * be caught by a casual test.
 */
export class VatCalculator {
  /**
   * Split a tax-inclusive amount into base and tax for one rate.
   */
  public fromInclusive(
    ttcCents: number,
    rateBps: number,
  ): { baseCents: number; vatCents: number } {
    if (rateBps <= 0) {
      return { baseCents: ttcCents, vatCents: 0 };
    }
    const baseCents = Math.round((ttcCents * 10000) / (10000 + rateBps));
    // The remainder, never a second rounding — that is what keeps the sum exact.
    return { baseCents, vatCents: ttcCents - baseCents };
  }

  /**
   * Group tax-inclusive lines into per-rate buckets, sorted by rate.
   *
   * Lines sharing a rate are summed *before* the split, so a bucket rounds once
   * rather than once per line — which is both more accurate and what a single
   * line at that rate would have produced.
   */
  public ventilate(
    lines: Array<{ ttcCents: number; rateBps: number }>,
  ): VatBucket[] {
    const ttcByRate = new Map<number, number>();
    for (const line of lines) {
      ttcByRate.set(
        line.rateBps,
        (ttcByRate.get(line.rateBps) ?? 0) + line.ttcCents,
      );
    }
    return [...ttcByRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rateBps, ttc]) => ({
        rateBps,
        ...this.fromInclusive(ttc, rateBps),
      }));
  }

  /**
   * The rate carrying the largest amount — what a one-line summary shows.
   */
  /**
   * @public Called by applications, not from this package. `club` alone uses
   * it in four services to stamp an invoice line's headline rate. It was
   * reported as unused by the 2026-08-23 audit, which read this repository
   * only - deleting it would have broken a downstream app.
   */
  public dominantRateBps(buckets: VatBucket[]): number | undefined {
    let best: VatBucket | undefined;
    for (const bucket of buckets) {
      if (
        !best ||
        bucket.baseCents + bucket.vatCents > best.baseCents + best.vatCents
      ) {
        best = bucket;
      }
    }
    return best?.rateBps;
  }

  /**
   * Totals across a ventilation.
   */
  public totals(buckets: VatBucket[]): {
    baseCents: number;
    vatCents: number;
    ttcCents: number;
  } {
    const baseCents = buckets.reduce((sum, b) => sum + b.baseCents, 0);
    const vatCents = buckets.reduce((sum, b) => sum + b.vatCents, 0);
    return { baseCents, vatCents, ttcCents: baseCents + vatCents };
  }

  /**
   * Split one sale's ventilation across several tenders, one group per amount.
   *
   * A split payment — half on a card, the rest in cash, or a wallet covering
   * part of a basket — records a leg per tender, and each leg carries its own
   * share of the tax. The daily closure then aggregates legs, so a cent lost
   * here is a cent the closure is out by, and a closure that does not reconcile
   * is the kind of problem that surfaces at an inspection rather than in a test.
   *
   * Every remainder therefore lands on the LAST tender: shares are rounded as
   * they are taken and whatever is left over is assigned rather than recomputed,
   * so the legs sum back to the sale exactly, for any split, at any rate.
   *
   * Ported from Club's caisse together with the rest of this class.
   */
  /**
   * @public Application surface, like {@link dominantRateBps}: `club`'s
   * SaleService splits VAT across payment legs with it in three places.
   */
  public apportion(buckets: VatBucket[], amounts: number[]): VatBucket[][] {
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    if (total <= 0 || amounts.length === 0) {
      return amounts.map(() => []);
    }

    const out: VatBucket[][] = amounts.map(() => []);
    for (const bucket of buckets) {
      let baseLeft = bucket.baseCents;
      let vatLeft = bucket.vatCents;
      for (let i = 0; i < amounts.length; i++) {
        const last = i === amounts.length - 1;
        const baseCents = last
          ? baseLeft
          : Math.round((bucket.baseCents * amounts[i]!) / total);
        const vatCents = last
          ? vatLeft
          : Math.round((bucket.vatCents * amounts[i]!) / total);
        baseLeft -= baseCents;
        vatLeft -= vatCents;
        if (baseCents !== 0 || vatCents !== 0) {
          out[i]!.push({ rateBps: bucket.rateBps, baseCents, vatCents });
        }
      }
    }
    return out;
  }

  /**
   * Merge several ventilations into one. Used to aggregate a period.
   */
  /**
   * @public Application surface, like {@link dominantRateBps}: `club`'s
   * FiscalClosureService folds a day's VAT groups back together with it.
   */
  public merge(groups: VatBucket[][]): VatBucket[] {
    const byRate = new Map<number, VatBucket>();
    for (const group of groups) {
      for (const bucket of group) {
        const acc = byRate.get(bucket.rateBps) ?? {
          rateBps: bucket.rateBps,
          baseCents: 0,
          vatCents: 0,
        };
        acc.baseCents += bucket.baseCents;
        acc.vatCents += bucket.vatCents;
        byRate.set(bucket.rateBps, acc);
      }
    }
    return [...byRate.values()].sort((a, b) => a.rateBps - b.rateBps);
  }
}
