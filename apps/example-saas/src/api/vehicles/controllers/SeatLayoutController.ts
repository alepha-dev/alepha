import { type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import {
  type SeatLayout,
  type SeatRow,
  seatLayouts,
  type Wagon,
  wagonSchema,
} from "../entities/seatLayouts.ts";

// Helper to calculate totals from wagons
function calculateTotals(wagons: Wagon[]) {
  let totalSeats = 0;
  let firstClassSeats = 0;
  let secondClassSeats = 0;

  for (const wagon of wagons) {
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

  return { totalSeats, firstClassSeats, secondClassSeats };
}

// Helper to calculate wagon totals
function calculateWagonTotals(rows: SeatRow[]) {
  let totalSeats = 0;
  let firstClassSeats = 0;
  let secondClassSeats = 0;

  for (const row of rows) {
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

  return { totalSeats, firstClassSeats, secondClassSeats };
}

export class SeatLayoutController {
  protected readonly log = $logger();
  protected readonly seatLayouts = $repository(seatLayouts);

  // ─────────────────────────────────────────────────────────────────────────────
  // List & Query
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all seat layouts with pagination and filtering.
   * GET /admin/seat-layouts
   */
  findSeatLayouts = $action({
    path: "/admin/seat-layouts",
    secure: false,
    description: "Find all seat layouts with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        trainType: t.optional(t.text()),
        active: t.optional(t.boolean()),
      }),
      response: t.page(seatLayouts.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.active !== undefined) {
        where.active = { eq: query.active };
      }

      if (query.trainType) {
        where.trainType = { eq: query.trainType };
      }

      if (query.query) {
        where.or = [
          { name: { ilike: `%${query.query}%` } },
          { trainType: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.seatLayouts.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "trainType", direction: "asc" },
            { column: "name", direction: "asc" },
          ],
        },
      );

      return result as Page<SeatLayout>;
    },
  });

  /**
   * Get a single seat layout by ID.
   * GET /admin/seat-layouts/:id
   */
  getSeatLayout = $action({
    path: "/admin/seat-layouts/:id",
    secure: false,
    description: "Get a seat layout by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: seatLayouts.schema,
    },
    handler: async ({ params }) => {
      return await this.seatLayouts.findById(params.id);
    },
  });

  /**
   * Get available train types.
   * GET /admin/seat-layouts/train-types
   */
  getTrainTypes = $action({
    path: "/admin/seat-layouts/train-types",
    secure: false,
    description: "Get list of train types with layouts",
    schema: {
      response: t.array(t.text()),
    },
    handler: async () => {
      const layouts = await this.seatLayouts.findMany({
        where: { active: { eq: true } },
      });

      const trainTypes = [...new Set(layouts.map((l) => l.trainType))];
      return trainTypes.sort();
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Create & Update
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new seat layout with wagons.
   * POST /admin/seat-layouts
   */
  createSeatLayout = $action({
    method: "POST",
    path: "/admin/seat-layouts",
    secure: false,
    description: "Create a new seat layout",
    schema: {
      body: t.object({
        name: t.text(),
        description: t.optional(t.text()),
        trainType: t.text(),
        wagons: t.array(wagonSchema),
        isDefault: t.optional(t.boolean()),
      }),
      response: seatLayouts.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating seat layout", {
        name: body.name,
        trainType: body.trainType,
        wagons: body.wagons.length,
      });

      // Calculate totals from wagons
      const { totalSeats, firstClassSeats, secondClassSeats } = calculateTotals(
        body.wagons,
      );

      // Calculate per-wagon totals
      const wagonsWithTotals = body.wagons.map((wagon) => {
        const wagonTotals = calculateWagonTotals(wagon.rows);
        return {
          ...wagon,
          totalSeats: wagonTotals.totalSeats,
          firstClassSeats: wagonTotals.firstClassSeats,
          secondClassSeats: wagonTotals.secondClassSeats,
        };
      });

      // If setting as default, unset other defaults for this train type
      if (body.isDefault) {
        const existingDefaults = await this.seatLayouts.findMany({
          where: {
            trainType: { eq: body.trainType },
            isDefault: { eq: true },
          },
        });

        for (const layout of existingDefaults) {
          await this.seatLayouts.updateById(layout.id, { isDefault: false });
        }
      }

      const layout = await this.seatLayouts.create({
        name: body.name,
        description: body.description,
        trainType: body.trainType,
        wagons: wagonsWithTotals,
        totalSeats,
        firstClassSeats,
        secondClassSeats,
        totalWagons: body.wagons.length,
        isDefault: body.isDefault ?? false,
        active: true,
      });

      this.log.info("Seat layout created", {
        id: layout.id,
        name: layout.name,
        totalSeats,
        totalWagons: body.wagons.length,
      });

      return layout;
    },
  });

  /**
   * Update a seat layout.
   * PATCH /admin/seat-layouts/:id
   */
  updateSeatLayout = $action({
    method: "PATCH",
    path: "/admin/seat-layouts/:id",
    secure: false,
    description: "Update a seat layout",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        name: t.optional(t.text()),
        description: t.optional(t.text()),
        trainType: t.optional(t.text()),
        wagons: t.optional(t.array(wagonSchema)),
        isDefault: t.optional(t.boolean()),
        active: t.optional(t.boolean()),
      }),
      response: seatLayouts.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating seat layout", { id: params.id });

      const existing = await this.seatLayouts.findById(params.id);
      const updates: Record<string, unknown> = { ...body };

      // Recalculate totals if wagons changed
      if (body.wagons) {
        const { totalSeats, firstClassSeats, secondClassSeats } =
          calculateTotals(body.wagons);

        // Calculate per-wagon totals
        const wagonsWithTotals = body.wagons.map((wagon) => {
          const wagonTotals = calculateWagonTotals(wagon.rows);
          return {
            ...wagon,
            totalSeats: wagonTotals.totalSeats,
            firstClassSeats: wagonTotals.firstClassSeats,
            secondClassSeats: wagonTotals.secondClassSeats,
          };
        });

        updates.wagons = wagonsWithTotals;
        updates.totalSeats = totalSeats;
        updates.firstClassSeats = firstClassSeats;
        updates.secondClassSeats = secondClassSeats;
        updates.totalWagons = body.wagons.length;
      }

      // If setting as default, unset other defaults for this train type
      if (body.isDefault) {
        const trainType = body.trainType ?? existing.trainType;
        const existingDefaults = await this.seatLayouts.findMany({
          where: {
            trainType: { eq: trainType },
            isDefault: { eq: true },
          },
        });

        for (const layout of existingDefaults) {
          if (layout.id !== params.id) {
            await this.seatLayouts.updateById(layout.id, {
              isDefault: false,
            });
          }
        }
      }

      const layout = await this.seatLayouts.updateById(params.id, updates);

      this.log.info("Seat layout updated", {
        id: layout.id,
        name: layout.name,
      });

      return layout;
    },
  });

  /**
   * Delete a seat layout.
   * DELETE /admin/seat-layouts/:id
   */
  deleteSeatLayout = $action({
    method: "DELETE",
    path: "/admin/seat-layouts/:id",
    secure: false,
    description: "Delete a seat layout",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      this.log.info("Deleting seat layout", { id: params.id });

      await this.seatLayouts.deleteById(params.id);

      return { ok: true };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Wagon Generation Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a wagon template.
   * POST /admin/seat-layouts/generate-wagon
   */
  generateWagon = $action({
    method: "POST",
    path: "/admin/seat-layouts/generate-wagon",
    secure: false,
    description: "Generate a wagon layout template",
    schema: {
      body: t.object({
        wagonNumber: t.integer({ minimum: 1 }),
        wagonType: t.enum([
          "first_class",
          "second_class",
          "mixed",
          "restaurant",
          "bar",
          "quiet",
          "family",
          "business",
          "accessible",
        ]),
        totalRows: t.integer({ minimum: 1, maximum: 30 }),
        seatsPerRow: t.integer({ minimum: 2, maximum: 10 }),
        firstClassRows: t.integer({ minimum: 0 }),
        aisleAfterPosition: t.text(),
      }),
      response: wagonSchema,
    },
    handler: async ({ body }) => {
      const {
        wagonNumber,
        wagonType,
        totalRows,
        seatsPerRow,
        firstClassRows,
        aisleAfterPosition,
      } = body;

      // Generate position letters (A, B, C, D, ...)
      const positions: string[] = [];
      for (let i = 0; i < seatsPerRow; i++) {
        positions.push(String.fromCharCode(65 + i));
      }

      const aisleIndex = positions.indexOf(aisleAfterPosition);

      const rows: SeatRow[] = [];
      let totalSeats = 0;
      let firstClassSeatsCount = 0;
      let secondClassSeatsCount = 0;

      for (let row = 1; row <= totalRows; row++) {
        const isFirstClass = row <= firstClassRows;
        const rowSeats: Array<{
          position: string;
          seatType: "window" | "aisle" | "middle";
          seatClass: "first" | "second";
          premium: number;
        }> = [];

        for (let i = 0; i < positions.length; i++) {
          let seatType: "window" | "aisle" | "middle";
          if (i === 0 || i === positions.length - 1) {
            seatType = "window";
          } else if (i === aisleIndex || i === aisleIndex + 1) {
            seatType = "aisle";
          } else {
            seatType = "middle";
          }

          rowSeats.push({
            position: positions[i],
            seatType,
            seatClass: isFirstClass ? "first" : "second",
            premium: isFirstClass ? 35 : 0,
          });

          totalSeats++;
          if (isFirstClass) {
            firstClassSeatsCount++;
          } else {
            secondClassSeatsCount++;
          }
        }

        rows.push({
          rowNumber: row,
          seats: rowSeats,
        });
      }

      // Determine default amenities based on wagon type
      const hasWifi = ["first_class", "business"].includes(wagonType);
      const hasPowerOutlets = !["restaurant", "bar"].includes(wagonType);

      return {
        wagonNumber,
        wagonType,
        rows,
        seatsPerRow,
        aisleAfterPosition,
        hasWifi,
        hasPowerOutlets,
        totalSeats,
        firstClassSeats: firstClassSeatsCount,
        secondClassSeats: secondClassSeatsCount,
      };
    },
  });

  /**
   * Generate a complete train layout with multiple wagons.
   * POST /admin/seat-layouts/generate-train
   */
  generateTrain = $action({
    method: "POST",
    path: "/admin/seat-layouts/generate-train",
    secure: false,
    description: "Generate a complete train layout with multiple wagons",
    schema: {
      body: t.object({
        trainType: t.text(),
        configuration: t.array(
          t.object({
            wagonType: t.enum([
              "first_class",
              "second_class",
              "mixed",
              "restaurant",
              "bar",
              "quiet",
              "family",
              "business",
              "accessible",
            ]),
            count: t.integer({ minimum: 1 }),
            rowsPerWagon: t.integer({ minimum: 1, maximum: 30 }),
            seatsPerRow: t.integer({ minimum: 2, maximum: 10 }),
            aisleAfterPosition: t.text(),
          }),
        ),
      }),
      response: t.object({
        wagons: t.array(wagonSchema),
        totalSeats: t.integer(),
        firstClassSeats: t.integer(),
        secondClassSeats: t.integer(),
        totalWagons: t.integer(),
      }),
    },
    handler: async ({ body }) => {
      const wagons: Wagon[] = [];
      let wagonNumber = 1;

      for (const config of body.configuration) {
        for (let i = 0; i < config.count; i++) {
          const isFirstClass =
            config.wagonType === "first_class" ||
            config.wagonType === "business";

          // Generate rows for this wagon
          const positions: string[] = [];
          for (let j = 0; j < config.seatsPerRow; j++) {
            positions.push(String.fromCharCode(65 + j));
          }

          const aisleIndex = positions.indexOf(config.aisleAfterPosition);
          const rows: SeatRow[] = [];
          let wagonTotalSeats = 0;
          let wagonFirstClass = 0;
          let wagonSecondClass = 0;

          for (let row = 1; row <= config.rowsPerWagon; row++) {
            const rowSeats: Array<{
              position: string;
              seatType: "window" | "aisle" | "middle";
              seatClass: "first" | "second";
              premium: number;
            }> = [];

            for (let j = 0; j < positions.length; j++) {
              let seatType: "window" | "aisle" | "middle";
              if (j === 0 || j === positions.length - 1) {
                seatType = "window";
              } else if (j === aisleIndex || j === aisleIndex + 1) {
                seatType = "aisle";
              } else {
                seatType = "middle";
              }

              const seatClass = isFirstClass ? "first" : "second";
              rowSeats.push({
                position: positions[j],
                seatType,
                seatClass,
                premium: isFirstClass ? 35 : 0,
              });

              wagonTotalSeats++;
              if (isFirstClass) {
                wagonFirstClass++;
              } else {
                wagonSecondClass++;
              }
            }

            rows.push({ rowNumber: row, seats: rowSeats });
          }

          wagons.push({
            wagonNumber: wagonNumber++,
            wagonType: config.wagonType,
            rows,
            seatsPerRow: config.seatsPerRow,
            aisleAfterPosition: config.aisleAfterPosition,
            hasWifi: isFirstClass,
            hasPowerOutlets: !["restaurant", "bar"].includes(config.wagonType),
            totalSeats: wagonTotalSeats,
            firstClassSeats: wagonFirstClass,
            secondClassSeats: wagonSecondClass,
          });
        }
      }

      const { totalSeats, firstClassSeats, secondClassSeats } =
        calculateTotals(wagons);

      return {
        wagons,
        totalSeats,
        firstClassSeats,
        secondClassSeats,
        totalWagons: wagons.length,
      };
    },
  });

  /**
   * Clone an existing layout.
   * POST /admin/seat-layouts/:id/clone
   */
  cloneSeatLayout = $action({
    method: "POST",
    path: "/admin/seat-layouts/:id/clone",
    secure: false,
    description: "Clone an existing seat layout",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        name: t.text(),
        trainType: t.optional(t.text()),
      }),
      response: seatLayouts.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Cloning seat layout", { id: params.id });

      const source = await this.seatLayouts.findById(params.id);

      const layout = await this.seatLayouts.create({
        name: body.name,
        description: source.description
          ? `${source.description} (cloned)`
          : `Cloned from ${source.name}`,
        trainType: body.trainType ?? source.trainType,
        wagons: source.wagons,
        totalSeats: source.totalSeats,
        firstClassSeats: source.firstClassSeats,
        secondClassSeats: source.secondClassSeats,
        totalWagons: source.totalWagons,
        isDefault: false,
        active: true,
      });

      this.log.info("Seat layout cloned", {
        sourceId: params.id,
        newId: layout.id,
      });

      return layout;
    },
  });
}
