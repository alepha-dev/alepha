import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  type FareClass,
  fareClasses,
} from "../../inventory/entities/fareClasses.ts";
import {
  type TripInstance,
  tripInstances,
} from "../../inventory/entities/tripInstances.ts";
import { InventoryService } from "../../inventory/services/InventoryService.ts";
import { AppConfig } from "../../system/services/AppConfig.ts";
import { trips } from "../../topology/entities/trips.ts";
import { type PriceRule, priceRules } from "../entities/priceRules.ts";

export interface PriceCalculation {
  basePrice: number;
  fareClassMultiplier: number;
  dynamicMultiplier: number;
  seatPremium: number;
  pricePerPassenger: number;
  fareClass: FareClass;
  breakdown: Array<{ rule: string; multiplier: number }>;
  validUntil: string;
}

export interface FareClassWithPrice {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  priceMultiplier: number;
  dynamicMultiplier: number;
  remainingQuota: number;
  isRefundable: boolean;
  isChangeable: boolean;
  changeFeePercent: number;
  refundFeePercent: number;
  minDaysBeforeDeparture: number;
}

export class PricingService {
  protected readonly log = $logger();
  protected readonly trips = $repository(trips);
  protected readonly tripInstances = $repository(tripInstances);
  protected readonly fareClasses = $repository(fareClasses);
  protected readonly priceRules = $repository(priceRules);
  protected readonly inventoryService = $inject(InventoryService);
  protected readonly appConfig = $inject(AppConfig);

  /**
   * Calculate price for a trip + fare class combination.
   */
  public async calculatePrice(
    tripId: string,
    tripInstanceId: string,
    fareClassId: string,
    seatPremium = 0,
  ): Promise<PriceCalculation> {
    const [trip, tripInstance, fareClass, priceRulesList] = await Promise.all([
      this.trips.findById(tripId),
      this.tripInstances.findById(tripInstanceId),
      this.fareClasses.findById(fareClassId),
      this.priceRules.findMany({
        where: { active: { eq: true } },
        orderBy: { column: "priority", direction: "asc" },
      }),
    ]);

    // Calculate dynamic multiplier from rules
    const { multiplier: dynamicMultiplier, breakdown } =
      this.calculateDynamicMultiplier(tripInstance, priceRulesList);

    const basePrice = trip.basePrice;
    const fareClassMultiplier = fareClass.priceMultiplier;
    const pricePerPassenger = Math.round(
      basePrice * fareClassMultiplier * dynamicMultiplier + seatPremium,
    );

    // Price validity from config
    const validityMinutes = this.appConfig.pricing.current.priceValidityMinutes;
    const validUntil = new Date(
      Date.now() + validityMinutes * 60 * 1000,
    ).toISOString();

    return {
      basePrice,
      fareClassMultiplier,
      dynamicMultiplier,
      seatPremium,
      pricePerPassenger,
      fareClass,
      breakdown,
      validUntil,
    };
  }

  /**
   * Get available fare classes for a trip instance with prices.
   * Uses embedded fareQuotas from tripInstance.
   */
  public async getAvailableFareClasses(
    tripId: string,
    tripInstanceId: string,
    travelDate: string,
  ): Promise<FareClassWithPrice[]> {
    const [trip, tripInstance, priceRulesList] = await Promise.all([
      this.trips.findById(tripId),
      this.tripInstances.findById(tripInstanceId),
      this.priceRules.findMany({
        where: { active: { eq: true } },
        orderBy: { column: "priority", direction: "asc" },
      }),
    ]);

    // Get fare class IDs from embedded quotas that are available
    const quotas = tripInstance.fareQuotas;
    const availableQuotaCodes = Object.keys(quotas).filter(
      (code) => quotas[code].status === "available",
    );

    if (availableQuotaCodes.length === 0) {
      return [];
    }

    // Get fare class details
    const fareClassIds = availableQuotaCodes.map(
      (code) => quotas[code].fareClassId,
    );

    const fareClassList = await this.fareClasses.findMany({
      where: {
        id: { inArray: fareClassIds },
        active: { eq: true },
      },
      orderBy: { column: "sortOrder", direction: "asc" },
    });

    // Calculate dynamic multiplier
    const { multiplier: dynamicMultiplier } = this.calculateDynamicMultiplier(
      tripInstance,
      priceRulesList,
    );

    // Filter fare classes by minDaysBeforeDeparture
    const daysUntilDeparture = this.getDaysUntilDeparture(travelDate);

    return fareClassList
      .filter((fc) => daysUntilDeparture >= fc.minDaysBeforeDeparture)
      .map((fc) => {
        const quota = quotas[fc.code];
        const remainingQuota = quota
          ? quota.totalQuota - quota.bookedCount - quota.reservedCount
          : 0;

        const price = Math.round(
          trip.basePrice * fc.priceMultiplier * dynamicMultiplier,
        );

        return {
          id: fc.id,
          code: fc.code,
          name: fc.name,
          description: fc.description,
          price,
          priceMultiplier: fc.priceMultiplier,
          dynamicMultiplier,
          remainingQuota,
          isRefundable: fc.isRefundable,
          isChangeable: fc.isChangeable,
          changeFeePercent: fc.changeFeePercent,
          refundFeePercent: fc.refundFeePercent,
          minDaysBeforeDeparture: fc.minDaysBeforeDeparture,
        };
      });
  }

  /**
   * Get price range for a trip (lowest to highest fare class).
   */
  public async getPriceRange(
    tripId: string,
    travelDate: string,
  ): Promise<{ lowest: number; highest: number } | null> {
    // Get or create trip instance
    const tripInstance = await this.inventoryService.getOrCreateTripInstance(
      tripId,
      travelDate,
    );

    const fareClassList = await this.getAvailableFareClasses(
      tripId,
      tripInstance.id,
      travelDate,
    );

    if (fareClassList.length === 0) {
      return null;
    }

    const prices = fareClassList.map((fc) => fc.price);
    return {
      lowest: Math.min(...prices),
      highest: Math.max(...prices),
    };
  }

  /**
   * Calculate dynamic price multiplier based on rules.
   */
  protected calculateDynamicMultiplier(
    tripInstance: TripInstance,
    rules: PriceRule[],
  ): {
    multiplier: number;
    breakdown: Array<{ rule: string; multiplier: number }>;
  } {
    let multiplier = 1.0;
    const breakdown: Array<{ rule: string; multiplier: number }> = [];

    for (const rule of rules) {
      let ruleMultiplier = 1.0;

      switch (rule.ruleType) {
        case "occupancy": {
          const occupancyPercent = this.calculateOccupancy(tripInstance);
          // Thresholds are sorted descending by value
          const sortedThresholds = [...(rule.config.thresholds ?? [])].sort(
            (a, b) => b.value - a.value,
          );
          const threshold = sortedThresholds.find(
            (t) => occupancyPercent >= t.value,
          );
          if (threshold) {
            ruleMultiplier = threshold.multiplier;
          }
          break;
        }

        case "time_to_departure": {
          const daysOut = this.getDaysUntilDeparture(tripInstance.travelDate);
          // Thresholds are sorted ascending by value (days)
          const sortedThresholds = [...(rule.config.thresholds ?? [])].sort(
            (a, b) => a.value - b.value,
          );
          const threshold = sortedThresholds.find((t) => daysOut <= t.value);
          if (threshold) {
            ruleMultiplier = threshold.multiplier;
          }
          break;
        }

        case "day_of_week": {
          const dayName = new Date(tripInstance.travelDate)
            .toLocaleDateString("en-US", { weekday: "long" })
            .toLowerCase();
          ruleMultiplier = rule.config.dayMultipliers?.[dayName] ?? 1.0;
          break;
        }

        case "peak_hours": {
          // Would need departure time from trip - skip for now
          break;
        }
      }

      if (ruleMultiplier !== 1.0) {
        breakdown.push({ rule: rule.name, multiplier: ruleMultiplier });
        multiplier *= ruleMultiplier;
      }
    }

    // Apply surge/discount limits from config
    const { dynamicPricing } = this.appConfig.pricing.current;
    if (dynamicPricing.enabled) {
      multiplier = Math.min(multiplier, dynamicPricing.maxSurgeMultiplier);
      multiplier = Math.max(multiplier, dynamicPricing.minDiscountMultiplier);
    } else {
      // Dynamic pricing disabled - use base price
      multiplier = 1.0;
    }

    // Round to 2 decimal places
    multiplier = Math.round(multiplier * 100) / 100;

    return { multiplier, breakdown };
  }

  /**
   * Calculate occupancy percentage for a trip instance.
   */
  protected calculateOccupancy(tripInstance: TripInstance): number {
    const booked =
      tripInstance.totalSeats -
      tripInstance.availableFirstClass -
      tripInstance.availableSecondClass;
    return (booked / tripInstance.totalSeats) * 100;
  }

  /**
   * Calculate days until departure.
   */
  protected getDaysUntilDeparture(travelDate: string): number {
    const travel = new Date(travelDate);
    const now = new Date();
    // Reset to start of day for accurate day calculation
    travel.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const diffTime = travel.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Decrement fare class quota when booking is confirmed.
   * Updates embedded fareQuotas in tripInstance.
   */
  public async decrementFareClassQuota(
    tripInstanceId: string,
    fareClassId: string,
    count = 1,
  ) {
    const tripInstance = await this.tripInstances.findById(tripInstanceId);

    // Find the quota by fareClassId
    const quotaEntry = Object.entries(tripInstance.fareQuotas).find(
      ([, quota]) => quota.fareClassId === fareClassId,
    );

    if (!quotaEntry) {
      throw new Error(`Fare class quota not found for ${fareClassId}`);
    }

    const [code, quota] = quotaEntry;
    const newBookedCount = quota.bookedCount + count;
    const remaining = quota.totalQuota - newBookedCount - quota.reservedCount;

    // Update the embedded quota
    const updatedQuotas = {
      ...tripInstance.fareQuotas,
      [code]: {
        ...quota,
        bookedCount: newBookedCount,
        status: remaining <= 0 ? ("sold_out" as const) : ("available" as const),
      },
    };

    await this.tripInstances.updateById(tripInstanceId, {
      fareQuotas: updatedQuotas,
    });

    this.log.info("Decremented fare class quota", {
      tripInstanceId,
      fareClassId,
      code,
      newBookedCount,
      remaining,
    });
  }

  /**
   * Increment fare class quota (for cancellations).
   * Updates embedded fareQuotas in tripInstance.
   */
  public async incrementFareClassQuota(
    tripInstanceId: string,
    fareClassId: string,
    count = 1,
  ) {
    const tripInstance = await this.tripInstances.findById(tripInstanceId);

    // Find the quota by fareClassId
    const quotaEntry = Object.entries(tripInstance.fareQuotas).find(
      ([, quota]) => quota.fareClassId === fareClassId,
    );

    if (!quotaEntry) {
      throw new Error(`Fare class quota not found for ${fareClassId}`);
    }

    const [code, quota] = quotaEntry;
    const newBookedCount = Math.max(0, quota.bookedCount - count);

    // Update the embedded quota
    const updatedQuotas = {
      ...tripInstance.fareQuotas,
      [code]: {
        ...quota,
        bookedCount: newBookedCount,
        status: "available" as const,
      },
    };

    await this.tripInstances.updateById(tripInstanceId, {
      fareQuotas: updatedQuotas,
    });

    this.log.info("Incremented fare class quota", {
      tripInstanceId,
      fareClassId,
      code,
      newBookedCount,
    });
  }
}
