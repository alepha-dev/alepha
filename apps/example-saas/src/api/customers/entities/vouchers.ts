import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

// Voucher discount types
export type VoucherType =
  | "percentage" // X% off
  | "fixed_amount" // $X off
  | "free_upgrade" // Free seat class upgrade
  | "free_seat_selection" // Free premium seat selection
  | "points_multiplier"; // 2x, 3x loyalty points

// How the voucher was obtained
export type VoucherSource =
  | "welcome" // New customer welcome bonus
  | "loyalty" // Earned through loyalty program
  | "promotion" // Marketing campaign
  | "compensation" // Service recovery / apology
  | "referral" // Referred a friend
  | "birthday" // Birthday gift
  | "gift" // Gifted by another customer
  | "partner"; // Partner company promotion

// Voucher status
export type VoucherStatus =
  | "active" // Can be used
  | "used" // Already redeemed
  | "expired" // Past validity date
  | "revoked"; // Manually cancelled

export const vouchers = $entity({
  name: "vouchers",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Owner (optional - null means it can be claimed by anyone with the code)
    customerId: t.optional(t.uuid()),

    // Voucher identification
    code: t.text(), // Unique redemption code (e.g., "WELCOME20", "VEC-ABC123")
    name: t.text(), // Display name (e.g., "20% Welcome Discount")
    description: t.optional(t.text()),

    // Discount configuration
    type: pg.enum([
      "percentage",
      "fixed_amount",
      "free_upgrade",
      "free_seat_selection",
      "points_multiplier",
    ]),
    value: t.number(), // Percentage (0-100) or fixed amount or multiplier
    currency: t.optional(t.text()), // For fixed_amount type (ISO 4217)

    // Constraints
    minPurchase: t.optional(t.number()), // Minimum order value to use
    maxDiscount: t.optional(t.number()), // Cap for percentage discounts
    applicableRoutes: t.optional(t.array(t.text())), // Specific routes only
    applicableClasses: t.optional(t.array(t.enum(["first", "second"]))),
    applicableFareClasses: t.optional(t.array(t.uuid())), // Specific fare classes
    excludeWeekends: pg.default(t.boolean(), false),
    excludePeakHours: pg.default(t.boolean(), false),

    // Validity period
    validFrom: t.datetime(),
    validUntil: t.datetime(),

    // Usage limits
    maxUses: pg.default(t.integer(), 1), // Total uses allowed (1 for personal vouchers)
    currentUses: pg.default(t.integer(), 0), // Times used

    // Status and tracking
    status: pg.default(
      pg.enum(["active", "used", "expired", "revoked"]),
      "active",
    ),
    source: pg.enum([
      "welcome",
      "loyalty",
      "promotion",
      "compensation",
      "referral",
      "birthday",
      "gift",
      "partner",
    ]),

    // Usage tracking (for single-use vouchers)
    usedAt: t.optional(t.datetime()),
    usedOnBookingId: t.optional(t.uuid()),

    // Metadata
    campaignId: t.optional(t.text()), // For tracking marketing campaigns
    notes: t.optional(t.text()), // Internal notes
  }),
  indexes: [
    { columns: ["code"], unique: true },
    { columns: ["customerId"] },
    { columns: ["customerId", "status"] },
    { columns: ["status", "validUntil"] },
    { columns: ["campaignId"] },
  ],
});

export type Voucher = Static<typeof vouchers.schema>;
