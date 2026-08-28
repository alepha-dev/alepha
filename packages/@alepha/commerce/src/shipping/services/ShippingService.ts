import { $repository, type Page } from "alepha/orm";

import { NoShippingRateError } from "../../errors/CommerceError.ts";
import {
  type ShippingRateEntity,
  shippingRates,
} from "../entities/shippingRates.ts";
import {
  type ShippingZoneEntity,
  shippingZones,
} from "../entities/shippingZones.ts";

/**
 * One option offered to the buyer, priced for their cart.
 */
export interface ShippingQuote {
  /**
   * Written onto the order as `shippingMethod`.
   */
  code: string;
  name: string;
  /**
   * What this cart actually pays — 0 when `freeAbove` is met.
   */
  price: number;
  /**
   * The rate's list price, so a UI can strike it through when free.
   */
  listPrice: number;
  free: boolean;
  minDays?: number;
  maxDays?: number;
}

/**
 * Prices delivery for a destination.
 *
 * Deliberately table-driven and carrier-agnostic: a rate is a name and a price,
 * not an API call. Real carrier integration (pickup-point pickers, live rates,
 * label printing) is a different module that would register alongside this one;
 * a jeweller shipping a dozen parcels a week needs a price list, not an API.
 */
export class ShippingService {
  protected readonly zoneRepo = $repository(shippingZones);
  protected readonly rateRepo = $repository(shippingRates);

  /**
   * Every option available for a destination, cheapest first.
   *
   * Returns an empty array when no zone covers the country — the caller decides
   * whether that is an error (at checkout) or just an empty picker (browsing).
   */
  public async quote(
    country: string,
    subtotal: number,
  ): Promise<ShippingQuote[]> {
    const zone = await this.zoneFor(country);
    if (!zone) {
      return [];
    }

    const rates = await this.rateRepo.findMany({
      where: { zoneId: { eq: zone.id }, active: { eq: true } },
    });

    return rates
      .map((rate) => this.priceRate(rate, subtotal))
      .sort((a, b) => a.price - b.price);
  }

  /**
   * Price one option by code, for the destination. Used when the buyer has
   * already chosen and the total must be recomputed authoritatively.
   *
   * @throws NoShippingRateError when the code is not available for that country
   */
  public async quoteFor(
    country: string,
    subtotal: number,
    code: string,
  ): Promise<ShippingQuote> {
    const quotes = await this.quote(country, subtotal);
    const match = quotes.find((q) => q.code === code);
    if (!match) {
      throw new NoShippingRateError(country);
    }
    return match;
  }

  /**
   * The zone covering a country: the highest-priority one that lists it.
   *
   * Sorted in memory rather than SQL because a shop has a handful of zones and
   * the country match is an array membership test, which is awkward and
   * dialect-specific in SQL for no gain at this size.
   */
  public async zoneFor(
    country: string,
  ): Promise<ShippingZoneEntity | undefined> {
    const wanted = country.trim().toUpperCase();
    const zones = await this.zoneRepo.findMany({});
    return zones
      .filter((zone) => zone.countries.includes(wanted))
      .sort((a, b) => a.priority - b.priority)[0];
  }

  public async createZone(data: {
    name: string;
    countries: string[];
    priority?: number;
  }): Promise<ShippingZoneEntity> {
    return this.zoneRepo.create({
      ...data,
      countries: data.countries.map((c) => c.trim().toUpperCase()),
    });
  }

  public async createRate(data: {
    zoneId: string;
    code: string;
    name: string;
    price: number;
    freeAbove?: number;
    minDays?: number;
    maxDays?: number;
  }): Promise<ShippingRateEntity> {
    return this.rateRepo.create(data);
  }

  /**
   * Withdraw an option without deleting it — historical orders reference its
   * `code`, and the merchant usually wants it back next season.
   */
  public async deactivateRate(id: string): Promise<ShippingRateEntity> {
    return this.rateRepo.updateById(id, { active: false });
  }

  public async listZones(): Promise<ShippingZoneEntity[]> {
    return this.zoneRepo.findMany({ orderBy: "priority" });
  }

  /**
   * @public A back-office read: which rates a zone offers. Nothing in this
   * package calls it - checkout goes through {@link quoteFor}, which picks
   * one rate rather than listing them.
   */
  public async listRates(zoneId: string): Promise<ShippingRateEntity[]> {
    return this.rateRepo.findMany({ where: { zoneId: { eq: zoneId } } });
  }

  /**
   * A zone's rates as a `Page`, so a table component can consume them without a
   * special case. A zone has a handful of rates and never needs paging; this is
   * about matching one shape rather than about volume.
   */
  public async pageRates(
    zoneId: string,
    query: { size?: number; page?: number } = {},
  ): Promise<Page<ShippingRateEntity>> {
    return this.rateRepo.paginate(
      { size: 100, sort: "price", ...query },
      { where: { zoneId: { eq: zoneId } } },
      { count: true },
    );
  }

  protected priceRate(
    rate: ShippingRateEntity,
    subtotal: number,
  ): ShippingQuote {
    const free = rate.freeAbove != null && subtotal >= rate.freeAbove;
    return {
      code: rate.code,
      name: rate.name,
      price: free ? 0 : rate.price,
      listPrice: rate.price,
      free,
      minDays: rate.minDays,
      maxDays: rate.maxDays,
    };
  }
}
