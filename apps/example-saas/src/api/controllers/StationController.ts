import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $action } from "alepha/server";
import { stations } from "../entities/stations.ts";
import { Db } from "../providers/Db.ts";
import { stationSchema } from "../schemas/stationSchema.ts";

export class StationController {
  protected readonly log = $logger();
  protected readonly db = $inject(Db);

  /**
   * Get all stations.
   * GET /stations
   */
  getStations = $action({
    path: "/stations",
    secure: false,
    description: "Get all available train stations",
    schema: {
      response: t.array(stationSchema),
    },
    handler: async () => {
      this.log.debug("Fetching all stations");
      const result = await this.db.stations.findMany({
        orderBy: "name",
      });
      return result.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        city: s.city,
        country: s.country,
      }));
    },
  });

  /**
   * Get station by ID.
   * GET /stations/:id
   */
  getStationById = $action({
    path: "/stations/:id",
    secure: false,
    description: "Get a station by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: stationSchema,
    },
    handler: async ({ params }) => {
      const station = await this.db.stations.findById(params.id);
      return {
        id: station.id,
        name: station.name,
        code: station.code,
        city: station.city,
        country: station.country,
      };
    },
  });

  /**
   * Create a station (admin only).
   * POST /stations
   */
  createStation = $action({
    method: "POST",
    path: "/stations",
    secure: false, // TODO: add admin auth
    description: "Create a new station",
    schema: {
      body: t.omit(stations.insertSchema, ["id", "createdAt", "updatedAt"]),
      response: stationSchema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating station", { name: body.name, code: body.code });
      const station = await this.db.stations.create(body);
      return {
        id: station.id,
        name: station.name,
        code: station.code,
        city: station.city,
        country: station.country,
      };
    },
  });
}
