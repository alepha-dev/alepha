import { $page } from "@alepha/react";
import {
  IconArmchair,
  IconCheck,
  IconCreditCard,
  IconListSearch,
  IconSearch,
  IconTrain,
} from "@tabler/icons-react";
import { t } from "alepha";
import { $client } from "alepha/server/links";
import type { StationController } from "../api/controllers/StationController.ts";
import type { TripController } from "../api/controllers/TripController.ts";

export class AppRouter {
  protected readonly stationController = $client<StationController>();
  protected readonly tripController = $client<TripController>();

  bookingLayout = $page({
    icon: IconTrain,
    label: "Book Train",
    description: "Book your train journey across regions.",
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
    icon: IconSearch,
    path: "/",
    label: "Search",
    description: "Search for available train routes and schedules.",
    lazy: () => import("./components/booking/TripSearch.tsx"),
    resolve: async () => {
      const [stations, popularRoutes] = await Promise.all([
        this.stationController.getStations({}),
        this.tripController.getPopularRoutes({}),
      ]);
      return { stations, popularRoutes };
    },
  });

  bookingResults = $page({
    icon: IconListSearch,
    path: "/results",
    label: "Results",
    description: "View available trains for your selected route.",
    schema: {
      query: t.object({
        from: t.text(),
        to: t.text(),
        date: t.text(),
        passengers: t.text(),
      }),
    },
    lazy: () => import("./components/booking/TripResults.tsx"),
    resolve: async ({ query }) => {
      const trips = await this.tripController.searchTrips({ query });
      return {
        trips,
        search: {
          from: query.from,
          to: query.to,
          date: query.date,
          passengers: Number.parseInt(query.passengers, 10),
        },
      };
    },
  });

  bookingSeats = $page({
    icon: IconArmchair,
    path: "/seats",
    label: "Seats",
    description: "Choose your preferred seats for the journey.",
    lazy: () => import("./components/booking/SeatSelection.tsx"),
  });

  bookingPayment = $page({
    icon: IconCreditCard,
    path: "/payment",
    label: "Payment",
    description: "Enter passenger details and complete payment.",
    lazy: () => import("./components/booking/Payment.tsx"),
  });

  bookingConfirmation = $page({
    icon: IconCheck,
    path: "/confirmation",
    label: "Confirmation",
    description: "View your booking confirmation and details.",
    lazy: () => import("./components/booking/Confirmation.tsx"),
  });
}
