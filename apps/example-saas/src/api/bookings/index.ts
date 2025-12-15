import { $module } from "alepha";
import { BookingController } from "./controllers/BookingController.ts";
import { BookingNotifications } from "./notifications/BookingNotifications.ts";

export const SaasBookings = $module({
  name: "saas.api.bookings",
  services: [BookingController, BookingNotifications],
});
