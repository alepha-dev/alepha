import { $inject, type Page, t } from "alepha";
import { UserService } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import {
  type Customer,
  type CustomerAddress,
  type CustomerPassenger,
  customers,
} from "../entities/customers.ts";
import { type Voucher, vouchers } from "../entities/vouchers.ts";

export class CustomerController {
  protected readonly log = $logger();
  protected readonly customers = $repository(customers);
  protected readonly vouchers = $repository(vouchers);
  protected readonly userService = $inject(UserService);

  // ─────────────────────────────────────────────────────────────────────────────
  // Customers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all customers with pagination and filtering.
   * GET /admin/customers
   */
  findCustomers = $action({
    path: "/admin/customers",
    secure: false,
    description: "Find all customers with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        loyaltyTier: t.optional(
          t.enum(["bronze", "silver", "gold", "platinum"]),
        ),
      }),
      response: t.page(customers.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.loyaltyTier) {
        where.loyaltyTier = { eq: query.loyaltyTier };
      }

      if (query.query) {
        where.or = [
          { firstName: { ilike: `%${query.query}%` } },
          { lastName: { ilike: `%${query.query}%` } },
          { phone: { ilike: `%${query.query}%` } },
          { loyaltyNumber: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.customers.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "loyaltyTier", direction: "desc" },
            { column: "totalSpent", direction: "desc" },
          ],
        },
      );

      return result as Page<Customer>;
    },
  });

  /**
   * Get a single customer by ID.
   * GET /admin/customers/:id
   */
  getCustomer = $action({
    path: "/admin/customers/:id",
    secure: false,
    description: "Get a customer by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: customers.schema,
    },
    handler: async ({ params }) => {
      return await this.customers.findById(params.id);
    },
  });

  /**
   * Create a new customer.
   * Automatically creates a user account and links it to the customer.
   * POST /admin/customers
   */
  createCustomer = $action({
    method: "POST",
    path: "/admin/customers",
    secure: false,
    description: "Create a new customer with auto-created user account",
    schema: {
      body: t.object({
        email: t.string({ format: "email" }),
        firstName: t.optional(t.text()),
        lastName: t.optional(t.text()),
        phone: t.optional(t.text()),
        birthDate: t.optional(t.date()),
        gender: t.optional(
          t.enum(["male", "female", "other", "prefer_not_to_say"]),
        ),
        nationality: t.optional(t.text()),
        preferredLanguage: t.optional(t.text()),
        preferredCurrency: t.optional(t.text()),
        preferredSeatPosition: t.optional(t.enum(["window", "aisle", "any"])),
        preferredClass: t.optional(t.enum(["first", "second", "any"])),
        marketingEmails: t.optional(t.boolean()),
        marketingSms: t.optional(t.boolean()),
        tripReminders: t.optional(t.boolean()),
      }),
      response: customers.schema,
    },
    handler: async ({ body }) => {
      const { email, firstName, lastName, phone, ...customerData } = body;

      this.log.info("Creating user for customer", {
        email,
        name: `${firstName || ""} ${lastName || ""}`.trim(),
      });

      // Create user account
      const user = await this.userService.createUser({
        email,
        firstName,
        lastName,
        phoneNumber: phone,
        enabled: true,
      });

      this.log.info("User created", { userId: user.id, email: user.email });

      // Create customer linked to user
      const customer = await this.customers.create({
        ...customerData,
        userId: user.id,
        firstName,
        lastName,
        phone,
        loyaltyTier: "bronze",
        loyaltyPoints: 0,
        loyaltyPointsLifetime: 0,
        totalBookings: 0,
        totalSpent: 0,
      });

      this.log.info("Customer created", {
        id: customer.id,
        userId: user.id,
      });

      return customer;
    },
  });

  /**
   * Update a customer.
   * PATCH /admin/customers/:id
   */
  updateCustomer = $action({
    method: "PATCH",
    path: "/admin/customers/:id",
    secure: false,
    description: "Update a customer",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        firstName: t.optional(t.text()),
        lastName: t.optional(t.text()),
        phone: t.optional(t.text()),
        birthDate: t.optional(t.date()),
        gender: t.optional(
          t.enum(["male", "female", "other", "prefer_not_to_say"]),
        ),
        nationality: t.optional(t.text()),
        loyaltyTier: t.optional(
          t.enum(["bronze", "silver", "gold", "platinum"]),
        ),
        loyaltyPoints: t.optional(t.integer()),
        marketingEmails: t.optional(t.boolean()),
        marketingSms: t.optional(t.boolean()),
        tripReminders: t.optional(t.boolean()),
      }),
      response: customers.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating customer", { id: params.id });

      const customer = await this.customers.updateById(params.id, body);

      this.log.info("Customer updated", { id: customer.id });

      return customer;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Customer Passengers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get passengers for a customer.
   * GET /admin/customers/:customerId/passengers
   */
  getCustomerPassengers = $action({
    path: "/admin/customers/:customerId/passengers",
    secure: false,
    description: "Get saved passengers for a customer",
    schema: {
      params: t.object({ customerId: t.uuid() }),
      response: t.array(t.any()),
    },
    handler: async ({ params }) => {
      const customer = await this.customers.findById(params.customerId);

      // Sort embedded passengers: default first, then by label
      const passengers = [...customer.passengers].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return (a.label ?? "").localeCompare(b.label ?? "");
      });

      return passengers as CustomerPassenger[];
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Customer Addresses
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get addresses for a customer.
   * GET /admin/customers/:customerId/addresses
   */
  getCustomerAddresses = $action({
    path: "/admin/customers/:customerId/addresses",
    secure: false,
    description: "Get saved addresses for a customer",
    schema: {
      params: t.object({ customerId: t.uuid() }),
      response: t.array(t.any()),
    },
    handler: async ({ params }) => {
      const customer = await this.customers.findById(params.customerId);

      // Sort embedded addresses: default billing first, then by type
      const addresses = [...customer.addresses].sort((a, b) => {
        if (a.isDefaultBilling && !b.isDefaultBilling) return -1;
        if (!a.isDefaultBilling && b.isDefaultBilling) return 1;
        return a.type.localeCompare(b.type);
      });

      return addresses as CustomerAddress[];
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Customer Vouchers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get vouchers for a customer.
   * GET /admin/customers/:customerId/vouchers
   */
  getCustomerVouchers = $action({
    path: "/admin/customers/:customerId/vouchers",
    secure: false,
    description: "Get vouchers for a customer",
    schema: {
      params: t.object({ customerId: t.uuid() }),
      response: t.array(t.any()),
    },
    handler: async ({ params }) => {
      const customerVouchers = await this.vouchers.findMany({
        where: { customerId: { eq: params.customerId } },
        orderBy: [
          { column: "status", direction: "asc" },
          { column: "validUntil", direction: "asc" },
        ],
      });

      return customerVouchers as Voucher[];
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Vouchers (Global)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all vouchers with pagination and filtering.
   * GET /admin/vouchers
   */
  findVouchers = $action({
    path: "/admin/vouchers",
    secure: false,
    description: "Find all vouchers with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        status: t.optional(t.enum(["active", "used", "expired", "revoked"])),
        type: t.optional(
          t.enum([
            "percentage",
            "fixed_amount",
            "free_upgrade",
            "free_seat_selection",
            "points_multiplier",
          ]),
        ),
        source: t.optional(
          t.enum([
            "welcome",
            "loyalty",
            "promotion",
            "compensation",
            "referral",
            "birthday",
            "gift",
            "partner",
          ]),
        ),
      }),
      response: t.page(vouchers.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.status) {
        where.status = { eq: query.status };
      }

      if (query.type) {
        where.type = { eq: query.type };
      }

      if (query.source) {
        where.source = { eq: query.source };
      }

      if (query.query) {
        where.or = [
          { code: { ilike: `%${query.query}%` } },
          { name: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.vouchers.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "status", direction: "asc" },
            { column: "createdAt", direction: "desc" },
          ],
        },
      );

      return result as Page<Voucher>;
    },
  });

  /**
   * Create a new voucher.
   * POST /admin/vouchers
   */
  createVoucher = $action({
    method: "POST",
    path: "/admin/vouchers",
    secure: false,
    description: "Create a new voucher",
    schema: {
      body: t.object({
        customerId: t.optional(t.uuid()),
        code: t.text(),
        name: t.text(),
        description: t.optional(t.text()),
        type: t.enum([
          "percentage",
          "fixed_amount",
          "free_upgrade",
          "free_seat_selection",
          "points_multiplier",
        ]),
        value: t.number(),
        currency: t.optional(t.text()),
        minPurchase: t.optional(t.number()),
        maxDiscount: t.optional(t.number()),
        validFrom: t.datetime(),
        validUntil: t.datetime(),
        maxUses: t.optional(t.integer()),
        source: t.enum([
          "welcome",
          "loyalty",
          "promotion",
          "compensation",
          "referral",
          "birthday",
          "gift",
          "partner",
        ]),
        campaignId: t.optional(t.text()),
      }),
      response: vouchers.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating voucher", { code: body.code, name: body.name });

      const voucher = await this.vouchers.create({
        ...body,
        maxUses: body.maxUses ?? 1,
        status: "active",
        currentUses: 0,
      });

      this.log.info("Voucher created", { id: voucher.id, code: voucher.code });

      return voucher;
    },
  });

  /**
   * Revoke a voucher.
   * POST /admin/vouchers/:id/revoke
   */
  revokeVoucher = $action({
    method: "POST",
    path: "/admin/vouchers/:id/revoke",
    secure: false,
    description: "Revoke a voucher",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      this.log.info("Revoking voucher", { id: params.id });

      await this.vouchers.updateById(params.id, { status: "revoked" });

      return { ok: true };
    },
  });
}
