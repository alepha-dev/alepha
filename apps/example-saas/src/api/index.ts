import { AlephaDevtools } from "@alepha/devtools";
import { $module } from "alepha";
import { AppSecurity } from "./AppSecurity.ts";
import { SaasAgents } from "./agents/index.ts";
import { SaasAudits } from "./audits/index.ts";
import { SaasBookings } from "./bookings/index.ts";
import { SaasCustomers } from "./customers/index.ts";
import { SaasDevices } from "./devices/index.ts";
import { SaasInventory } from "./inventory/index.ts";
import { SaasIssues } from "./issues/index.ts";
import { SaasOrders } from "./orders/index.ts";
import { SaasPayments } from "./payments/index.ts";
import { SaasPricing } from "./pricing/index.ts";
import { SaasProducts } from "./products/index.ts";
import { SaasReporting } from "./reporting/index.ts";
import { SaasSystem } from "./system/index.ts";
import { SaasTopology } from "./topology/index.ts";
import { SaasVehicles } from "./vehicles/index.ts";

export * from "./agents/entities/agentProfiles.ts";
// Re-export entities for convenience
export * from "./bookings/entities/bookings.ts";
// Re-export schemas
export * from "./bookings/schemas/passengerSchema.ts";
// Re-export services
export * from "./customers/entities/customers.ts";
export * from "./customers/entities/vouchers.ts";
export * from "./devices/entities/devices.ts";
export * from "./inventory/entities/fareClasses.ts";
export * from "./inventory/entities/seatReservations.ts";
export * from "./inventory/entities/tripInstances.ts";
export * from "./inventory/schemas/seatResourceSchema.ts";
export * from "./inventory/schemas/seatSchema.ts";
export { InventoryService } from "./inventory/services/InventoryService.ts";
export * from "./issues/entities/issues.ts";
export * from "./orders/entities/productOrders.ts";
export * from "./payments/entities/payments.ts";
export * from "./pricing/entities/priceRules.ts";
export * from "./pricing/schemas/fareClassResourceSchema.ts";
export { PricingService } from "./pricing/services/PricingService.ts";
export * from "./products/entities/products.ts";
export * from "./topology/entities/stations.ts";
export * from "./topology/entities/trips.ts";
export * from "./topology/schemas/searchQuerySchema.ts";
export * from "./topology/schemas/stationSchema.ts";
export * from "./topology/schemas/tripSchema.ts";
export * from "./vehicles/entities/seatLayouts.ts";

export const SaasApi = $module({
  name: "saas.api",
  services: [
    AlephaDevtools,
    AppSecurity,
    SaasAudits,
    SaasTopology,
    SaasVehicles,
    SaasInventory,
    SaasIssues,
    SaasPricing,
    SaasBookings,
    SaasPayments,
    SaasProducts,
    SaasOrders,
    SaasCustomers,
    SaasAgents,
    SaasDevices,
    SaasReporting,
    SaasSystem,
  ],
});
