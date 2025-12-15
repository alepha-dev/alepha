import { t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { type Station, stations } from "../entities/stations.ts";
import {
  type StationResource,
  stationSchema,
} from "../schemas/stationSchema.ts";

/**
 * Map station entity to API resource.
 */
const toResource = (s: Station): StationResource => ({
  id: s.id,
  name: s.name,
  code: s.code,
  city: s.city,
  country: s.country,
  latitude: s.latitude,
  longitude: s.longitude,
  timezone: s.timezone,
  address: s.address,
  platforms: s.platforms,
  description: s.description,
  imageUrl: s.imageUrl,
});

export class StationController {
  protected readonly log = $logger();
  protected readonly stations = $repository(stations);

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
      const result = await this.stations.findMany({
        orderBy: "name",
      });
      return result.map(toResource);
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
      const station = await this.stations.findById(params.id);
      return toResource(station);
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
      const station = await this.stations.create(body);
      return toResource(station);
    },
  });

  /**
   * Update a station (admin only).
   * PUT /stations/:id
   */
  updateStation = $action({
    method: "PUT",
    path: "/stations/:id",
    secure: false, // TODO: add admin auth
    description: "Update a station",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.partial(
        t.omit(stations.insertSchema, ["id", "createdAt", "updatedAt"]),
      ),
      response: stationSchema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating station", { id: params.id });
      const station = await this.stations.updateById(params.id, body);
      return toResource(station);
    },
  });

  /**
   * Delete a station (admin only).
   * DELETE /stations/:id
   */
  deleteStation = $action({
    method: "DELETE",
    path: "/stations/:id",
    secure: false, // TODO: add admin auth
    description: "Delete a station",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({ success: t.boolean() }),
    },
    handler: async ({ params }) => {
      this.log.info("Deleting station", { id: params.id });
      await this.stations.deleteById(params.id);
      return { success: true };
    },
  });
}
