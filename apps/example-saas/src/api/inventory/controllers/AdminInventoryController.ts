import { type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import {
  type PriceRule,
  priceRules,
} from "../../pricing/entities/priceRules.ts";
import { type FareClass, fareClasses } from "../entities/fareClasses.ts";
import type { TripInstance } from "../entities/tripInstances.ts";
import { tripInstances } from "../entities/tripInstances.ts";

export class AdminInventoryController {
  protected readonly log = $logger();
  protected readonly tripInstances = $repository(tripInstances);
  protected readonly fareClasses = $repository(fareClasses);
  protected readonly priceRules = $repository(priceRules);

  // ─────────────────────────────────────────────────────────────────────────────
  // Trip Instances
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all trip instances with pagination and filtering.
   * GET /admin/inventory/instances
   */
  findTripInstances = $action({
    path: "/admin/inventory/instances",
    secure: false,
    description: "Find all trip instances with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        status: t.optional(
          t.enum([
            "scheduled",
            "boarding",
            "departed",
            "completed",
            "cancelled",
          ]),
        ),
        date: t.optional(t.text()),
      }),
      response: t.page(
        t.object({
          id: t.uuid(),
          tripId: t.uuid(),
          travelDate: t.text(),
          availableFirstClass: t.integer(),
          availableSecondClass: t.integer(),
          totalSeats: t.integer(),
          currentPriceMultiplier: t.number(),
          status: t.text(),
          createdAt: t.datetime(),
          updatedAt: t.datetime(),
        }),
      ),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.status) {
        where.status = { eq: query.status };
      }

      if (query.date) {
        where.travelDate = { eq: query.date };
      }

      const result = await this.tripInstances.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "updatedAt", direction: "desc" },
            // { column: "travelDate", direction: "desc" },
            // { column: "createdAt", direction: "desc" },
          ],
        },
        {
          count: true,
        },
      );

      return result as Page<TripInstance>;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Fare Classes
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all fare classes with pagination and filtering.
   * GET /admin/inventory/fare-classes
   */
  findFareClasses = $action({
    path: "/admin/inventory/fare-classes",
    secure: false,
    description: "Find all fare classes with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        active: t.optional(t.boolean()),
      }),
      response: t.page(
        t.object({
          id: t.uuid(),
          code: t.text(),
          name: t.text(),
          description: t.text(),
          priceMultiplier: t.number(),
          isRefundable: t.boolean(),
          isChangeable: t.boolean(),
          changeFeePercent: t.number(),
          refundFeePercent: t.number(),
          minDaysBeforeDeparture: t.integer(),
          sortOrder: t.integer(),
          active: t.boolean(),
          createdAt: t.datetime(),
          updatedAt: t.datetime(),
        }),
      ),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.active !== undefined) {
        where.active = { eq: query.active };
      }

      if (query.query) {
        where.or = [
          { code: { ilike: `%${query.query}%` } },
          { name: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.fareClasses.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: { column: "sortOrder", direction: "asc" },
        },
      );

      return result as Page<FareClass>;
    },
  });

  /**
   * Create a new fare class.
   * POST /admin/inventory/fare-classes
   */
  createFareClass = $action({
    method: "POST",
    path: "/admin/inventory/fare-classes",
    secure: false,
    description: "Create a new fare class",
    schema: {
      body: t.object({
        code: t.text(),
        name: t.text(),
        description: t.text(),
        priceMultiplier: t.number(),
        isRefundable: t.boolean(),
        isChangeable: t.boolean(),
        changeFeePercent: t.optional(t.number()),
        refundFeePercent: t.optional(t.number()),
        minDaysBeforeDeparture: t.optional(t.integer()),
        sortOrder: t.optional(t.integer()),
      }),
      response: fareClasses.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating fare class", {
        code: body.code,
        name: body.name,
      });

      const fareClass = await this.fareClasses.create({
        ...body,
        changeFeePercent: body.changeFeePercent ?? 0,
        refundFeePercent: body.refundFeePercent ?? 0,
        minDaysBeforeDeparture: body.minDaysBeforeDeparture ?? 0,
        sortOrder: body.sortOrder ?? 100,
        active: true,
      });

      this.log.info("Fare class created", { id: fareClass.id });

      return fareClass;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Price Rules
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all price rules with pagination and filtering.
   * GET /admin/inventory/price-rules
   */
  findPriceRules = $action({
    path: "/admin/inventory/price-rules",
    secure: false,
    description: "Find all price rules with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        ruleType: t.optional(
          t.enum([
            "occupancy",
            "time_to_departure",
            "day_of_week",
            "peak_hours",
          ]),
        ),
        active: t.optional(t.boolean()),
      }),
      response: t.page(
        t.object({
          id: t.uuid(),
          name: t.text(),
          description: t.text(),
          ruleType: t.text(),
          config: t.object({
            thresholds: t.optional(
              t.array(
                t.object({
                  value: t.number(),
                  multiplier: t.number(),
                }),
              ),
            ),
            dayMultipliers: t.optional(t.record(t.string(), t.number())),
            hourMultipliers: t.optional(t.record(t.string(), t.number())),
          }),
          priority: t.integer(),
          active: t.boolean(),
          createdAt: t.datetime(),
          updatedAt: t.datetime(),
        }),
      ),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.active !== undefined) {
        where.active = { eq: query.active };
      }

      if (query.ruleType) {
        where.ruleType = { eq: query.ruleType };
      }

      if (query.query) {
        where.or = [
          { name: { ilike: `%${query.query}%` } },
          { description: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.priceRules.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: { column: "priority", direction: "asc" },
        },
      );

      return result as Page<PriceRule>;
    },
  });

  /**
   * Create a new price rule.
   * POST /admin/inventory/price-rules
   */
  createPriceRule = $action({
    method: "POST",
    path: "/admin/inventory/price-rules",
    secure: false,
    description: "Create a new price rule",
    schema: {
      body: t.object({
        name: t.text(),
        description: t.optional(t.text()),
        ruleType: t.enum([
          "occupancy",
          "time_to_departure",
          "day_of_week",
          "peak_hours",
        ]),
        config: t.object({
          thresholds: t.optional(
            t.array(
              t.object({
                value: t.number(),
                multiplier: t.number(),
              }),
            ),
          ),
          dayMultipliers: t.optional(t.record(t.string(), t.number())),
          hourMultipliers: t.optional(t.record(t.string(), t.number())),
        }),
        priority: t.optional(t.integer()),
      }),
      response: priceRules.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating price rule", {
        name: body.name,
        ruleType: body.ruleType,
      });

      const priceRule = await this.priceRules.create({
        ...body,
        description: body.description ?? "",
        priority: body.priority ?? 100,
        active: true,
      });

      this.log.info("Price rule created", { id: priceRule.id });

      return priceRule;
    },
  });
}
