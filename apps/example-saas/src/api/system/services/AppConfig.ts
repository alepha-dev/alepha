import { t } from "alepha";
import { $config } from "alepha/api/parameters";

// ─────────────────────────────────────────────────────────────────────────────
// Booking Rules Configuration
// ─────────────────────────────────────────────────────────────────────────────

const bookingRulesSchema = t.object({
  maxPassengersPerBooking: t.integer({
    minimum: 1,
    maximum: 20,
    description: "Maximum number of passengers allowed per booking",
  }),
  maxAdvanceBookingDays: t.integer({
    minimum: 1,
    maximum: 365,
    description: "How many days in advance a booking can be made",
  }),
  minAdvanceBookingHours: t.integer({
    minimum: 0,
    maximum: 72,
    description: "Minimum hours before departure that booking is allowed",
  }),
  reservationTimeoutMinutes: t.integer({
    minimum: 5,
    maximum: 60,
    description: "How long a seat reservation is held before expiring",
  }),
  allowSameDayBooking: t.boolean({
    description: "Whether same-day bookings are allowed",
  }),
  requirePassengerDetails: t.boolean({
    description: "Whether passenger details are required at booking time",
  }),
  cancellation: t.object({
    allowedUntilHoursBeforeDeparture: t.integer({
      minimum: 0,
      description: "Hours before departure until cancellation is allowed",
    }),
    refundPercentageByHours: t.array(
      t.object({
        hoursBeforeDeparture: t.integer(),
        refundPercent: t.integer({ minimum: 0, maximum: 100 }),
      }),
    ),
    adminOverrideEnabled: t.boolean({
      description: "Whether admins can override cancellation rules",
    }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Pricing Configuration
// ─────────────────────────────────────────────────────────────────────────────

const pricingConfigSchema = t.object({
  currency: t.object({
    code: t.string({
      pattern: "^[A-Z]{3}$",
      description: "ISO 4217 currency code",
    }),
    symbol: t.string({ description: "Currency symbol for display" }),
    decimalPlaces: t.integer({ minimum: 0, maximum: 4 }),
  }),
  priceValidityMinutes: t.integer({
    minimum: 5,
    maximum: 60,
    description: "How long a quoted price remains valid",
  }),
  dynamicPricing: t.object({
    enabled: t.boolean({ description: "Whether dynamic pricing is active" }),
    maxSurgeMultiplier: t.number({
      minimum: 1,
      maximum: 5,
      description: "Maximum surge pricing multiplier",
    }),
    minDiscountMultiplier: t.number({
      minimum: 0.5,
      maximum: 1,
      description: "Minimum discount multiplier",
    }),
  }),
  seatPremiums: t.object({
    windowSeatPremium: t.integer({
      description: "Extra charge for window seats",
    }),
    aisleSeatPremium: t.integer({
      description: "Extra charge for aisle seats",
    }),
    extraLegroomPremium: t.integer({
      description: "Extra charge for extra legroom",
    }),
    quietZonePremium: t.integer({ description: "Extra charge for quiet zone" }),
  }),
  fees: t.object({
    bookingFee: t.integer({ description: "Fixed booking fee per transaction" }),
    paymentProcessingPercent: t.number({
      minimum: 0,
      maximum: 10,
      description: "Payment processing fee as percentage",
    }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature Flags Configuration
// ─────────────────────────────────────────────────────────────────────────────

const featureFlagsSchema = t.object({
  seatSelection: t.object({
    enabled: t.boolean({ description: "Whether seat selection is available" }),
    freeForFirstClass: t.boolean({
      description: "Free seat selection for first class",
    }),
  }),
  mobileTickets: t.object({
    enabled: t.boolean({ description: "Whether mobile tickets are available" }),
    qrCodeEnabled: t.boolean({ description: "Show QR code on mobile tickets" }),
    appleWalletEnabled: t.boolean({ description: "Apple Wallet integration" }),
    googlePayEnabled: t.boolean({ description: "Google Pay integration" }),
  }),
  notifications: t.object({
    emailConfirmation: t.boolean({ description: "Send email confirmations" }),
    smsReminders: t.boolean({ description: "Send SMS reminders" }),
    pushNotifications: t.boolean({ description: "Send push notifications" }),
    departureReminderHours: t.array(t.integer(), {
      description: "Hours before departure to send reminders",
    }),
  }),
  customerFeatures: t.object({
    accountRequired: t.boolean({ description: "Require account for booking" }),
    guestCheckout: t.boolean({ description: "Allow guest checkout" }),
    loyaltyProgram: t.boolean({ description: "Enable loyalty program" }),
    savedPaymentMethods: t.boolean({
      description: "Allow saving payment methods",
    }),
    travelHistory: t.boolean({ description: "Show travel history" }),
  }),
  adminFeatures: t.object({
    manualPriceOverride: t.boolean({
      description: "Allow manual price override",
    }),
    bulkBookingImport: t.boolean({ description: "Allow bulk booking import" }),
    revenueReports: t.boolean({ description: "Enable revenue reports" }),
    realTimeOccupancy: t.boolean({ description: "Show real-time occupancy" }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// System Limits Configuration
// ─────────────────────────────────────────────────────────────────────────────

const systemLimitsSchema = t.object({
  rateLimits: t.object({
    searchRequestsPerMinute: t.integer({
      minimum: 10,
      maximum: 1000,
      description: "Max search requests per minute per IP",
    }),
    bookingRequestsPerMinute: t.integer({
      minimum: 1,
      maximum: 100,
      description: "Max booking requests per minute per user",
    }),
    apiRequestsPerMinute: t.integer({
      minimum: 100,
      maximum: 10000,
      description: "Max API requests per minute per API key",
    }),
  }),
  cache: t.object({
    searchResultsTtlSeconds: t.integer({
      minimum: 30,
      maximum: 3600,
      description: "How long to cache search results",
    }),
    priceQuoteTtlSeconds: t.integer({
      minimum: 60,
      maximum: 1800,
      description: "How long to cache price quotes",
    }),
    stationListTtlSeconds: t.integer({
      minimum: 3600,
      maximum: 86400,
      description: "How long to cache station list",
    }),
  }),
  maintenance: t.object({
    enabled: t.boolean({ description: "Whether maintenance mode is active" }),
    message: t.string({ description: "Maintenance mode message to display" }),
    allowAdminAccess: t.boolean({
      description: "Allow admin access during maintenance",
    }),
    estimatedEndTime: t.optional(
      t.datetime({ description: "When maintenance is expected to end" }),
    ),
  }),
  performance: t.object({
    maxConcurrentBookings: t.integer({
      minimum: 10,
      maximum: 1000,
      description: "Max concurrent booking transactions",
    }),
    searchTimeoutMs: t.integer({
      minimum: 1000,
      maximum: 30000,
      description: "Search request timeout in milliseconds",
    }),
    paymentTimeoutMs: t.integer({
      minimum: 10000,
      maximum: 120000,
      description: "Payment processing timeout in milliseconds",
    }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Regional Settings Configuration
// ─────────────────────────────────────────────────────────────────────────────

const regionalSettingsSchema = t.object({
  defaultLanguage: t.string({
    description: "Default language code (e.g., en, fr, de)",
  }),
  supportedLanguages: t.array(t.string(), {
    description: "List of supported language codes",
  }),
  defaultTimezone: t.string({
    description: "Default timezone (e.g., Europe/Paris)",
  }),
  dateFormat: t.string({
    description: "Date format pattern (e.g., DD/MM/YYYY)",
  }),
  timeFormat: t.enum(["12h", "24h"], { description: "Time format preference" }),
  distanceUnit: t.enum(["km", "miles"], {
    description: "Distance unit preference",
  }),
  termsAndConditionsUrl: t.string({
    format: "uri",
    description: "URL to terms and conditions",
  }),
  privacyPolicyUrl: t.string({
    format: "uri",
    description: "URL to privacy policy",
  }),
  supportEmail: t.string({
    format: "email",
    description: "Customer support email",
  }),
  supportPhone: t.string({ description: "Customer support phone number" }),
});

// ─────────────────────────────────────────────────────────────────────────────
// AppConfig Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Centralized application configuration using versioned parameters.
 *
 * All configurations are:
 * - Type-safe with schema validation
 * - Versioned with full history
 * - Editable via admin UI
 * - Synced across all instances
 *
 * @example
 * ```ts
 * const config = alepha.inject(AppConfig);
 *
 * // Read current values
 * const maxPassengers = config.bookingRules.get("maxPassengersPerBooking");
 * const currency = config.pricing.current.currency.code;
 *
 * // Update configuration
 * await config.features.set({
 *   ...config.features.current,
 *   mobileTickets: { ...config.features.current.mobileTickets, enabled: true }
 * }, { changeDescription: "Enable mobile tickets" });
 * ```
 */
export class AppConfig {
  /**
   * Booking rules and policies.
   */
  bookingRules = $config({
    name: "saas.booking.rules",
    description: "Booking rules, limits, and cancellation policies",
    schema: bookingRulesSchema,
    default: {
      maxPassengersPerBooking: 9,
      maxAdvanceBookingDays: 90,
      minAdvanceBookingHours: 2,
      reservationTimeoutMinutes: 15,
      allowSameDayBooking: true,
      requirePassengerDetails: true,
      cancellation: {
        allowedUntilHoursBeforeDeparture: 24,
        refundPercentageByHours: [
          { hoursBeforeDeparture: 72, refundPercent: 100 },
          { hoursBeforeDeparture: 48, refundPercent: 75 },
          { hoursBeforeDeparture: 24, refundPercent: 50 },
          { hoursBeforeDeparture: 12, refundPercent: 25 },
          { hoursBeforeDeparture: 0, refundPercent: 0 },
        ],
        adminOverrideEnabled: true,
      },
    },
  });

  /**
   * Pricing and fee configuration.
   */
  pricing = $config({
    name: "saas.pricing.config",
    description: "Currency, dynamic pricing, and fee settings",
    schema: pricingConfigSchema,
    default: {
      currency: {
        code: "EUR",
        symbol: "€",
        decimalPlaces: 2,
      },
      priceValidityMinutes: 15,
      dynamicPricing: {
        enabled: true,
        maxSurgeMultiplier: 2.5,
        minDiscountMultiplier: 0.7,
      },
      seatPremiums: {
        windowSeatPremium: 500, // 5.00 EUR in cents
        aisleSeatPremium: 300,
        extraLegroomPremium: 1500,
        quietZonePremium: 800,
      },
      fees: {
        bookingFee: 200, // 2.00 EUR
        paymentProcessingPercent: 2.5,
      },
    },
  });

  /**
   * Feature flags for enabling/disabling functionality.
   */
  features = $config({
    name: "saas.features.flags",
    description: "Feature flags for enabling/disabling app functionality",
    schema: featureFlagsSchema,
    default: {
      seatSelection: {
        enabled: true,
        freeForFirstClass: true,
      },
      mobileTickets: {
        enabled: true,
        qrCodeEnabled: true,
        appleWalletEnabled: false,
        googlePayEnabled: false,
      },
      notifications: {
        emailConfirmation: true,
        smsReminders: false,
        pushNotifications: false,
        departureReminderHours: [24, 2],
      },
      customerFeatures: {
        accountRequired: false,
        guestCheckout: true,
        loyaltyProgram: false,
        savedPaymentMethods: true,
        travelHistory: true,
      },
      adminFeatures: {
        manualPriceOverride: true,
        bulkBookingImport: false,
        revenueReports: true,
        realTimeOccupancy: true,
      },
    },
  });

  /**
   * System limits and performance settings.
   */
  systemLimits = $config({
    name: "saas.system.limits",
    description: "Rate limits, caching, and performance settings",
    schema: systemLimitsSchema,
    default: {
      rateLimits: {
        searchRequestsPerMinute: 60,
        bookingRequestsPerMinute: 10,
        apiRequestsPerMinute: 1000,
      },
      cache: {
        searchResultsTtlSeconds: 300, // 5 minutes
        priceQuoteTtlSeconds: 900, // 15 minutes
        stationListTtlSeconds: 3600, // 1 hour
      },
      maintenance: {
        enabled: false,
        message:
          "We are currently performing scheduled maintenance. Please try again later.",
        allowAdminAccess: true,
        estimatedEndTime: undefined,
      },
      performance: {
        maxConcurrentBookings: 100,
        searchTimeoutMs: 5000,
        paymentTimeoutMs: 30000,
      },
    },
  });

  /**
   * Regional and localization settings.
   */
  regional = $config({
    name: "saas.regional.settings",
    description: "Language, timezone, and contact information",
    schema: regionalSettingsSchema,
    default: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "fr", "de", "es", "it"],
      defaultTimezone: "Europe/Paris",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      distanceUnit: "km",
      termsAndConditionsUrl: "https://example.com/terms",
      privacyPolicyUrl: "https://example.com/privacy",
      supportEmail: "support@example.com",
      supportPhone: "+33 1 23 45 67 89",
    },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Helper methods for common config access patterns
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Check if a feature is enabled.
   */
  isFeatureEnabled(
    category: keyof typeof this.features.current,
    feature?: string,
  ): boolean {
    const categoryConfig = this.features.current[category];
    if (typeof categoryConfig === "boolean") {
      return categoryConfig;
    }
    if (
      feature &&
      typeof categoryConfig === "object" &&
      categoryConfig !== null
    ) {
      return (categoryConfig as Record<string, unknown>)[feature] === true;
    }
    return false;
  }

  /**
   * Check if the system is in maintenance mode.
   */
  isInMaintenance(): boolean {
    return this.systemLimits.current.maintenance.enabled;
  }

  /**
   * Get the cancellation refund percentage for a given hours before departure.
   */
  getCancellationRefundPercent(hoursBeforeDeparture: number): number {
    const rules =
      this.bookingRules.current.cancellation.refundPercentageByHours;
    // Sort by hours descending and find the first rule that applies
    const sortedRules = [...rules].sort(
      (a, b) => b.hoursBeforeDeparture - a.hoursBeforeDeparture,
    );
    const applicableRule = sortedRules.find(
      (r) => hoursBeforeDeparture >= r.hoursBeforeDeparture,
    );
    return applicableRule?.refundPercent ?? 0;
  }

  /**
   * Format a price amount according to current currency settings.
   */
  formatPrice(amountInCents: number): string {
    const { code, symbol, decimalPlaces } = this.pricing.current.currency;
    const amount = amountInCents / 10 ** decimalPlaces;
    return `${symbol}${amount.toFixed(decimalPlaces)}`;
  }
}
