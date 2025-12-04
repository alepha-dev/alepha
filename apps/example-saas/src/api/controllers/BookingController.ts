import { $inject, type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $action, okSchema } from "alepha/server";
import { type Booking, bookings } from "../entities/bookings.ts";
import { BookingNotifications } from "../notifications/BookingNotifications.ts";
import { Db } from "../providers/Db.ts";
import { BookingService } from "../services/BookingService.ts";

export class BookingController {
  protected readonly log = $logger();
  protected readonly db = $inject(Db);
  protected readonly bookingService = $inject(BookingService);
  protected readonly notifications = $inject(BookingNotifications);

  /**
   * Create a new booking.
   * POST /bookings
   */
  createBooking = $action({
    method: "POST",
    path: "/bookings",
    secure: false,
    description: "Create a new train booking",
    schema: {
      body: t.omit(bookings.insertSchema, [
        "id",
        "createdAt",
        "updatedAt",
        "reference",
        "status",
      ]),
      response: bookings.schema,
    },
    handler: async ({ body }) => {
      const reference = this.bookingService.generateBookingReference();

      this.log.info("Creating booking", {
        reference,
        from: body.departureStation,
        to: body.arrivalStation,
        passengerEmail: body.passengerEmail,
      });

      const booking = await this.db.bookings.create({
        ...body,
        reference,
        status: "confirmed",
      });

      this.log.info("Booking created", {
        id: booking.id,
        reference: booking.reference,
      });

      // Send confirmation email
      await this.notifications.bookingConfirmation.push({
        contact: booking.passengerEmail,
        variables: {
          passengerFirstName: booking.passengerFirstName,
          passengerLastName: booking.passengerLastName,
          passengerEmail: booking.passengerEmail,
          reference: booking.reference,
          departureStation: booking.departureStation,
          arrivalStation: booking.arrivalStation,
          departureTime: booking.departureTime,
          arrivalTime: booking.arrivalTime,
          travelDate: booking.travelDate,
          trainNumber: booking.trainNumber,
          trainType: booking.trainType,
          passengerCount: booking.passengerCount,
          seats: booking.seats.map((s) => s.number).join(", "),
          totalPrice: booking.totalPrice.toFixed(2),
        },
      });

      this.log.info("Booking confirmation email sent", {
        reference: booking.reference,
        email: booking.passengerEmail,
      });

      return booking;
    },
  });

  /**
   * Get a booking by reference.
   * GET /bookings/:reference
   */
  getBookingByReference = $action({
    path: "/bookings/:reference",
    secure: false,
    description: "Get booking details by reference code",
    schema: {
      params: t.object({
        reference: t.text(),
      }),
      response: bookings.schema,
    },
    handler: async ({ params }) => {
      this.log.debug("Fetching booking", { reference: params.reference });

      return await this.db.bookings.findOne({
        where: {
          reference: { eq: params.reference },
        },
      });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all bookings with pagination and filtering.
   * GET /admin/bookings
   */
  findBookings = $action({
    path: "/admin/bookings",
    secure: false,
    description: "Find all bookings with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        status: t.optional(t.enum(["pending", "confirmed", "cancelled"])),
      }),
      response: t.page(bookings.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      this.log.debug("Finding bookings", { page, size, query: query.query });

      const where: Record<string, any> = {};

      if (query.status) {
        where.status = { eq: query.status };
      }

      if (query.query) {
        where.or = [
          { reference: { ilike: `%${query.query}%` } },
          { passengerEmail: { ilike: `%${query.query}%` } },
          { passengerFirstName: { ilike: `%${query.query}%` } },
          { passengerLastName: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.db.bookings.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: { column: "createdAt", direction: "desc" },
        },
      );

      return result as Page<Booking>;
    },
  });

  /**
   * Get a booking by ID.
   * GET /admin/bookings/:id
   */
  getBooking = $action({
    path: "/admin/bookings/:id",
    secure: false,
    description: "Get a booking by ID",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: bookings.schema,
    },
    handler: async ({ params }) => {
      this.log.debug("Fetching booking by ID", { id: params.id });
      return await this.db.bookings.findById(params.id);
    },
  });

  /**
   * Update a booking.
   * PATCH /admin/bookings/:id
   */
  updateBooking = $action({
    method: "PATCH",
    path: "/admin/bookings/:id",
    secure: false,
    description: "Update a booking",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      body: t.object({
        passengerFirstName: t.optional(t.text()),
        passengerLastName: t.optional(t.text()),
        passengerEmail: t.optional(t.email()),
        status: t.optional(t.enum(["pending", "confirmed", "cancelled"])),
      }),
      response: bookings.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating booking", { id: params.id, updates: body });

      const booking = await this.db.bookings.updateById(params.id, body);

      this.log.info("Booking updated", {
        id: booking.id,
        reference: booking.reference,
      });

      return booking;
    },
  });

  /**
   * Cancel a booking.
   * POST /admin/bookings/:id/cancel
   */
  cancelBooking = $action({
    method: "POST",
    path: "/admin/bookings/:id/cancel",
    secure: false,
    description: "Cancel a booking",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      this.log.info("Cancelling booking", { id: params.id });

      // Get booking details before cancelling
      const booking = await this.db.bookings.findById(params.id);

      await this.db.bookings.updateById(params.id, { status: "cancelled" });

      this.log.info("Booking cancelled", { id: params.id });

      // Send cancellation email
      await this.notifications.bookingCancellation.push({
        contact: booking.passengerEmail,
        variables: {
          passengerFirstName: booking.passengerFirstName,
          passengerEmail: booking.passengerEmail,
          reference: booking.reference,
          departureStation: booking.departureStation,
          arrivalStation: booking.arrivalStation,
          travelDate: booking.travelDate,
        },
      });

      this.log.info("Booking cancellation email sent", {
        reference: booking.reference,
        email: booking.passengerEmail,
      });

      return { ok: true };
    },
  });
}
