import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $action } from "alepha/server";
import { trips } from "../entities/trips.ts";
import { Db } from "../providers/Db.ts";
import { searchQuerySchema } from "../schemas/searchQuerySchema.ts";
import { tripSchema } from "../schemas/tripSchema.ts";

export class TripController {
  protected readonly log = $logger();
  protected readonly db = $inject(Db);

  /**
   * Search for trips between stations.
   * GET /trips/search?from=...&to=...&date=...
   */
  searchTrips = $action({
    path: "/trips/search",
    secure: false,
    description: "Search for available train trips",
    schema: {
      query: searchQuerySchema,
      response: t.array(tripSchema),
    },
    handler: async ({ query }) => {
      this.log.info("Searching trips", {
        from: query.from,
        to: query.to,
        date: query.date,
      });

      // Find departure and arrival stations by name
      const [departureStation, arrivalStation] = await Promise.all([
        this.db.stations
          .findOne({ where: { name: { eq: query.from } } })
          .catch(() => null),
        this.db.stations
          .findOne({ where: { name: { eq: query.to } } })
          .catch(() => null),
      ]);

      if (!departureStation || !arrivalStation) {
        this.log.warn("Station not found", {
          from: query.from,
          to: query.to,
          departureFound: !!departureStation,
          arrivalFound: !!arrivalStation,
        });
        return [];
      }

      // Find active trips for this route
      const result = await this.db.trips.findMany({
        where: {
          departureStationId: { eq: departureStation.id },
          arrivalStationId: { eq: arrivalStation.id },
          active: { eq: true },
        },
        orderBy: "departureTime",
      });

      this.log.debug("Found trips", { count: result.length });

      return result.map((trip) => ({
        id: trip.id,
        departureStation: departureStation.name,
        arrivalStation: arrivalStation.name,
        departureTime: trip.departureTime,
        arrivalTime: trip.arrivalTime,
        duration: trip.duration,
        trainNumber: trip.trainNumber,
        trainType: trip.trainType,
        price: trip.basePrice,
        availableSeats: trip.availableSeats,
      }));
    },
  });

  /**
   * Get trip by ID.
   * GET /trips/:id
   */
  getTripById = $action({
    path: "/trips/:id",
    secure: false,
    description: "Get a trip by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: tripSchema,
    },
    handler: async ({ params }) => {
      const trip = await this.db.trips.findById(params.id);

      const [departureStation, arrivalStation] = await Promise.all([
        this.db.stations.findById(trip.departureStationId),
        this.db.stations.findById(trip.arrivalStationId),
      ]);

      return {
        id: trip.id,
        departureStation: departureStation.name,
        arrivalStation: arrivalStation.name,
        departureTime: trip.departureTime,
        arrivalTime: trip.arrivalTime,
        duration: trip.duration,
        trainNumber: trip.trainNumber,
        trainType: trip.trainType,
        price: trip.basePrice,
        availableSeats: trip.availableSeats,
      };
    },
  });

  /**
   * Get popular routes (4 random trips for display).
   * GET /trips/popular
   */
  getPopularRoutes = $action({
    path: "/trips/popular",
    secure: false,
    description: "Get popular routes for homepage display",
    schema: {
      response: t.array(tripSchema),
    },
    handler: async () => {
      this.log.debug("Fetching popular routes");

      // Get all active trips
      const allTrips = await this.db.trips.findMany({
        where: { active: { eq: true } },
      });

      // Group by route (departure-arrival pair) and pick one trip per route
      const routeMap = new Map<string, (typeof allTrips)[0]>();
      for (const trip of allTrips) {
        const routeKey = `${trip.departureStationId}-${trip.arrivalStationId}`;
        if (!routeMap.has(routeKey)) {
          routeMap.set(routeKey, trip);
        }
      }

      // Get unique routes and shuffle them
      const uniqueTrips = Array.from(routeMap.values());
      for (let i = uniqueTrips.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [uniqueTrips[i], uniqueTrips[j]] = [uniqueTrips[j], uniqueTrips[i]];
      }

      // Take first 4
      const selectedTrips = uniqueTrips.slice(0, 4);

      // Fetch station names for each trip
      const tripsWithStations = await Promise.all(
        selectedTrips.map(async (trip) => {
          const [departureStation, arrivalStation] = await Promise.all([
            this.db.stations.findById(trip.departureStationId),
            this.db.stations.findById(trip.arrivalStationId),
          ]);

          return {
            id: trip.id,
            departureStation: departureStation.name,
            arrivalStation: arrivalStation.name,
            departureTime: trip.departureTime,
            arrivalTime: trip.arrivalTime,
            duration: trip.duration,
            trainNumber: trip.trainNumber,
            trainType: trip.trainType,
            price: trip.basePrice,
            availableSeats: trip.availableSeats,
          };
        }),
      );

      return tripsWithStations;
    },
  });

  /**
   * Create a trip (admin only).
   * POST /trips
   */
  createTrip = $action({
    method: "POST",
    path: "/trips",
    secure: false, // TODO: add admin auth
    description: "Create a new trip",
    schema: {
      body: t.omit(trips.insertSchema, ["id", "createdAt", "updatedAt"]),
      response: trips.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating trip", { trainNumber: body.trainNumber });
      return await this.db.trips.create(body);
    },
  });
}
