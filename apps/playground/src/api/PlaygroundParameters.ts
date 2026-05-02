import { t } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * Example application parameters exercised by the parameters admin page.
 */
export class PlaygroundParameters {
  public readonly features = $parameter({
    name: "app.features",
    description: "Feature flags for the playground app.",
    schema: t.object({
      enableBeta: t.boolean(),
      enableExperimentalJobs: t.boolean(),
      enableDarkMode: t.boolean(),
    }),
    default: {
      enableBeta: false,
      enableExperimentalJobs: false,
      enableDarkMode: true,
    },
  });

  public readonly limits = $parameter({
    name: "app.limits",
    description: "Hard limits applied across the app.",
    schema: t.object({
      maxUploadSize: t.integer({ description: "Max upload size in bytes" }),
      maxJobsPerUser: t.integer(),
      maxNotificationsPerHour: t.integer(),
    }),
    default: {
      maxUploadSize: 10 * 1024 * 1024,
      maxJobsPerUser: 100,
      maxNotificationsPerHour: 60,
    },
  });

  public readonly pricingTiers = $parameter({
    name: "app.pricing.tiers",
    description: "Subscription tier configuration.",
    schema: t.object({
      free: t.object({ maxProjects: t.integer(), maxUsers: t.integer() }),
      pro: t.object({ maxProjects: t.integer(), maxUsers: t.integer() }),
      enterprise: t.object({
        maxProjects: t.integer(),
        maxUsers: t.integer(),
      }),
    }),
    default: {
      free: { maxProjects: 3, maxUsers: 1 },
      pro: { maxProjects: 25, maxUsers: 10 },
      enterprise: { maxProjects: 1000, maxUsers: 1000 },
    },
  });

  public readonly branding = $parameter({
    name: "app.branding",
    description: "Product branding applied in emails and headers.",
    schema: t.object({
      productName: t.text(),
      supportEmail: t.text({ format: "email" }),
      primaryColor: t.text(),
    }),
    default: {
      productName: "Alepha Playground",
      supportEmail: "support@alepha.dev",
      primaryColor: "#c96442",
    },
  });
}
