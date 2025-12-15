import { $module } from "alepha";
import { $audit } from "alepha/api/audits";

/**
 * Booking audit events.
 */
export class BookingAudits {
  audit = $audit({
    type: "booking",
    description: "Train booking lifecycle events",
    actions: ["create", "update", "cancel", "confirm"],
  });
}

/**
 * Payment audit events.
 */
export class PaymentAudits {
  audit = $audit({
    type: "payment",
    description: "Payment processing events",
    actions: ["create", "complete", "fail", "refund", "dispute"],
  });
}

/**
 * Customer audit events.
 */
export class CustomerAudits {
  audit = $audit({
    type: "customer",
    description: "Customer management events",
    actions: ["create", "update", "delete", "loyalty_change"],
  });
}

/**
 * Agent (staff) audit events.
 */
export class AgentAudits {
  audit = $audit({
    type: "agent",
    description: "Agent/staff management events",
    actions: [
      "create",
      "update",
      "delete",
      "role_change",
      "activate",
      "deactivate",
    ],
  });
}

/**
 * Inventory audit events.
 */
export class InventoryAudits {
  audit = $audit({
    type: "inventory",
    description: "Seat inventory and pricing events",
    actions: ["reserve", "release", "book", "price_change", "quota_change"],
  });
}

/**
 * Product audit events.
 */
export class ProductAudits {
  audit = $audit({
    type: "product",
    description: "Product catalog management events",
    actions: ["create", "update", "delete", "activate", "deactivate"],
  });
}

/**
 * Product order audit events.
 */
export class ProductOrderAudits {
  audit = $audit({
    type: "product_order",
    description: "Product order lifecycle events",
    actions: [
      "create",
      "status_change",
      "payment",
      "fulfill",
      "cancel",
      "refund",
    ],
  });
}

/**
 * System audit events (seeds, configuration).
 */
export class SystemAudits {
  audit = $audit({
    type: "system",
    description: "System administration events",
    actions: ["seed", "config_change", "maintenance"],
  });
}

export const SaasAudits = $module({
  name: "saas.audits",
  services: [
    BookingAudits,
    PaymentAudits,
    CustomerAudits,
    AgentAudits,
    InventoryAudits,
    ProductAudits,
    ProductOrderAudits,
    SystemAudits,
  ],
});
