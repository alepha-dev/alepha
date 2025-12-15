import { $page } from "@alepha/react";
import {
  IconAccessible,
  IconArmchair,
  IconBriefcase,
  IconCalendar,
  IconCheck,
  IconCreditCard,
  IconGift,
  IconHelp,
  IconLeaf,
  IconListSearch,
  IconLuggage,
  IconMapPin,
  IconNews,
  IconPhone,
  IconRoute,
  IconSearch,
  IconTarget,
  IconTicket,
  IconTrain,
} from "@tabler/icons-react";
import { t } from "alepha";
import { $client } from "alepha/server/links";
import type { InventoryController } from "../api/inventory/controllers/InventoryController.ts";
import type { PricingController } from "../api/pricing/controllers/PricingController.ts";
import type { StationController } from "../api/topology/controllers/StationController.ts";
import type { TripController } from "../api/topology/controllers/TripController.ts";

export class CwsRouter {
  protected readonly stationController = $client<StationController>();
  protected readonly tripController = $client<TripController>();
  protected readonly inventoryController = $client<InventoryController>();
  protected readonly pricingController = $client<PricingController>();

  bookingLayout = $page({
    path: "/booking",
    icon: IconTrain,
    label: "Book Train",
    description: "Book your train journey across regions.",
    lazy: () => import("./components/booking/BookingLayout.tsx"),
    children: () => [
      this.bookingSearch,
      this.bookingWizard,
      this.bookingConfirmation,
      // Travel pages
      this.stations,
      this.routes,
      this.schedules,
      // Support pages
      this.helpCentre,
      this.accessibility,
      this.lostAndFound,
      this.contact,
      // About pages
      this.mission,
      this.sustainability,
      this.careers,
      this.press,
    ],
  });

  /**
   * Booking wizard with stepper navigation.
   * Wraps all booking flow steps after search.
   */
  bookingWizard = $page({
    icon: IconListSearch,
    path: "/flow",
    label: "Booking Flow",
    description: "Complete your booking.",
    lazy: () => import("./components/booking/BookingWizard.tsx"),
    children: () => [
      this.bookingResults,
      this.bookingFareClass,
      this.bookingSeats,
      this.bookingAddOns,
      this.bookingPayment,
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

  bookingFareClass = $page({
    icon: IconTicket,
    path: "/fareclass",
    label: "Fare",
    description: "Choose your fare class.",
    schema: {
      query: t.object({
        tripId: t.uuid(),
        date: t.text(),
      }),
    },
    lazy: () => import("./components/booking/FareClassSelection.tsx"),
    resolve: async ({ query }) => {
      // Get or create trip instance for the date
      const tripInstance =
        await this.inventoryController.getOrCreateTripInstance({
          params: { tripId: query.tripId },
          query: { date: query.date },
        });

      // Get available fare classes with prices
      const fareClasses = await this.pricingController.getAvailableFareClasses({
        params: { tripId: query.tripId },
        query: { tripInstanceId: tripInstance.id, date: query.date },
      });

      return {
        fareClasses,
        tripInstanceId: tripInstance.id,
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

  bookingAddOns = $page({
    icon: IconGift,
    path: "/addons",
    label: "Add-ons",
    description: "Enhance your journey with extras and services.",
    lazy: () => import("./components/booking/AddOns.tsx"),
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
  // Travel Pages
  // ─────────────────────────────────────────────────────────────────────────────

  stations = $page({
    icon: IconMapPin,
    path: "/stations",
    label: "Stations",
    description: "Explore our stations across Canada.",
    lazy: () => import("./components/info/Stations.tsx"),
    resolve: async () => {
      const stations = await this.stationController.getStations({});
      return { stations };
    },
  });

  routes = $page({
    icon: IconRoute,
    path: "/routes",
    label: "Routes",
    description: "View our route network across Canada.",
    lazy: () => import("./components/info/Routes.tsx"),
  });

  schedules = $page({
    icon: IconCalendar,
    path: "/schedules",
    label: "Schedules",
    description: "View train schedules and timetables.",
    lazy: () => import("./components/info/Schedules.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Support Pages
  // ─────────────────────────────────────────────────────────────────────────────

  helpCentre = $page({
    icon: IconHelp,
    path: "/help",
    label: "Help Centre",
    description: "Find answers to common questions.",
    lazy: () => import("./components/support/HelpCentre.tsx"),
  });

  accessibility = $page({
    icon: IconAccessible,
    path: "/accessibility",
    label: "Accessibility",
    description: "Accessibility services and information.",
    lazy: () => import("./components/support/Accessibility.tsx"),
  });

  lostAndFound = $page({
    icon: IconLuggage,
    path: "/lost-and-found",
    label: "Lost & Found",
    description: "Report or retrieve lost items.",
    lazy: () => import("./components/support/LostAndFound.tsx"),
  });

  contact = $page({
    icon: IconPhone,
    path: "/contact",
    label: "Contact",
    description: "Get in touch with us.",
    lazy: () => import("./components/support/Contact.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // About Pages
  // ─────────────────────────────────────────────────────────────────────────────

  mission = $page({
    icon: IconTarget,
    path: "/about",
    label: "Our Mission",
    description: "Learn about AlephaRail's mission and values.",
    lazy: () => import("./components/about/Mission.tsx"),
  });

  sustainability = $page({
    icon: IconLeaf,
    path: "/sustainability",
    label: "Sustainability",
    description: "Our commitment to environmental sustainability.",
    lazy: () => import("./components/about/Sustainability.tsx"),
  });

  careers = $page({
    icon: IconBriefcase,
    path: "/careers",
    label: "Careers",
    description: "Join our team at AlephaRail.",
    lazy: () => import("./components/about/Careers.tsx"),
  });

  press = $page({
    icon: IconNews,
    path: "/press",
    label: "Press",
    description: "News and media resources.",
    lazy: () => import("./components/about/Press.tsx"),
  });
}
