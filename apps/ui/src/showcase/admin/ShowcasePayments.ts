import type { Page } from "alepha";
import type { IntentResource } from "alepha/api/payments";

/**
 * Fake payment intents, paged in memory.
 *
 * ⚠️ `amount` is in MINOR UNITS, so 4250 is 42.50. The entity declares it as
 * an integer for exactly that reason, and a fixture written in whole currency
 * would render every row a hundred times too cheap.
 *
 * The statuses are chosen to cover the ones the table renders differently, and
 * to include the settled-but-not-clean cases (`partially_refunded`, `voided`)
 * that a happy-path dataset never shows.
 */
export class ShowcasePayments {
  public paginate(query: ShowcasePaymentQuery): Page<IntentResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();
    if (query.status) {
      rows = rows.filter((r) => r.status === query.status);
    }

    const offset = number * size;
    const content = rows.slice(offset, offset + size);
    const totalPages = Math.max(1, Math.ceil(rows.length / size));

    return {
      content,
      page: {
        number,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages,
        isEmpty: content.length === 0,
        isFirst: number === 0,
        isLast: number >= totalPages - 1,
      },
    };
  }

  public rows(): IntentResource[] {
    const seed: [string, number, string, string][] = [
      ["captured", 4250, "EUR", "ada"],
      ["captured", 12900, "EUR", "alan"],
      ["authorized", 7500, "EUR", "grace"],
      ["processing", 3300, "USD", "barbara"],
      ["partially_refunded", 9900, "EUR", "edsger"],
      ["refunded", 2500, "GBP", "radia"],
      ["failed", 15000, "EUR", "donald"],
      ["voided", 800, "USD", "frances"],
      ["cancelled", 4999, "EUR", "leslie"],
    ];

    return seed.map(([status, amount, currency, username], i) => ({
      id: `00000000-0000-4000-f000-${String(i + 1).padStart(12, "0")}`,
      version: 1,
      createdAt: this.at(i * 7 + 2),
      updatedAt: this.at(i * 7),
      organizationId: undefined,
      amount,
      currency,
      status,
      providerRef: `pi_showcase_${String(i + 1).padStart(6, "0")}`,
      providerRaw: undefined,
      metadata: { order: `ord_${String(i + 1).padStart(5, "0")}` },
      paymentMethodId: undefined,
      userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      user: {
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        email: `${username}@alepha.dev`,
      },
    })) as unknown as IntentResource[];
  }

  protected at(hoursAgo: number): string {
    return new Date(
      Date.UTC(2026, 8, 5, 9, 0) - hoursAgo * 3_600_000,
    ).toISOString();
  }
}

export interface ShowcasePaymentQuery {
  page?: number;
  size?: number;
  sort?: string;
  status?: string;
}
