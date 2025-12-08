import { $page, ReactRouter } from "@alepha/react";
import { AdminRouter } from "@alepha/ui/admin";
import {
  IconCreditCard,
  IconDatabase,
  IconTicket,
  IconUser,
} from "@tabler/icons-react";
import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import type { AdminController } from "../api/controllers/AdminController.ts";

export class AdminAppRouter extends AdminRouter {
  protected readonly adminController = $client<AdminController>();
  protected readonly router = $inject(ReactRouter);

  adminDemo = $page({
    icon: IconDatabase,
    path: "/seed",
    parent: this.layout,
    label: "Datasets",
    description: "Manage seed data and database operations.",
    lazy: () => import("./components/admin/AdminDemo.tsx"),
    resolve: async () => {
      const seedSets = await this.adminController.getSeedSets({});
      return { seedSets };
    },
  });

  adminBookings = $page({
    icon: IconTicket,
    path: "/bookings",
    parent: this.layout,
    label: "Bookings",
    description: "View and manage all bookings.",
    lazy: () => import("./components/admin/AdminBookings.tsx"),
  });

  adminBookingLayout = $page({
    icon: IconTicket,
    path: "/bookings/:bookingId",
    parent: this.layout,
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

  adminPayments = $page({
    icon: IconCreditCard,
    path: "/payments",
    parent: this.layout,
    label: "Payments",
    description: "View and manage all payments.",
    lazy: () => import("./components/admin/AdminPayments.tsx"),
  });

  adminPaymentLayout = $page({
    icon: IconCreditCard,
    path: "/payments/:paymentId",
    parent: this.layout,
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
