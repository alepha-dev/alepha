import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * Example application parameters exercised by the parameters admin page.
 */
export class PlaygroundParameters {
  public readonly features = $parameter({
    name: "app.features",
    description: "Feature flags for the playground app.",
    schema: z.object({
      enableBeta: z.boolean(),
      enableExperimentalJobs: z.boolean(),
      enableDarkMode: z.boolean(),
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
    schema: z.object({
      maxUploadSize: z.integer().describe("Max upload size in bytes"),
      maxJobsPerUser: z.integer(),
      maxNotificationsPerHour: z.integer(),
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
    schema: z.object({
      free: z.object({ maxProjects: z.integer(), maxUsers: z.integer() }),
      pro: z.object({ maxProjects: z.integer(), maxUsers: z.integer() }),
      enterprise: z.object({
        maxProjects: z.integer(),
        maxUsers: z.integer(),
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
    schema: z.object({
      productName: z.text(),
      supportEmail: z.text({ format: "email" }),
      primaryColor: z.text(),
    }),
    default: {
      productName: "Alepha Playground",
      supportEmail: "support@alepha.dev",
      primaryColor: "#c96442",
    },
  });
}
