import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $action } from "alepha/server";
import { seatResourceSchema } from "../schemas/seatResourceSchema.ts";
import { InventoryService } from "../services/InventoryService.ts";

export class InventoryController {
  protected readonly log = $logger();
  protected readonly inventoryService = $inject(InventoryService);

  /**
   * Get or create a trip instance for a specific date.
   * GET /trips/:tripId/instance?date=2025-01-15
   */
  getOrCreateTripInstance = $action({
    path: "/trips/:tripId/instance",
    secure: false,
    description: "Get or create trip instance for a specific date",
    schema: {
      params: t.object({ tripId: t.uuid() }),
      query: t.object({ date: t.text() }),
      response: t.object({
        id: t.uuid(),
        tripId: t.uuid(),
        travelDate: t.text(),
        totalSeats: t.integer(),
        availableFirstClass: t.integer(),
        availableSecondClass: t.integer(),
        status: t.text(),
      }),
    },
    handler: async ({ params, query }) => {
      this.log.info("Getting/creating trip instance", {
        tripId: params.tripId,
        date: query.date,
      });

      const instance = await this.inventoryService.getOrCreateTripInstance(
        params.tripId,
        query.date,
      );

      return {
        id: instance.id,
        tripId: instance.tripId,
        travelDate: instance.travelDate,
        totalSeats: instance.totalSeats,
        availableFirstClass: instance.availableFirstClass,
        availableSecondClass: instance.availableSecondClass,
        status: instance.status,
      };
    },
  });

  /**
   * Get seats for a trip instance.
   * GET /trips/:tripId/seats?tripInstanceId=...
   */
  getSeats = $action({
    path: "/trips/:tripId/seats",
    secure: false,
    description: "Get seat map for a trip instance",
    schema: {
      params: t.object({ tripId: t.uuid() }),
      query: t.object({ tripInstanceId: t.uuid() }),
      response: t.array(seatResourceSchema),
    },
    handler: async ({ params, query }) => {
      this.log.info("Getting seats", {
        tripId: params.tripId,
        tripInstanceId: query.tripInstanceId,
      });

      // Get all seats with their current status (virtual from layout)
      const seats = await this.inventoryService.getSeats(query.tripInstanceId);

      return seats.map((seat) => ({
        seatNumber: seat.seatNumber,
        row: seat.row,
        position: seat.position,
        seatClass: seat.seatClass,
        seatType: seat.seatType,
        status: seat.status,
        seatPremium: seat.seatPremium,
      }));
    },
  });

  /**
   * Reserve seats temporarily during checkout.
   * POST /trips/:tripId/reserve
   */
  reserveSeats = $action({
    method: "POST",
    path: "/trips/:tripId/reserve",
    secure: false,
    description: "Reserve seats temporarily during checkout",
    schema: {
      params: t.object({ tripId: t.uuid() }),
      body: t.object({
        tripInstanceId: t.uuid(),
        seatNumbers: t.array(t.text()), // Seat numbers like "1-4A", "2-1B"
        sessionId: t.text(), // Checkout session ID
        durationMinutes: t.optional(t.integer({ minimum: 1, maximum: 30 })),
      }),
      response: t.object({
        seatNumbers: t.array(t.text()),
        reservedUntil: t.datetime(),
      }),
    },
    handler: async ({ params, body }) => {
      this.log.info("Reserving seats", {
        tripId: params.tripId,
        tripInstanceId: body.tripInstanceId,
        seatCount: body.seatNumbers.length,
        sessionId: body.sessionId,
        durationMinutes: body.durationMinutes,
      });

      const result = await this.inventoryService.reserveSeats(
        body.tripInstanceId,
        body.seatNumbers,
        body.sessionId,
        body.durationMinutes,
      );

      return result;
    },
  });

  /**
   * Release a seat reservation (if checkout is cancelled).
   * POST /trips/:tripId/release
   */
  releaseSeats = $action({
    method: "POST",
    path: "/trips/:tripId/release",
    secure: false,
    description: "Release seat reservation",
    schema: {
      params: t.object({ tripId: t.uuid() }),
      body: t.object({
        tripInstanceId: t.uuid(),
        seatNumbers: t.array(t.text()),
      }),
      response: t.object({
        ok: t.boolean(),
        released: t.integer(),
      }),
    },
    handler: async ({ body }) => {
      this.log.info("Releasing booked seats", {
        tripInstanceId: body.tripInstanceId,
        seatCount: body.seatNumbers.length,
      });

      await this.inventoryService.releaseBookedSeats(
        body.tripInstanceId,
        body.seatNumbers,
      );

      return {
        ok: true,
        released: body.seatNumbers.length,
      };
    },
  });
}
