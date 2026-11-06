/**
 * What a provisioned server has cost so far (#Q3168): the hourly price read
 * from the provider's catalogue at provision, times the hours since.
 *
 * An estimate, and said as one: a provider bills by its own rules (a minimum,
 * rounding, the IP and the disk priced apart), and Lore reads none of them.
 * Browser-loadable, so the account page and the Bay console share it.
 */
export class EstateCost {
  /**
   * In euros, or `undefined` when the estate was not provisioned or no price
   * was read.
   */
  static soFar(
    estate: { hourlyPrice?: number; provisionedAt?: string },
    nowMillis: number,
  ): number | undefined {
    if (estate.hourlyPrice === undefined || !estate.provisionedAt) {
      return undefined;
    }
    const hours = Math.max(
      0,
      (nowMillis - Date.parse(estate.provisionedAt)) / 3_600_000,
    );
    return estate.hourlyPrice * hours;
  }
}
