import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $action, okSchema } from "alepha/server";
import { Db } from "../providers/Db.ts";
import { type SeedData, seedSets } from "../seeds/index.ts";

export class AdminController {
  protected readonly log = $logger();
  protected readonly db = $inject(Db);

  /**
   * Get available seed sets.
   * GET /admin/seeds
   */
  getSeedSets = $action({
    path: "/admin/seeds",
    secure: false,
    description: "Get available seed data sets",
    schema: {
      response: t.array(
        t.object({
          id: t.text(),
          name: t.text(),
          stationsCount: t.integer(),
          tripsCount: t.integer(),
        }),
      ),
    },
    handler: async () => {
      return Object.entries(seedSets).map(([id, data]) => ({
        id,
        name: data.name,
        stationsCount: data.stations.length,
        tripsCount: data.trips.length,
      }));
    },
  });

  /**
   * Seed the database with data from a specific set.
   * POST /admin/seed/:setId
   */
  seed = $action({
    method: "POST",
    path: "/admin/seed/:setId",
    secure: false,
    description:
      "Seed the database with stations and trips from a specific set",
    schema: {
      params: t.object({
        setId: t.text(),
      }),
      response: t.object({
        ok: t.boolean(),
        setName: t.text(),
        stations: t.integer(),
        trips: t.integer(),
      }),
    },
    handler: async ({ params }) => {
      const seedData = seedSets[params.setId];

      if (!seedData) {
        throw new Error(
          `Unknown seed set: ${params.setId}. Available: ${Object.keys(seedSets).join(", ")}`,
        );
      }

      return this.executeSeed(seedData);
    },
  });

  /**
   * Execute seeding with given data.
   */
  protected async executeSeed(seedData: SeedData) {
    this.log.info("Starting database seed", { set: seedData.name });

    // Create stations
    const stationMap = new Map<string, string>();
    let stationsCreated = 0;

    for (const stationData of seedData.stations) {
      const existing = await this.db.stations
        .findOne({ where: { code: { eq: stationData.code } } })
        .catch(() => null);

      if (existing) {
        stationMap.set(stationData.name, existing.id);
        this.log.debug("Station already exists", { name: stationData.name });
      } else {
        const station = await this.db.stations.create(stationData);
        stationMap.set(stationData.name, station.id);
        stationsCreated++;
        this.log.debug("Created station", { name: stationData.name });
      }
    }

    // Create trips
    let tripsCreated = 0;

    for (const tripData of seedData.trips) {
      const departureStationId = stationMap.get(tripData.from);
      const arrivalStationId = stationMap.get(tripData.to);

      if (!departureStationId || !arrivalStationId) {
        this.log.warn("Station not found for trip", {
          from: tripData.from,
          to: tripData.to,
        });
        continue;
      }

      const existing = await this.db.trips
        .findOne({ where: { trainNumber: { eq: tripData.trainNumber } } })
        .catch(() => null);

      if (existing) {
        this.log.debug("Trip already exists", {
          trainNumber: tripData.trainNumber,
        });
      } else {
        await this.db.trips.create({
          departureStationId,
          arrivalStationId,
          departureTime: tripData.departureTime,
          arrivalTime: tripData.arrivalTime,
          duration: tripData.duration,
          trainNumber: tripData.trainNumber,
          trainType: tripData.trainType,
          basePrice: tripData.basePrice,
          availableSeats: tripData.availableSeats,
          active: true,
        });
        tripsCreated++;
        this.log.debug("Created trip", { trainNumber: tripData.trainNumber });
      }
    }

    this.log.info("Database seed completed", {
      set: seedData.name,
      stationsCreated,
      tripsCreated,
    });

    return {
      ok: true,
      setName: seedData.name,
      stations: stationsCreated,
      trips: tripsCreated,
    };
  }

  /**
   * Clear all data (dangerous!).
   * DELETE /admin/clear
   */
  clear = $action({
    method: "DELETE",
    path: "/admin/clear",
    secure: false,
    description: "Clear all data from the database",
    schema: {
      response: okSchema,
    },
    handler: async () => {
      this.log.warn("Clearing all data from database");

      await this.db.bookings.deleteMany({});
      await this.db.trips.deleteMany({});
      await this.db.stations.deleteMany({});

      this.log.info("Database cleared");

      return { ok: true };
    },
  });
}
