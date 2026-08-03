/** One VAT bucket inside a ventilation. */
export interface VatBucket {
  /** Rate in basis points (2000 = 20.00 %). */
  rateBps: number;
  /** Taxable base (excluding tax), in the smallest currency unit. */
  baseCents: number;
  /** Tax amount, in the smallest currency unit. */
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

  /** The rate carrying the largest amount — what a one-line summary shows. */
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

  /** Totals across a ventilation. */
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
   * Merge several ventilations into one. Used to aggregate a period.
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
