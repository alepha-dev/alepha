/** Looks up the documents one module can produce for an order. */
export type OrderDocumentSource = (orderId: string) => Promise<string[]>;

/**
 * What documents exist for an order — invoice numbers, in practice.
 *
 * ### Why a registry and not a substitution
 *
 * The first version made this an abstract provider that `invoicing` substituted.
 * It broke on boot: `shipping` and `invoicing` are siblings that both import
 * `checkout`, so whichever registered first wired the checkout and instantiated
 * its default, and the second got `TooLateSubstitutionError`. Substitution is
 * order-dependent by nature, and two independent plugins cannot be ordered.
 *
 * A collection that modules push into has no such problem — the same shape as
 * `ProductKindRegistry` and `RootComponentsProvider`, and for the same reason.
 * A deployment with no invoicing simply has no sources and gets an empty list,
 * which is the correct answer for a POS or a ticketing app.
 */
export class OrderDocumentsProvider {
  protected readonly sources: OrderDocumentSource[] = [];

  /**
   * Contribute a lookup, from a module's `register` hook.
   */
  public add(source: OrderDocumentSource): void {
    this.sources.push(source);
  }

  /**
   * Every document reference a customer can open, in the order the sources were
   * registered.
   */
  public async documentsFor(orderId: string): Promise<string[]> {
    const found = await Promise.all(
      this.sources.map((source) => source(orderId)),
    );
    return found.flat();
  }
}
