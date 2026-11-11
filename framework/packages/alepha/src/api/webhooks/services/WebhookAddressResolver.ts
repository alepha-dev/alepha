/**
 * Resolves a webhook host to the addresses a request would reach, so the
 * destination policy can test each of them.
 *
 * This default resolves nothing (`undefined`): on workerd there is no
 * resolver, and the literal rules are the whole check. The Node and Bun
 * build of the module substitutes {@link NodeWebhookAddressResolver}.
 */
export class WebhookAddressResolver {
  /**
   * Every address `host` resolves to, or `undefined` when this runtime
   * cannot resolve. Throws when the lookup itself fails.
   */
  public async resolve(_host: string): Promise<string[] | undefined> {
    return undefined;
  }
}
