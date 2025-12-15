import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { InventoryService } from "../../inventory/services/InventoryService.ts";
import { trips } from "../../topology/entities/trips.ts";
import { fareClassResourceSchema } from "../schemas/fareClassResourceSchema.ts";
import { PricingService } from "../services/PricingService.ts";

export class PricingController {
  protected readonly log = $logger();
  protected readonly trips = $repository(trips);
  protected readonly inventoryService = $inject(InventoryService);
  protected readonly pricingService = $inject(PricingService);

  /**
   * Get available fare classes with prices for a trip instance.
   * GET /trips/:tripId/fare-classes?tripInstanceId=...&date=...
   */
  getAvailableFareClasses = $action({
    path: "/trips/:tripId/fare-classes",
    secure: false,
    description: "Get available fare classes with prices",
    schema: {
      params: t.object({ tripId: t.uuid() }),
      query: t.object({
        tripInstanceId: t.uuid(),
        date: t.text(),
      }),
      response: t.array(fareClassResourceSchema),
    },
    handler: async ({ params, query }) => {
      this.log.info("Getting fare classes", {
        tripId: params.tripId,
        tripInstanceId: query.tripInstanceId,
      });

      const fareClasses = await this.pricingService.getAvailableFareClasses(
        params.tripId,
        query.tripInstanceId,
        query.date,
      );

      return fareClasses;
    },
  });

  /**
   * Get available fare classes and prices for a trip.
   * GET /trips/:tripId/prices?date=2025-01-15
   */
  getPrices = $action({
    path: "/trips/:tripId/prices",
    secure: false,
    description: "Get fare classes with prices for a trip",
    schema: {
      params: t.object({ tripId: t.uuid() }),
      query: t.object({ date: t.text() }),
      response: t.object({
        tripInstanceId: t.uuid(),
        basePrice: t.number(),
        fareClasses: t.array(fareClassResourceSchema),
        dynamicPricingBreakdown: t.array(
          t.object({
            rule: t.text(),
            multiplier: t.number(),
          }),
        ),
      }),
    },
    handler: async ({ params, query }) => {
      this.log.info("Getting prices", {
        tripId: params.tripId,
        date: query.date,
      });

      // Get or create trip instance
      const instance = await this.inventoryService.getOrCreateTripInstance(
        params.tripId,
        query.date,
      );

      // Get trip for base price
      const trip = await this.trips.findById(params.tripId);

      // Get available fare classes with prices
      const fareClasses = await this.pricingService.getAvailableFareClasses(
        params.tripId,
        instance.id,
        query.date,
      );

      // Get pricing breakdown (from first fare class calculation)
      let breakdown: Array<{ rule: string; multiplier: number }> = [];
      if (fareClasses.length > 0) {
        const calc = await this.pricingService.calculatePrice(
          params.tripId,
          instance.id,
          fareClasses[0].id,
        );
        breakdown = calc.breakdown;
      }

      return {
        tripInstanceId: instance.id,
        basePrice: trip.basePrice,
        fareClasses,
        dynamicPricingBreakdown: breakdown,
      };
    },
  });

  /**
   * Calculate final price for specific seats and fare class.
   * POST /trips/:tripId/calculate-price
   */
  calculatePrice = $action({
    method: "POST",
    path: "/trips/:tripId/calculate-price",
    secure: false,
    description: "Calculate final price for a booking",
    schema: {
      params: t.object({ tripId: t.uuid() }),
      body: t.object({
        tripInstanceId: t.uuid(),
        fareClassId: t.uuid(),
        seatPremium: t.optional(t.number()), // Total seat premium for selected seats
        passengerCount: t.integer(),
      }),
      response: t.object({
        pricePerPassenger: t.number(),
        totalPrice: t.number(),
        breakdown: t.object({
          basePrice: t.number(),
          fareClassMultiplier: t.number(),
          dynamicMultiplier: t.number(),
          seatPremiums: t.number(),
        }),
        validUntil: t.datetime(),
        fareClass: t.object({
          id: t.uuid(),
          code: t.text(),
          name: t.text(),
          isRefundable: t.boolean(),
          isChangeable: t.boolean(),
        }),
      }),
    },
    handler: async ({ params, body }) => {
      this.log.info("Calculating price", {
        tripId: params.tripId,
        tripInstanceId: body.tripInstanceId,
        fareClassId: body.fareClassId,
        seatPremium: body.seatPremium,
        passengerCount: body.passengerCount,
      });

      const calc = await this.pricingService.calculatePrice(
        params.tripId,
        body.tripInstanceId,
        body.fareClassId,
        body.seatPremium ?? 0,
      );

      return {
        pricePerPassenger: calc.pricePerPassenger,
        totalPrice: calc.pricePerPassenger * body.passengerCount,
        breakdown: {
          basePrice: calc.basePrice,
          fareClassMultiplier: calc.fareClassMultiplier,
          dynamicMultiplier: calc.dynamicMultiplier,
          seatPremiums: calc.seatPremium,
        },
        validUntil: calc.validUntil,
        fareClass: {
          id: calc.fareClass.id,
          code: calc.fareClass.code,
          name: calc.fareClass.name,
          isRefundable: calc.fareClass.isRefundable,
          isChangeable: calc.fareClass.isChangeable,
        },
      };
    },
  });
}
