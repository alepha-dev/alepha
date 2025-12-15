import { $module } from "alepha";
import { AdminInventoryController } from "./controllers/AdminInventoryController.ts";
import { InventoryController } from "./controllers/InventoryController.ts";
import { InventoryService } from "./services/InventoryService.ts";

export { InventoryService } from "./services/InventoryService.ts";

export const SaasInventory = $module({
  name: "saas.api.inventory",
  services: [InventoryService, InventoryController, AdminInventoryController],
});
