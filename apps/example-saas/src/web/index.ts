import { $module } from "alepha";
import { BookingService } from "../api/services/BookingService.ts";
import { AdminAppRouter } from "./AdminAppRouter.ts";
import { AppRouter } from "./AppRouter.ts";

export * from "./AppRouter.ts";
export * from "./atoms/bookingAtom.ts";

export const ExampleSaasWeb = $module({
  name: "example-saas.web",
  services: [AppRouter, AdminAppRouter, BookingService],
});
