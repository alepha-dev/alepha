import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

// How the product can be sold
export type ProductSellType =
  | "standalone" // Sold independently at stations/online
  | "with_booking" // Only available as booking add-on
  | "both"; // Available both ways

// Product categories
export type ProductCategory =
  | "food_beverage" // Snacks, drinks, meals
  | "comfort" // Blankets, pillows, amenity kits
  | "entertainment" // Magazines, headphones, games
  | "travel_accessories" // Luggage tags, travel adapters
  | "merchandise" // Branded items, souvenirs
  | "insurance" // Travel insurance add-ons
  | "services"; // Priority boarding, lounge access

export const products = $entity({
  name: "products",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Basic info
    name: t.text({ title: "Product Name" }),
    description: t.optional(t.text({ title: "Description", size: "long" })),
    sku: t.text({ title: "SKU" }), // Stock Keeping Unit

    // Pricing
    price: t.number({ title: "Price", minimum: 0 }),
    currency: pg.default(t.text({ title: "Currency" }), "EUR"),

    // Categorization
    category: pg.enum([
      "food_beverage",
      "comfort",
      "entertainment",
      "travel_accessories",
      "merchandise",
      "insurance",
      "services",
    ] as const),

    // How it can be sold
    sellType: pg.default(
      pg.enum(["standalone", "with_booking", "both"] as const),
      "both",
    ),

    // Image (optional, references files table from api-files)
    imageId: t.optional(t.uuid({ title: "Product Image" })),

    // Inventory
    stock: t.optional(t.integer({ title: "Stock Quantity", minimum: 0 })),
    trackStock: pg.default(t.boolean({ title: "Track Stock" }), false),

    // Availability
    active: pg.default(t.boolean({ title: "Active" }), true),

    // Restrictions
    minQuantity: pg.default(t.integer({ title: "Minimum Quantity" }), 1),
    maxQuantity: t.optional(t.integer({ title: "Maximum Quantity per Order" })),

    // Applicable fare classes (null = all)
    applicableFareClasses: t.optional(t.array(t.uuid())),

    // Tax configuration
    taxRate: t.optional(
      t.number({ title: "Tax Rate %", minimum: 0, maximum: 100 }),
    ),

    // Metadata
    tags: t.optional(t.array(t.text())),
    sortOrder: pg.default(t.integer({ title: "Sort Order" }), 0),
  }),
  indexes: [
    { columns: ["sku"], unique: true },
    { columns: ["category"] },
    { columns: ["sellType"] },
    { columns: ["active"] },
    { columns: ["category", "active"] },
    { columns: ["imageId"] },
  ],
});

export type Product = Static<typeof products.schema>;
