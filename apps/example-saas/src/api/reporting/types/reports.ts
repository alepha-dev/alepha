import { type Static, t } from "alepha";

// ─────────────────────────────────────────────────────────────────────────────
// Report Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type ReportCategory =
  | "financial"
  | "operations"
  | "customers"
  | "inventory"
  | "system";

export type ReportFormat = "json" | "csv" | "pdf";

export const reportDefinitionSchema = t.object({
  id: t.text(),
  name: t.text(),
  description: t.text(),
  category: t.enum([
    "financial",
    "operations",
    "customers",
    "inventory",
    "system",
  ]),
  icon: t.text(),
  parameters: t.array(
    t.object({
      name: t.text(),
      label: t.text(),
      type: t.enum(["date", "dateRange", "select", "multiSelect", "text"]),
      required: t.boolean(),
      options: t.optional(
        t.array(t.object({ value: t.text(), label: t.text() })),
      ),
      defaultValue: t.optional(t.any()),
    }),
  ),
  availableFormats: t.array(t.enum(["json", "csv", "pdf"])),
  scheduleEnabled: t.boolean(),
});

export type ReportDefinition = Static<typeof reportDefinitionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Report Definitions Registry
// ─────────────────────────────────────────────────────────────────────────────

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  // Financial Reports
  {
    id: "revenue-summary",
    name: "Revenue Summary",
    description:
      "Daily, weekly, and monthly revenue breakdown with trends and comparisons",
    category: "financial",
    icon: "IconCurrencyEuro",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last30days", to: "today" },
      },
      {
        name: "groupBy",
        label: "Group By",
        type: "select",
        required: true,
        options: [
          { value: "day", label: "Daily" },
          { value: "week", label: "Weekly" },
          { value: "month", label: "Monthly" },
        ],
        defaultValue: "day",
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },
  {
    id: "payment-reconciliation",
    name: "Payment Reconciliation",
    description:
      "Payment methods breakdown, failed payments, and reconciliation status",
    category: "financial",
    icon: "IconCreditCard",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last7days", to: "today" },
      },
      {
        name: "paymentStatus",
        label: "Payment Status",
        type: "multiSelect",
        required: false,
        options: [
          { value: "paid", label: "Paid" },
          { value: "pending", label: "Pending" },
          { value: "failed", label: "Failed" },
          { value: "refunded", label: "Refunded" },
        ],
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },
  {
    id: "refunds-cancellations",
    name: "Refunds & Cancellations",
    description:
      "Analysis of booking cancellations, refund requests, and reasons",
    category: "financial",
    icon: "IconReceiptRefund",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last30days", to: "today" },
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },

  // Operations Reports
  {
    id: "booking-analytics",
    name: "Booking Analytics",
    description:
      "Booking trends, conversion rates, lead times, and booking patterns",
    category: "operations",
    icon: "IconTicket",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last30days", to: "today" },
      },
      {
        name: "channel",
        label: "Booking Channel",
        type: "multiSelect",
        required: false,
        options: [
          { value: "web", label: "Website" },
          { value: "mobile", label: "Mobile App" },
          { value: "agent", label: "Agent" },
          { value: "station", label: "Station" },
        ],
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },
  {
    id: "route-performance",
    name: "Route Performance",
    description:
      "Most popular routes, occupancy rates, revenue per route, and demand patterns",
    category: "operations",
    icon: "IconRoute",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last30days", to: "today" },
      },
      {
        name: "trainType",
        label: "Train Type",
        type: "multiSelect",
        required: false,
        options: [
          { value: "Eurostar", label: "Eurostar" },
          { value: "TGV INOUI", label: "TGV INOUI" },
          { value: "Thalys", label: "Thalys" },
          { value: "ICE", label: "ICE" },
        ],
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },
  {
    id: "agent-performance",
    name: "Agent Performance",
    description:
      "Bookings processed by agents, customer service metrics, and efficiency",
    category: "operations",
    icon: "IconUsers",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last30days", to: "today" },
      },
      {
        name: "department",
        label: "Department",
        type: "select",
        required: false,
        options: [
          { value: "all", label: "All Departments" },
          { value: "Customer Service", label: "Customer Service" },
          { value: "Operations", label: "Operations" },
          { value: "Management", label: "Management" },
        ],
        defaultValue: "all",
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },

  // Customer Reports
  {
    id: "customer-analytics",
    name: "Customer Analytics",
    description:
      "Customer segments, loyalty tier distribution, lifetime value, and retention",
    category: "customers",
    icon: "IconUserCircle",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last90days", to: "today" },
      },
      {
        name: "loyaltyTier",
        label: "Loyalty Tier",
        type: "multiSelect",
        required: false,
        options: [
          { value: "bronze", label: "Bronze" },
          { value: "silver", label: "Silver" },
          { value: "gold", label: "Gold" },
          { value: "platinum", label: "Platinum" },
        ],
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },
  {
    id: "product-sales",
    name: "Product Sales",
    description:
      "Add-on product sales, top sellers, category performance, and trends",
    category: "customers",
    icon: "IconShoppingCart",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last30days", to: "today" },
      },
      {
        name: "category",
        label: "Product Category",
        type: "multiSelect",
        required: false,
        options: [
          { value: "food_beverage", label: "Food & Beverage" },
          { value: "comfort", label: "Comfort" },
          { value: "entertainment", label: "Entertainment" },
          { value: "insurance", label: "Insurance" },
          { value: "services", label: "Services" },
        ],
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },

  // Inventory Reports
  {
    id: "inventory-utilization",
    name: "Inventory Utilization",
    description:
      "Seat occupancy rates, fare class distribution, and capacity analysis",
    category: "inventory",
    icon: "IconChartBar",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last30days", to: "today" },
      },
      {
        name: "fareClass",
        label: "Fare Class",
        type: "multiSelect",
        required: false,
        options: [
          { value: "PROMO", label: "Promo" },
          { value: "SAVER", label: "Saver" },
          { value: "STANDARD", label: "Standard" },
          { value: "FLEX", label: "Flexible" },
          { value: "BUSINESS", label: "Business" },
        ],
      },
    ],
    availableFormats: ["json", "csv", "pdf"],
    scheduleEnabled: true,
  },

  // System Reports
  {
    id: "system-health",
    name: "System Health",
    description:
      "Device status, API performance, error rates, and system metrics",
    category: "system",
    icon: "IconHeartbeat",
    parameters: [
      {
        name: "dateRange",
        label: "Date Range",
        type: "dateRange",
        required: true,
        defaultValue: { from: "last7days", to: "today" },
      },
      {
        name: "deviceType",
        label: "Device Type",
        type: "multiSelect",
        required: false,
        options: [
          { value: "gate", label: "Gates" },
          { value: "tvm", label: "Ticket Machines" },
          { value: "validator", label: "Validators" },
        ],
      },
    ],
    availableFormats: ["json", "csv"],
    scheduleEnabled: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Report Data Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const revenueDataPointSchema = t.object({
  date: t.text(),
  revenue: t.number(),
  bookingCount: t.integer(),
  averageOrderValue: t.number(),
  previousPeriodRevenue: t.optional(t.number()),
  growthPercent: t.optional(t.number()),
});

export const routePerformanceSchema = t.object({
  routeId: t.text(),
  fromStation: t.text(),
  toStation: t.text(),
  trainType: t.text(),
  totalBookings: t.integer(),
  totalRevenue: t.number(),
  averageOccupancy: t.number(),
  averagePrice: t.number(),
});

export const customerSegmentSchema = t.object({
  segment: t.text(),
  customerCount: t.integer(),
  totalRevenue: t.number(),
  averageBookingsPerCustomer: t.number(),
  retentionRate: t.number(),
});

export type RevenueDataPoint = Static<typeof revenueDataPointSchema>;
export type RoutePerformance = Static<typeof routePerformanceSchema>;
export type CustomerSegment = Static<typeof customerSegmentSchema>;
