import { $page, ReactRouter, Redirection } from "@alepha/react";
import type { SidebarNode } from "@alepha/ui";
import { AdminRouter } from "@alepha/ui/admin";
import {
  IconAddressBook,
  IconAlertCircle,
  IconArmchair,
  IconBell,
  IconBuilding,
  IconChartBar,
  IconClipboard,
  IconCreditCard,
  IconDatabase,
  IconDevices,
  IconEye,
  IconFile,
  IconGift,
  IconId,
  IconKey,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconListTree,
  IconMap,
  IconMessageCircle,
  IconPackage,
  IconPercentage,
  IconPlayerPlay,
  IconReceipt,
  IconReportAnalytics,
  IconRouter,
  IconServer,
  IconSettings,
  IconSettingsSpark,
  IconShield,
  IconTicket,
  IconTrendingUp,
  IconUser,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import { $inject, t } from "alepha";
import { $client } from "alepha/server/links";
import type { AgentController } from "../api/agents/controllers/AgentController.ts";
import type { DeviceController } from "../api/devices/controllers/DeviceController.ts";
import type { AdminInventoryController } from "../api/inventory/controllers/AdminInventoryController.ts";
import type { SeedController } from "../api/system/controllers/SeedController.ts";
import type { SeatLayoutController } from "../api/vehicles/controllers/SeatLayoutController.ts";

export class AdmRouter extends AdminRouter {
  protected readonly seedController = $client<SeedController>();
  protected readonly adminInventoryController =
    $client<AdminInventoryController>();
  protected readonly seatLayoutController = $client<SeatLayoutController>();
  protected readonly agentController = $client<AgentController>();
  protected readonly deviceController = $client<DeviceController>();
  protected readonly router = $inject(ReactRouter);

  onNotAuthorized(url: URL) {
    return new Redirection(
      this.router.path(this.authRouter.login.name, {
        query: {
          r: url.pathname,
          realm: "agent",
        },
      }),
    );
  }

  adminShellProps() {
    const menu: SidebarNode[] = [
      { type: "toggle" },
      { type: "spacer" },

      // Dashboard
      {
        label: "Dashboard",
        icon: IconLayoutDashboard,
        href: this.router.path("adminDashboard"),
      },

      // Operations
      {
        label: "Operations",
        icon: IconClipboard,
        children: [
          {
            label: "Bookings",
            icon: IconTicket,
            href: this.router.path("adminBookings"),
          },
          {
            label: "Payments",
            icon: IconCreditCard,
            href: this.router.path("adminPayments"),
          },
          {
            label: "Inventory",
            icon: IconArmchair,
            href: this.router.path("adminInventory"),
          },
          {
            label: "Orders",
            icon: IconReceipt,
            href: this.router.path("adminOrders"),
          },
          {
            label: "Sales",
            icon: IconTrendingUp,
            href: this.router.path("adminSales"),
          },
        ],
      },

      // Reporting
      {
        label: "Reporting",
        icon: IconReportAnalytics,
        children: [
          {
            label: "Reports",
            icon: IconChartBar,
            href: this.router.path("adminReports"),
          },
        ],
      },

      // Customer Management
      {
        label: "Customers",
        icon: IconUsersGroup,
        children: [
          {
            label: "Profiles",
            icon: IconAddressBook,
            href: this.router.path("adminCustomers"),
          },
          {
            label: "Vouchers",
            icon: IconGift,
            href: this.router.path("adminVouchers"),
          },
          {
            label: "Issues",
            icon: IconAlertCircle,
            href: this.router.path("adminIssues"),
          },
        ],
      },

      // Agents (Staff Management)
      {
        label: "Company",
        icon: IconBuilding,
        children: [
          {
            label: "Agents",
            icon: IconId,
            href: this.router.path("adminAgents"),
          },
        ],
      },

      // Devices Management
      {
        label: "Devices",
        icon: IconRouter,
        children: [
          {
            label: "All Devices",
            icon: IconDevices,
            href: this.router.path("adminDevices"),
          },
          {
            label: "Supervision",
            icon: IconEye,
            href: this.router.path("adminDeviceSupervision"),
          },
        ],
      },

      // Security (User Management)
      {
        label: "Security",
        icon: IconShield,
        children: [
          {
            label: "Users",
            icon: IconUser,
            href: this.router.path("adminUsers"),
            can: () => this.userCtrl.findUsers.can(),
          },
          {
            label: "Sessions",
            icon: IconKey,
            href: this.router.path("adminSessions"),
            can: () => this.sessionCtrl.findSessions.can(),
          },
          {
            label: "Notifications",
            icon: IconBell,
            href: this.router.path("adminNotifications"),
            can: () => this.notificationCtrl.findNotifications.can(),
          },
          {
            label: "Audit Logs",
            icon: IconClipboard,
            href: this.router.path("adminAudits"),
          },
        ],
      },

      // Configuration
      {
        label: "Configuration",
        icon: IconSettings,
        children: [
          {
            label: "Topology",
            icon: IconMap,
            href: this.router.path("adminTopology"),
          },
          {
            label: "Vehicles",
            icon: IconLayoutGrid,
            href: this.router.path("adminSeatLayouts"),
          },
          {
            label: "Fare Classes",
            icon: IconReceipt,
            href: this.router.path("adminFareClasses"),
          },
          {
            label: "Price Rules",
            icon: IconPercentage,
            href: this.router.path("adminPriceRules"),
          },
          {
            label: "Products",
            icon: IconPackage,
            href: this.router.path("adminProducts"),
          },
        ],
      },

      // System
      {
        label: "System",
        icon: IconServer,
        children: [
          {
            label: "Jobs",
            icon: IconPlayerPlay,
            href: this.router.path("adminJobs"),
          },
          {
            label: "Files",
            icon: IconFile,
            href: this.router.path("adminFiles"),
            can: () => this.fileCtrl.findFiles.can(),
          },
          {
            label: "Parameters",
            icon: IconSettingsSpark,
            href: this.router.path("adminParameters"),
          },
          {
            label: "Datasets",
            icon: IconDatabase,
            href: this.router.path("adminDemo"),
          },
        ],
      },
    ];

    return {
      sidebarProps: {
        menu,
      },
    };
  }

  adminDashboard = $page({
    icon: IconLayoutDashboard,
    path: "/",
    parent: this.layout,
    label: "Dashboard",
    description: "Overview of the AlephaRail administration.",
    lazy: () => import("./components/dashboard/AdminDashboard.tsx"),
  });

  adminDemo = $page({
    icon: IconDatabase,
    path: "/seed",
    parent: this.layout,
    label: "Datasets",
    description: "Manage seed data and database operations.",
    lazy: () => import("./components/demo/AdminDemo.tsx"),
    resolve: async () => {
      const seedSets = await this.seedController.getSeedSets({});
      return { seedSets };
    },
  });

  adminBookings = $page({
    icon: IconTicket,
    path: "/bookings",
    parent: this.layout,
    label: "Bookings",
    description: "View and manage all bookings.",
    lazy: () => import("./components/bookings/AdminBookings.tsx"),
  });

  adminBookingLayout = $page({
    icon: IconTicket,
    path: "/bookings/:bookingId",
    parent: this.layout,
    label: "Booking Details",
    description: "View and edit booking details.",
    lazy: () => import("./components/bookings/AdminBookingLayout.tsx"),
    children: () => [this.adminBookingDetails],
  });

  adminBookingDetails = $page({
    icon: IconUser,
    path: "/",
    label: "Details",
    description: "Edit booking and passenger information.",
    lazy: () => import("./components/bookings/AdminBookingDetails.tsx"),
  });

  adminPayments = $page({
    icon: IconCreditCard,
    path: "/payments",
    parent: this.layout,
    label: "Payments",
    description: "View and manage all payments.",
    lazy: () => import("./components/payments/AdminPayments.tsx"),
  });

  adminPaymentLayout = $page({
    icon: IconCreditCard,
    path: "/payments/:paymentId",
    parent: this.layout,
    label: "Payment Details",
    description: "View and edit payment details.",
    lazy: () => import("./components/payments/AdminPaymentLayout.tsx"),
    children: () => [this.adminPaymentDetails],
  });

  adminPaymentDetails = $page({
    icon: IconCreditCard,
    path: "/",
    label: "Details",
    description: "View and update payment information.",
    lazy: () => import("./components/payments/AdminPaymentDetails.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Inventory Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminInventory = $page({
    icon: IconArmchair,
    path: "/inventory",
    parent: this.layout,
    label: "Inventory",
    description: "View seat inventory and trip instances.",
    lazy: () => import("./components/inventory/AdminInventory.tsx"),
  });

  adminFareClasses = $page({
    icon: IconReceipt,
    path: "/fare-classes",
    parent: this.layout,
    label: "Fare Classes",
    description: "Manage fare classes and pricing tiers.",
    lazy: () => import("./components/inventory/AdminFareClasses.tsx"),
  });

  adminPriceRules = $page({
    icon: IconTrendingUp,
    path: "/price-rules",
    parent: this.layout,
    label: "Price Rules",
    description: "Manage dynamic pricing rules.",
    lazy: () => import("./components/inventory/AdminPriceRules.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Customer Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminCustomers = $page({
    icon: IconUsersGroup,
    path: "/customers",
    parent: this.layout,
    label: "Customers",
    description: "View and manage customer profiles and loyalty.",
    lazy: () => import("./components/customers/AdminCustomers.tsx"),
  });

  adminCustomerLayout = $page({
    icon: IconUser,
    path: "/customers/:customerId",
    parent: this.layout,
    label: "Customer Details",
    description: "View and edit customer information.",
    schema: {
      params: t.object({ customerId: t.uuid() }),
    },
    lazy: () => import("./components/customers/AdminCustomerLayout.tsx"),
    children: () => [
      this.adminCustomerDetails,
      this.adminCustomerPassengers,
      this.adminCustomerAddresses,
      this.adminCustomerVouchers,
    ],
  });

  adminCustomerDetails = $page({
    icon: IconUser,
    path: "/",
    label: "Profile",
    description: "View and edit customer profile and loyalty status.",
    lazy: () => import("./components/customers/AdminCustomerDetails.tsx"),
  });

  adminCustomerPassengers = $page({
    icon: IconUsers,
    path: "/passengers",
    label: "Passengers",
    description: "Manage saved passengers for this customer.",
    lazy: () => import("./components/customers/AdminCustomerPassengers.tsx"),
  });

  adminCustomerAddresses = $page({
    icon: IconFile,
    path: "/addresses",
    label: "Addresses",
    description: "Manage customer billing and shipping addresses.",
    lazy: () => import("./components/customers/AdminCustomerAddresses.tsx"),
  });

  adminCustomerVouchers = $page({
    icon: IconGift,
    path: "/vouchers",
    label: "Vouchers",
    description: "View customer vouchers and discounts.",
    lazy: () => import("./components/customers/AdminCustomerVouchers.tsx"),
  });

  adminVouchers = $page({
    icon: IconGift,
    path: "/vouchers",
    parent: this.layout,
    label: "Vouchers",
    description: "Manage vouchers and promotional codes.",
    lazy: () => import("./components/vouchers/AdminVouchers.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminAgents = $page({
    icon: IconId,
    path: "/agents",
    parent: this.layout,
    label: "Agents",
    description: "Manage agent profiles and employee information.",
    lazy: () => import("./components/agents/AdminAgents.tsx"),
  });

  adminAgentLayout = $page({
    icon: IconId,
    path: "/agents/:agentId",
    parent: this.layout,
    label: "Agent Details",
    description: "View and edit agent information.",
    schema: {
      params: t.object({ agentId: t.uuid() }),
    },
    lazy: () => import("./components/agents/AdminAgentLayout.tsx"),
    children: () => [this.adminAgentDetails],
  });

  adminAgentDetails = $page({
    icon: IconUser,
    path: "/",
    label: "Profile",
    description: "View and edit agent profile.",
    lazy: () => import("./components/agents/AdminAgentDetails.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Device Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminDevices = $page({
    icon: IconRouter,
    path: "/devices",
    parent: this.layout,
    label: "Devices",
    description: "Manage gates, TVMs, and validators.",
    lazy: () => import("./components/devices/AdminDevices.tsx"),
  });

  adminDeviceSupervision = $page({
    icon: IconEye,
    path: "/devices/supervision",
    parent: this.layout,
    label: "Device Supervision",
    description: "Monitor device health and status on a map.",
    lazy: () => import("./components/devices/AdminDeviceSupervision.tsx"),
  });

  adminDeviceLayout = $page({
    icon: IconRouter,
    path: "/devices/:deviceId",
    parent: this.layout,
    label: "Device Details",
    description: "View and edit device information.",
    schema: {
      params: t.object({ deviceId: t.uuid() }),
    },
    lazy: () => import("./components/devices/AdminDeviceLayout.tsx"),
    children: () => [this.adminDeviceDetails],
  });

  adminDeviceDetails = $page({
    icon: IconDevices,
    path: "/",
    label: "Details",
    description: "View and edit device configuration.",
    lazy: () => import("./components/devices/AdminDeviceDetails.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Jobs
  // ─────────────────────────────────────────────────────────────────────────────

  adminJobs = $page({
    icon: IconPlayerPlay,
    path: "/jobs",
    parent: this.layout,
    label: "Jobs",
    description: "View background job executions and status.",
    lazy: async () => {
      const { AdminJobs } = await import("@alepha/ui/admin");
      return { default: AdminJobs };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Seat Layout Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminSeatLayouts = $page({
    icon: IconLayoutGrid,
    path: "/seat-layouts",
    parent: this.layout,
    label: "Seat Layouts",
    description: "Manage seat layout templates for different train types.",
    lazy: () => import("./components/vehicles/AdminSeatLayouts.tsx"),
  });

  adminSeatLayoutNew = $page({
    icon: IconLayoutGrid,
    path: "/seat-layouts/new",
    parent: this.layout,
    label: "Create Seat Layout",
    description: "Create a new seat layout configuration.",
    lazy: () => import("./components/vehicles/AdminSeatLayoutEditor.tsx"),
    resolve: async () => {
      return { layout: null };
    },
  });

  adminSeatLayoutEditor = $page({
    icon: IconLayoutGrid,
    path: "/seat-layouts/:id",
    parent: this.layout,
    label: "Seat Layout Editor",
    description: "Edit seat layout configuration.",
    schema: {
      params: t.object({ id: t.uuid() }),
    },
    lazy: () => import("./components/vehicles/AdminSeatLayoutEditor.tsx"),
    resolve: async ({ params }) => {
      const layout = await this.seatLayoutController.getSeatLayout({
        params: { id: params.id },
      });
      return { layout };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Topology Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminTopology = $page({
    icon: IconMap,
    path: "/topology",
    parent: this.layout,
    label: "Network Topology",
    description: "View stations and routes on an interactive map.",
    lazy: () => import("./components/topology/AdminTopology.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Product Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminProducts = $page({
    icon: IconPackage,
    path: "/products",
    parent: this.layout,
    label: "Products",
    description: "Manage products and add-ons for sale.",
    lazy: () => import("./components/products/AdminProducts.tsx"),
  });

  adminProductLayout = $page({
    icon: IconPackage,
    path: "/products/:productId",
    parent: this.layout,
    label: "Product Details",
    description: "View and edit product information.",
    schema: {
      params: t.object({ productId: t.uuid() }),
    },
    lazy: () => import("./components/products/AdminProductLayout.tsx"),
    children: () => [this.adminProductDetails],
  });

  adminProductDetails = $page({
    icon: IconPackage,
    path: "/",
    label: "Details",
    description: "View and edit product details.",
    lazy: () => import("./components/products/AdminProductDetails.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Product Orders & Sales
  // ─────────────────────────────────────────────────────────────────────────────

  adminOrders = $page({
    icon: IconReceipt,
    path: "/orders",
    parent: this.layout,
    label: "Orders",
    description: "View and manage product orders.",
    lazy: () => import("./components/orders/AdminProductOrders.tsx"),
  });

  adminOrderLayout = $page({
    icon: IconReceipt,
    path: "/orders/:orderId",
    parent: this.layout,
    label: "Order Details",
    description: "View and manage order details.",
    schema: {
      params: t.object({ orderId: t.uuid() }),
    },
    lazy: () => import("./components/orders/AdminProductOrderLayout.tsx"),
    children: () => [this.adminOrderDetails],
  });

  adminOrderDetails = $page({
    icon: IconReceipt,
    path: "/",
    label: "Details",
    description: "View and edit order details.",
    lazy: () => import("./components/orders/AdminProductOrderDetails.tsx"),
  });

  adminSales = $page({
    icon: IconTrendingUp,
    path: "/sales",
    parent: this.layout,
    label: "Sales Dashboard",
    description: "View sales analytics and product performance.",
    lazy: () => import("./components/orders/AdminProductSales.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Issue Management
  // ─────────────────────────────────────────────────────────────────────────────

  adminIssues = $page({
    icon: IconAlertCircle,
    path: "/issues",
    parent: this.layout,
    label: "Issues",
    description: "View and manage support issues and tickets.",
    lazy: () => import("./components/issues/AdminIssues.tsx"),
  });

  adminIssueLayout = $page({
    icon: IconAlertCircle,
    path: "/issues/:issueId",
    parent: this.layout,
    label: "Issue Details",
    description: "View and manage issue details.",
    schema: {
      params: t.object({ issueId: t.uuid() }),
    },
    lazy: () => import("./components/issues/AdminIssueLayout.tsx"),
    children: () => [
      this.adminIssueDetails,
      this.adminIssueMessages,
      this.adminIssueChildren,
    ],
  });

  adminIssueDetails = $page({
    icon: IconAlertCircle,
    path: "/",
    label: "Details",
    description: "View and edit issue details.",
    lazy: () => import("./components/issues/AdminIssueDetails.tsx"),
  });

  adminIssueMessages = $page({
    icon: IconMessageCircle,
    path: "/messages",
    label: "Messages",
    description: "View and send messages on this issue.",
    lazy: () => import("./components/issues/AdminIssueMessages.tsx"),
  });

  adminIssueChildren = $page({
    icon: IconListTree,
    path: "/children",
    label: "Children",
    description: "View child issues.",
    lazy: () => import("./components/issues/AdminIssueChildren.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reporting
  // ─────────────────────────────────────────────────────────────────────────────

  adminReports = $page({
    icon: IconChartBar,
    path: "/reports",
    parent: this.layout,
    label: "Reports",
    description: "Browse and generate business intelligence reports.",
    lazy: () => import("./components/reports/AdminReports.tsx"),
  });

  adminReportViewer = $page({
    icon: IconChartBar,
    path: "/reports/:reportId",
    parent: this.layout,
    label: "Report Viewer",
    description: "Configure and run a report.",
    schema: {
      params: t.object({ reportId: t.text() }),
    },
    lazy: () => import("./components/reports/AdminReportViewer.tsx"),
  });
}
