/**
 * A file a buyer can collect, and the link to it.
 */
export interface OrderDownload {
  /**
   * What the buyer reads: the order line's name.
   */
  name: string;
  url: string;
  /**
   * When the link stops working, an ISO instant.
   */
  expiresAt: string;
}

/**
 * Looks up what one module can deliver for an order.
 */
export type OrderDownloadSource = (orderId: string) => Promise<OrderDownload[]>;

/**
 * What can be downloaded for an order: read by the confirmation email and the
 * thank-you page, answered by `@alepha/commerce/downloads`.
 *
 * In the core, and a list rather than a substitution, for the reason
 * `OrderDocumentsProvider` is: notifications and downloads are siblings, and two
 * plugins cannot be ordered. A deployment with no downloads gets an empty list.
 */
export class OrderDownloadsProvider {
  protected readonly sources: OrderDownloadSource[] = [];

  /**
   * Contribute a lookup, from a module's `register` hook.
   */
  public add(source: OrderDownloadSource): void {
    this.sources.push(source);
  }

  public async linksFor(orderId: string): Promise<OrderDownload[]> {
    const found = await Promise.all(
      this.sources.map((source) => source(orderId)),
    );
    return found.flat();
  }
}
