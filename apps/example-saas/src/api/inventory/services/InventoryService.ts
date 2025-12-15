import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { trips } from "../../topology/entities/trips.ts";
import { seatLayouts } from "../../vehicles/entities/seatLayouts.ts";
import { fareClasses } from "../entities/fareClasses.ts";
import { seatReservations } from "../entities/seatReservations.ts";
import { type FareQuota, tripInstances } from "../entities/tripInstances.ts";

export class InventoryService {
  protected readonly log = $logger();
  protected readonly trips = $repository(trips);
  protected readonly seatLayouts = $repository(seatLayouts);
  protected readonly tripInstances = $repository(tripInstances);
  protected readonly fareClasses = $repository(fareClasses);
  protected readonly seatReservations = $repository(seatReservations);

  /**
   * Get or create a trip instance for a specific date.
   * This lazily creates the trip instance when first requested.
   */
  public async getOrCreateTripInstance(tripId: string, travelDate: string) {
    // Check if instance exists
    const existing = await this.tripInstances.findOne({
      where: {
        tripId: { eq: tripId },
        travelDate: { eq: travelDate },
      },
    });

    if (existing) {
      return existing;
    }

    // Create new instance
    return await this.createTripInstance(tripId, travelDate);
  }

  /**
   * Create a trip instance with fare quotas initialized.
   * Uses seat layout templates to determine seat configuration.
   * No individual seat rows are created - we use a sparse model.
   */
  protected async createTripInstance(tripId: string, travelDate: string) {
    const trip = await this.trips.findById(tripId);

    // Try to find a seat layout for this train type
    const layout = await this.getLayoutForTrainType(trip.trainType);

    let totalSeats: number;
    let firstClassSeats: number;
    let secondClassSeats: number;

    if (layout) {
      // Calculate from layout
      totalSeats = 0;
      firstClassSeats = 0;
      secondClassSeats = 0;

      for (const wagon of layout.wagons) {
        for (const row of wagon.rows) {
          for (const seat of row.seats) {
            if (!seat.blocked) {
              totalSeats++;
              if (seat.seatClass === "first") {
                firstClassSeats++;
              } else {
                secondClassSeats++;
              }
            }
          }
        }
      }
    } else {
      // Fallback: default layout
      const rows = trip.trainType === "Eurostar" ? 12 : 10;
      totalSeats = rows * 4;
      firstClassSeats = 3 * 4;
      secondClassSeats = (rows - 3) * 4;
    }

    // Build fare quotas as embedded JSONB
    const fareClassList = await this.fareClasses.findMany({
      where: { active: { eq: true } },
      orderBy: { column: "sortOrder", direction: "asc" },
    });

    const fareQuotas: Record<string, FareQuota> = {};
    if (fareClassList.length > 0) {
      // Saver: 30%, Standard: 40%, Flex: 30% of seats
      const quotaPercents = [0.3, 0.4, 0.3];
      for (let i = 0; i < fareClassList.length; i++) {
        const fc = fareClassList[i];
        fareQuotas[fc.code] = {
          fareClassId: fc.id,
          totalQuota: Math.floor(totalSeats * (quotaPercents[i] ?? 0.33)),
          bookedCount: 0,
          reservedCount: 0,
          status: "available",
        };
      }
    }

    // Create the trip instance
    const instance = await this.tripInstances.create({
      tripId,
      travelDate,
      seatLayoutId: layout?.id,
      availableFirstClass: firstClassSeats,
      availableSecondClass: secondClassSeats,
      totalSeats,
      fareQuotas,
      bookedSeats: [],
      currentPriceMultiplier: 1.0,
      status: "scheduled",
    });

    this.log.info("Created trip instance", {
      tripInstanceId: instance.id,
      tripId,
      travelDate,
      totalSeats,
      fareQuotaCount: Object.keys(fareQuotas).length,
    });

    return instance;
  }

  /**
   * Get all seats for a trip instance from layout template.
   * Merges booked/reserved status from tripInstance and seatReservations.
   */
  public async getSeats(tripInstanceId: string) {
    await this.releaseExpiredReservations(tripInstanceId);

    const tripInstance = await this.tripInstances.findById(tripInstanceId);

    // If no layout, return empty (or generate virtual layout)
    if (!tripInstance.seatLayoutId) {
      return this.generateVirtualSeats(tripInstance);
    }

    const layout = await this.seatLayouts.findById(tripInstance.seatLayoutId);

    // Get current reservations
    const reservations = await this.seatReservations.findMany({
      where: { tripInstanceId: { eq: tripInstanceId } },
    });
    const reservedSeatNumbers = new Set(reservations.map((r) => r.seatNumber));
    const bookedSeatNumbers = new Set(tripInstance.bookedSeats);

    // Build seat list from layout
    const seats: Array<{
      seatNumber: string;
      row: number;
      position: string;
      seatClass: "first" | "second";
      seatType: "window" | "aisle" | "middle";
      status: "available" | "reserved" | "booked" | "blocked";
      seatPremium: number;
    }> = [];

    for (const wagon of layout.wagons) {
      for (const row of wagon.rows) {
        for (const seat of row.seats) {
          const seatNumber =
            layout.wagons.length > 1
              ? `${wagon.wagonNumber}-${row.rowNumber}${seat.position}`
              : `${row.rowNumber}${seat.position}`;

          let status: "available" | "reserved" | "booked" | "blocked" =
            "available";
          if (seat.blocked) {
            status = "blocked";
          } else if (bookedSeatNumbers.has(seatNumber)) {
            status = "booked";
          } else if (reservedSeatNumbers.has(seatNumber)) {
            status = "reserved";
          }

          seats.push({
            seatNumber,
            row: row.rowNumber,
            position: seat.position,
            seatClass: seat.seatClass,
            seatType: seat.seatType,
            status,
            seatPremium: seat.premium ?? 0,
          });
        }
      }
    }

    return seats.sort(
      (a, b) => a.row - b.row || a.position.localeCompare(b.position),
    );
  }

  /**
   * Generate virtual seats when no layout exists.
   */
  protected generateVirtualSeats(tripInstance: {
    id: string;
    bookedSeats: string[];
  }) {
    const rows = 10;
    const positions = ["A", "B", "C", "D"];
    const seatTypes = ["window", "aisle", "aisle", "window"] as const;
    const seats: Array<{
      seatNumber: string;
      row: number;
      position: string;
      seatClass: "first" | "second";
      seatType: "window" | "aisle" | "middle";
      status: "available" | "booked";
      seatPremium: number;
    }> = [];

    const bookedSet = new Set(tripInstance.bookedSeats);

    for (let row = 1; row <= rows; row++) {
      const isFirstClass = row <= 3;
      for (let i = 0; i < 4; i++) {
        const seatNumber = `${row}${positions[i]}`;
        seats.push({
          seatNumber,
          row,
          position: positions[i],
          seatClass: isFirstClass ? "first" : "second",
          seatType: seatTypes[i],
          status: bookedSet.has(seatNumber) ? "booked" : "available",
          seatPremium: 0,
        });
      }
    }

    return seats;
  }

  /**
   * Get only available seats for a trip instance.
   */
  public async getAvailableSeats(tripInstanceId: string) {
    const seats = await this.getSeats(tripInstanceId);
    return seats.filter((s) => s.status === "available");
  }

  /**
   * Reserve seats temporarily during checkout flow.
   * Creates sparse seatReservation records.
   */
  public async reserveSeats(
    tripInstanceId: string,
    seatNumbers: string[],
    sessionId: string,
    durationMinutes = 10,
  ): Promise<{ seatNumbers: string[]; reservedUntil: string }> {
    await this.releaseExpiredReservations(tripInstanceId);

    const tripInstance = await this.tripInstances.findById(tripInstanceId);

    // Check seats are not already booked
    const bookedSet = new Set(tripInstance.bookedSeats);
    const alreadyBooked = seatNumbers.filter((n) => bookedSet.has(n));
    if (alreadyBooked.length > 0) {
      throw new Error(`Seats already booked: ${alreadyBooked.join(", ")}`);
    }

    // Check seats are not already reserved by someone else
    const existingReservations = await this.seatReservations.findMany({
      where: {
        tripInstanceId: { eq: tripInstanceId },
        seatNumber: { inArray: seatNumbers },
      },
    });
    if (existingReservations.length > 0) {
      throw new Error(
        `Seats already reserved: ${existingReservations.map((r) => r.seatNumber).join(", ")}`,
      );
    }

    // Get seat details from layout for class info
    const allSeats = await this.getSeats(tripInstanceId);
    const seatMap = new Map(allSeats.map((s) => [s.seatNumber, s]));

    const reservedUntil = new Date(
      Date.now() + durationMinutes * 60 * 1000,
    ).toISOString();

    // Create reservation records
    const reservationData = seatNumbers.map((seatNumber) => {
      const seat = seatMap.get(seatNumber);
      return {
        tripInstanceId,
        seatNumber,
        seatClass: (seat?.seatClass ?? "second") as "first" | "second",
        sessionId,
        expiresAt: reservedUntil,
        seatPremium: seat?.seatPremium ?? 0,
      };
    });

    await this.seatReservations.createMany(reservationData);

    this.log.info("Reserved seats", {
      tripInstanceId,
      seatNumbers,
      sessionId,
      reservedUntil,
    });

    return { seatNumbers, reservedUntil };
  }

  /**
   * Confirm reservation and mark seats as booked.
   * Removes seatReservation records and adds to tripInstance.bookedSeats.
   */
  public async confirmReservation(
    tripInstanceId: string,
    seatNumbers: string[],
    sessionId: string,
  ) {
    // Verify reservations exist and belong to this session
    const reservations = await this.seatReservations.findMany({
      where: {
        tripInstanceId: { eq: tripInstanceId },
        seatNumber: { inArray: seatNumbers },
        sessionId: { eq: sessionId },
      },
    });

    if (reservations.length !== seatNumbers.length) {
      throw new Error("Some seats are not reserved or reservation has expired");
    }

    // Get current trip instance
    const tripInstance = await this.tripInstances.findById(tripInstanceId);

    // Add to bookedSeats
    const newBookedSeats = [...tripInstance.bookedSeats, ...seatNumbers];

    // Count seats by class
    const allSeats = await this.getSeats(tripInstanceId);
    const seatMap = new Map(allSeats.map((s) => [s.seatNumber, s]));

    let firstClassBooked = 0;
    let secondClassBooked = 0;
    for (const num of seatNumbers) {
      const seat = seatMap.get(num);
      if (seat?.seatClass === "first") {
        firstClassBooked++;
      } else {
        secondClassBooked++;
      }
    }

    // Update trip instance
    await this.tripInstances.updateById(tripInstanceId, {
      bookedSeats: newBookedSeats,
      availableFirstClass: tripInstance.availableFirstClass - firstClassBooked,
      availableSecondClass:
        tripInstance.availableSecondClass - secondClassBooked,
    });

    // Delete reservations
    for (const r of reservations) {
      await this.seatReservations.deleteById(r.id);
    }

    this.log.info("Confirmed seat reservation", {
      tripInstanceId,
      seatNumbers,
      sessionId,
    });
  }

  /**
   * Release booked seats (for cancellations).
   * Removes from tripInstance.bookedSeats.
   */
  public async releaseBookedSeats(
    tripInstanceId: string,
    seatNumbers: string[],
  ) {
    if (seatNumbers.length === 0) return;

    const tripInstance = await this.tripInstances.findById(tripInstanceId);

    const seatSet = new Set(seatNumbers);
    const newBookedSeats = tripInstance.bookedSeats.filter(
      (s) => !seatSet.has(s),
    );

    // Count seats by class
    const allSeats = await this.getSeats(tripInstanceId);
    const seatMap = new Map(allSeats.map((s) => [s.seatNumber, s]));

    let firstClassReleased = 0;
    let secondClassReleased = 0;
    for (const num of seatNumbers) {
      const seat = seatMap.get(num);
      if (seat?.seatClass === "first") {
        firstClassReleased++;
      } else {
        secondClassReleased++;
      }
    }

    await this.tripInstances.updateById(tripInstanceId, {
      bookedSeats: newBookedSeats,
      availableFirstClass:
        tripInstance.availableFirstClass + firstClassReleased,
      availableSecondClass:
        tripInstance.availableSecondClass + secondClassReleased,
    });

    this.log.info("Released booked seats", { tripInstanceId, seatNumbers });
  }

  /**
   * Book seats directly (for admin bookings that bypass reservation flow).
   * Adds to tripInstance.bookedSeats and updates availability counts.
   */
  public async bookSeatsDirectly(
    tripInstanceId: string,
    seatNumbers: string[],
  ) {
    if (seatNumbers.length === 0) return;

    const tripInstance = await this.tripInstances.findById(tripInstanceId);

    // Check seats are not already booked
    const bookedSet = new Set(tripInstance.bookedSeats);
    const alreadyBooked = seatNumbers.filter((n) => bookedSet.has(n));
    if (alreadyBooked.length > 0) {
      throw new Error(`Seats already booked: ${alreadyBooked.join(", ")}`);
    }

    // Add to bookedSeats
    const newBookedSeats = [...tripInstance.bookedSeats, ...seatNumbers];

    // Count seats by class
    const allSeats = await this.getSeats(tripInstanceId);
    const seatMap = new Map(allSeats.map((s) => [s.seatNumber, s]));

    let firstClassBooked = 0;
    let secondClassBooked = 0;
    for (const num of seatNumbers) {
      const seat = seatMap.get(num);
      if (seat?.seatClass === "first") {
        firstClassBooked++;
      } else {
        secondClassBooked++;
      }
    }

    // Update trip instance
    await this.tripInstances.updateById(tripInstanceId, {
      bookedSeats: newBookedSeats,
      availableFirstClass: tripInstance.availableFirstClass - firstClassBooked,
      availableSecondClass:
        tripInstance.availableSecondClass - secondClassBooked,
    });

    this.log.info("Booked seats directly", { tripInstanceId, seatNumbers });
  }

  /**
   * Release expired reservations.
   */
  public async releaseExpiredReservations(tripInstanceId?: string) {
    const now = new Date().toISOString();
    const where: Record<string, unknown> = {
      expiresAt: { lt: now },
    };

    if (tripInstanceId) {
      where.tripInstanceId = { eq: tripInstanceId };
    }

    const expired = await this.seatReservations.findMany({ where });

    for (const r of expired) {
      await this.seatReservations.deleteById(r.id);
    }

    if (expired.length > 0) {
      this.log.debug("Released expired reservations", {
        count: expired.length,
      });
    }
  }

  /**
   * Get availability summary for a trip instance.
   */
  public async getAvailabilitySummary(tripInstanceId: string) {
    const instance = await this.tripInstances.findById(tripInstanceId);
    const bookedCount = instance.bookedSeats.length;
    return {
      totalSeats: instance.totalSeats,
      availableFirstClass: instance.availableFirstClass,
      availableSecondClass: instance.availableSecondClass,
      bookedSeats: bookedCount,
      occupancyPercent: Math.round((bookedCount / instance.totalSeats) * 100),
    };
  }

  /**
   * Get the default seat layout for a train type.
   */
  protected async getLayoutForTrainType(trainType: string) {
    const defaultLayout = await this.seatLayouts.findOne({
      where: {
        trainType: { eq: trainType },
        isDefault: { eq: true },
        active: { eq: true },
      },
    });

    if (defaultLayout) {
      return defaultLayout;
    }

    return await this.seatLayouts.findOne({
      where: {
        trainType: { eq: trainType },
        active: { eq: true },
      },
    });
  }
}
