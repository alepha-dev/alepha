import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

// Order item schema (embedded in order as JSONB array)
export const orderItemSchema = t.object({
  productId: t.uuid(),
  productName: t.text(), // Snapshot at time of purchase
  productSku: t.text(), // Snapshot at time of purchase
  category: t.text(), // Snapshot
  quantity: t.integer({ minimum: 1 }),
  unitPrice: t.number({ minimum: 0 }),
  taxRate: t.number({ minimum: 0, maximum: 100 }),
  subtotal: t.number({ minimum: 0 }),
  taxAmount: t.number({ minimum: 0 }),
  total: t.number({ minimum: 0 }),
  status: t.enum(["pending", "fulfilled", "cancelled"]),
  fulfilledAt: t.optional(t.datetime()),
});

export type OrderItem = Static<typeof orderItemSchema>;

// Order channels
export type OrderChannel = "web" | "mobile" | "station" | "onboard" | "agent";

// Order statuses
export type OrderStatus =
  | "pending" // Order created, awaiting payment
  | "confirmed" // Payment received
  | "processing" // Being prepared
  | "fulfilled" // All items delivered
  | "partially_fulfilled" // Some items delivered
  | "cancelled" // Order cancelled
  | "refunded"; // Payment refunded

export const productOrders = $entity({
  name: "product_orders",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Order identification
    orderNumber: t.text({ title: "Order Number" }), // e.g., "ORD-2025-001234"

    // Customer (optional for guest purchases)
    customerId: t.optional(t.uuid({ title: "Customer" })),
    customerEmail: t.optional(t.email({ title: "Customer Email" })),
    customerName: t.optional(t.text({ title: "Customer Name" })),

    // Booking link (for add-ons only)
    bookingId: t.optional(t.uuid({ title: "Booking" })),

    // Channel and type
    channel: pg.enum(["web", "mobile", "station", "onboard", "agent"] as const),
    isBookingAddOn: pg.default(
      t.boolean({ title: "Is Booking Add-on" }),
      false,
    ),

    // Status
    status: pg.default(
      pg.enum([
        "pending",
        "confirmed",
        "processing",
        "fulfilled",
        "partially_fulfilled",
        "cancelled",
        "refunded",
      ] as const),
      "pending",
    ),

    // Order items (embedded JSONB)
    items: t.array(orderItemSchema),
    itemCount: pg.default(t.integer({ title: "Item Count" }), 0),

    // Totals
    subtotal: t.number({ title: "Subtotal", minimum: 0 }),
    taxAmount: t.number({ title: "Tax Amount", minimum: 0 }),
    discountAmount: pg.default(
      t.number({ title: "Discount Amount", minimum: 0 }),
      0,
    ),
    total: t.number({ title: "Total", minimum: 0 }),
    currency: pg.default(t.text({ title: "Currency" }), "EUR"),

    // Voucher/discount
    voucherCode: t.optional(t.text({ title: "Voucher Code" })),
    voucherId: t.optional(t.uuid({ title: "Voucher" })),

    // Payment
    paymentId: t.optional(t.uuid({ title: "Payment" })),
    paymentMethod: t.optional(
      pg.enum(["card", "cash", "voucher", "invoice"] as const),
    ),
    paymentStatus: pg.default(
      pg.enum(["pending", "paid", "failed", "refunded"] as const),
      "pending",
    ),
    paidAt: t.optional(t.datetime({ title: "Paid At" })),

    // Fulfillment
    fulfilledAt: t.optional(t.datetime({ title: "Fulfilled At" })),
    fulfilledBy: t.optional(t.uuid({ title: "Fulfilled By" })), // Agent ID

    // Delivery details (for physical products)
    deliveryMethod: t.optional(
      pg.enum(["pickup", "seat_delivery", "lounge", "station"] as const),
    ),
    deliveryLocation: t.optional(t.text({ title: "Delivery Location" })),
    deliveryNotes: t.optional(t.text({ title: "Delivery Notes" })),

    // Notes
    notes: t.optional(t.text({ title: "Notes", size: "long" })),
    internalNotes: t.optional(
      t.text({ title: "Internal Notes", size: "long" }),
    ),

    // Cancellation/refund
    cancelledAt: t.optional(t.datetime({ title: "Cancelled At" })),
    cancelledBy: t.optional(t.uuid({ title: "Cancelled By" })),
    cancellationReason: t.optional(t.text({ title: "Cancellation Reason" })),
    refundedAt: t.optional(t.datetime({ title: "Refunded At" })),
    refundAmount: t.optional(t.number({ title: "Refund Amount", minimum: 0 })),
  }),
  indexes: [
    { columns: ["orderNumber"], unique: true },
    { columns: ["customerId"] },
    { columns: ["bookingId"] },
    { columns: ["status"] },
    { columns: ["channel"] },
    { columns: ["paymentStatus"] },
    { columns: ["isBookingAddOn"] },
    { columns: ["createdAt"] },
    { columns: ["status", "createdAt"] },
  ],
});

export type ProductOrder = Static<typeof productOrders.schema>;
