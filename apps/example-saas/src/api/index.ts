import { $module } from "alepha";
import { AppSecurity } from "./AppSecurity.ts";
import { AdminController } from "./controllers/AdminController.ts";
import { BookingController } from "./controllers/BookingController.ts";
import { PaymentController } from "./controllers/PaymentController.ts";
import { StationController } from "./controllers/StationController.ts";
import { TripController } from "./controllers/TripController.ts";
import { Db } from "./providers/Db.ts";
import { BookingService } from "./services/BookingService.ts";

export const ExampleSaasApi = $module({
  name: "example-saas.api",
  services: [
    AppSecurity,
    Db,
    BookingService,
    StationController,
    TripController,
    BookingController,
    AdminController,
    PaymentController,
  ],
});

export * from "./controllers/AdminController.ts";
export * from "./controllers/BookingController.ts";
export * from "./controllers/StationController.ts";
export * from "./controllers/TripController.ts";
export * from "./entities/bookings.ts";
export * from "./entities/stations.ts";
export * from "./entities/trips.ts";
export * from "./providers/Db.ts";
export * from "./services/BookingService.ts";
