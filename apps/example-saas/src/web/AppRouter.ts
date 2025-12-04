import { $page } from "@alepha/react";
import { AdminSidebar, MainRouter } from "@alepha/ui/admin";
import {
  IconArmchair,
  IconCheck,
  IconCreditCard,
  IconDatabase,
  IconListSearch,
  IconSearch,
  IconTicket,
  IconTrain,
  IconUser,
} from "@tabler/icons-react";
import { $inject, t } from "alepha";
import { $client } from "alepha/server/links";
import type { AdminController } from "../api/controllers/AdminController.ts";
import type { StationController } from "../api/controllers/StationController.ts";
import type { TripController } from "../api/controllers/TripController.ts";
import { BookingService } from "../api/services/BookingService.ts";

export class AppRouter extends MainRouter {
  // ─────────────────────────────────────────────────────────────────────────────
  // Train Booking System
  // ─────────────────────────────────────────────────────────────────────────────
  protected readonly srv = $inject(BookingService);
  protected readonly adminController = $client<AdminController>();
  protected readonly stationController = $client<StationController>();
  protected readonly tripController = $client<TripController>();
  protected readonly sidebar = $inject(AdminSidebar);

  constructor() {
    super();

    const base = this.sidebar.menu;
    this.sidebar.menu = (router) => [
      ...base(router),
      {
        type: "divider",
      },
      {
        ...router.node("adminBookings"),
        description: undefined,
      },
      {
        ...router.node("adminPayments"),
        description: undefined,
      },
      {
        type: "divider",
      },
      {
        ...router.node("adminDemo"),
        description: undefined,
      },
    ];
  }

  bookingLayout = $page({
    icon: IconTrain,
    parent: this.layout,
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin Demo
  // ─────────────────────────────────────────────────────────────────────────────
  adminDemo = $page({
    icon: IconDatabase,
    path: "/seed",
    parent: this.admin.layout,
    label: "Datasets",
    description: "Manage seed data and database operations.",
    lazy: () => import("./components/admin/AdminDemo.tsx"),
    resolve: async () => {
      const seedSets = await this.adminController.getSeedSets({});
      return { seedSets };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin Bookings
  // ─────────────────────────────────────────────────────────────────────────────
  adminBookings = $page({
    icon: IconTicket,
    path: "/bookings",
    parent: this.admin.layout,
    label: "Bookings",
    description: "View and manage all bookings.",
    lazy: () => import("./components/admin/AdminBookings.tsx"),
  });

  adminBookingLayout = $page({
    icon: IconTicket,
    path: "/bookings/:bookingId",
    parent: this.admin.layout,
    label: "Booking Details",
    description: "View and edit booking details.",
    lazy: () => import("./components/admin/AdminBookingLayout.tsx"),
    children: () => [this.adminBookingDetails],
  });

  adminBookingDetails = $page({
    icon: IconUser,
    path: "/",
    label: "Details",
    description: "Edit booking and passenger information.",
    lazy: () => import("./components/admin/AdminBookingDetails.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin Payments
  // ─────────────────────────────────────────────────────────────────────────────
  adminPayments = $page({
    icon: IconCreditCard,
    path: "/payments",
    parent: this.admin.layout,
    label: "Payments",
    description: "View and manage all payments.",
    lazy: () => import("./components/admin/AdminPayments.tsx"),
  });

  adminPaymentLayout = $page({
    icon: IconCreditCard,
    path: "/payments/:paymentId",
    parent: this.admin.layout,
    label: "Payment Details",
    description: "View and edit payment details.",
    lazy: () => import("./components/admin/AdminPaymentLayout.tsx"),
    children: () => [this.adminPaymentDetails],
  });

  adminPaymentDetails = $page({
    icon: IconCreditCard,
    path: "/",
    label: "Details",
    description: "View and update payment information.",
    lazy: () => import("./components/admin/AdminPaymentDetails.tsx"),
  });
}
