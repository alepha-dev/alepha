import { $page } from "@alepha/react";
import { MainRouter } from "@alepha/ui/admin";
import { IconTrain } from "@tabler/icons-react";
import { $inject } from "alepha";
import { BookingService } from "./services/BookingService.ts";

export class AppRouter extends MainRouter {
  // ─────────────────────────────────────────────────────────────────────────────
  // Train Booking System
  // ─────────────────────────────────────────────────────────────────────────────
  srv = $inject(BookingService);

  bookingLayout = $page({
    icon: IconTrain,
    parent: this.layout,
    label: "Book Train",
    lazy: () => import("./components/booking/BookingLayout.tsx"),
    children: () => [
      this.bookingSearch,
      this.bookingResults,
      this.bookingSeats,
      this.bookingPayment,
      this.bookingConfirmation,
    ],
  });

  bookingSearch = $page({
    path: "/",
    lazy: () => import("./components/booking/TripSearch.tsx"),
  });

  bookingResults = $page({
    path: "/results",
    lazy: () => import("./components/booking/TripResults.tsx"),
  });

  bookingSeats = $page({
    path: "/seats",
    lazy: () => import("./components/booking/SeatSelection.tsx"),
  });

  bookingPayment = $page({
    path: "/payment",
    lazy: () => import("./components/booking/Payment.tsx"),
  });

  bookingConfirmation = $page({
    path: "/confirmation",
    lazy: () => import("./components/booking/Confirmation.tsx"),
  });
}
