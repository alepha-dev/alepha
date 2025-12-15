import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

// Loyalty tiers with increasing benefits
export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

// Gender options
export type Gender = "male" | "female" | "other" | "prefer_not_to_say";

/**
 * Customer address schema (stored as JSONB array).
 */
export const customerAddressSchema = t.object({
  id: t.uuid(), // For referencing specific addresses
  type: t.enum(["billing", "home", "work", "other"]),
  label: t.optional(t.text()), // Custom name like "Parents' house"

  // Recipient (can differ from customer)
  firstName: t.optional(t.text()),
  lastName: t.optional(t.text()),
  company: t.optional(t.text()),

  // Address
  street: t.text(),
  street2: t.optional(t.text()),
  city: t.text(),
  state: t.optional(t.text()),
  postalCode: t.text(),
  country: t.text(), // ISO 3166-1 alpha-2

  // Contact
  phone: t.optional(t.text()),

  // Defaults
  isDefaultBilling: t.optional(t.boolean()),
  isDefaultShipping: t.optional(t.boolean()),
});

export type CustomerAddress = Static<typeof customerAddressSchema>;

/**
 * Saved passenger schema (stored as JSONB array).
 */
export const customerPassengerSchema = t.object({
  id: t.uuid(), // For referencing specific passengers
  label: t.optional(t.text()), // e.g., "Myself", "Partner", "Child 1"
  isDefault: t.optional(t.boolean()), // Primary passenger

  // Identity
  firstName: t.text(),
  lastName: t.text(),
  birthDate: t.optional(t.text()), // ISO date
  gender: t.optional(t.enum(["male", "female", "other", "prefer_not_to_say"])),
  nationality: t.optional(t.text()), // ISO 3166-1 alpha-2

  // Contact
  email: t.optional(t.text()),
  phone: t.optional(t.text()),

  // Travel document
  documentType: t.optional(
    t.enum(["passport", "national_id", "drivers_license", "residence_permit"]),
  ),
  documentNumber: t.optional(t.text()),
  documentCountry: t.optional(t.text()),
  documentExpiry: t.optional(t.text()), // ISO date

  // Preferences
  preferredSeatPosition: t.optional(t.enum(["window", "aisle", "any"])),

  // Special requirements
  wheelchairAssistance: t.optional(t.boolean()),
  specialMeals: t.optional(t.text()),
  otherRequirements: t.optional(t.text()),
});

export type CustomerPassenger = Static<typeof customerPassengerSchema>;

export const customers = $entity({
  name: "customers",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Link to user account (one customer per user)
    userId: t.uuid(),

    // Profile information (all optional - can be filled progressively)
    firstName: t.optional(t.text()),
    lastName: t.optional(t.text()),
    birthDate: t.optional(t.date()),
    gender: t.optional(
      t.enum(["male", "female", "other", "prefer_not_to_say"]),
    ),
    phone: t.optional(t.text()),
    nationality: t.optional(t.text()), // ISO 3166-1 alpha-2 country code

    // Preferences
    preferredLanguage: t.optional(t.text()), // ISO 639-1 language code
    preferredCurrency: t.optional(t.text()), // ISO 4217 currency code
    preferredSeatPosition: t.optional(t.enum(["window", "aisle", "any"])),
    preferredClass: t.optional(t.enum(["first", "second", "any"])),

    // Communication preferences
    marketingEmails: pg.default(t.boolean(), false),
    marketingSms: pg.default(t.boolean(), false),
    tripReminders: pg.default(t.boolean(), true),

    // Loyalty program
    loyaltyTier: pg.default(
      t.enum(["bronze", "silver", "gold", "platinum"]),
      "bronze",
    ),
    loyaltyPoints: pg.default(t.integer(), 0), // Current available points
    loyaltyPointsLifetime: pg.default(t.integer(), 0), // Total earned (for tier calc)
    loyaltyJoinedAt: t.optional(t.datetime()), // When they joined the program
    loyaltyNumber: t.optional(t.text()), // Loyalty card number (e.g., "VEC-123456")

    // Statistics (denormalized for quick access)
    totalBookings: pg.default(t.integer(), 0),
    totalSpent: pg.default(t.number(), 0), // In base currency
    lastBookingAt: t.optional(t.datetime()),

    // Embedded data (JSONB)
    addresses: pg.default(t.array(customerAddressSchema), []),
    passengers: pg.default(t.array(customerPassengerSchema), []),
  }),
  indexes: [
    { columns: ["userId"], unique: true },
    { columns: ["loyaltyNumber"], unique: true },
    { columns: ["loyaltyTier"] },
    { columns: ["phone"] },
  ],
});

export type Customer = Static<typeof customers.schema>;
