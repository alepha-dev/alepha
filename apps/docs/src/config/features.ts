import {
  IconApi,
  IconBox,
  IconBrandReact,
  IconBucket,
  IconChecklist,
  IconClock,
  IconCloud,
  IconCpu,
  IconDatabase,
  IconDeviceDesktop,
  IconFileText,
  IconHeartRateMonitor,
  IconLayoutDashboard,
  IconLink,
  IconLock,
  IconMail,
  IconMessage2,
  IconMessageCircle,
  IconPackage,
  IconPhone,
  IconRepeat,
  IconSeo,
  IconServer,
  IconShieldCheck,
  IconTool,
  IconUserCheck,
  IconUsers,
} from "@tabler/icons-react";

export const features = [
  // Server & API
  {
    icon: IconServer,
    title: "Server",
    description: "HTTP server with type-safe REST APIs.",
    slug: "packages-alepha-server",
  },
  {
    icon: IconApi,
    title: "OpenAPI",
    description: "Auto-generated API documentation.",
    slug: "packages-alepha-server-swagger",
  },
  {
    icon: IconShieldCheck,
    title: "Security",
    description: "Realms, roles, and permissions.",
    slug: "packages-alepha-security",
  },

  // Data
  {
    icon: IconDatabase,
    title: "ORM",
    description: "Type-safe database queries with Drizzle.",
    slug: "packages-alepha-orm",
  },
  {
    icon: IconBox,
    title: "Cache",
    description: "In-memory or Redis caching.",
    slug: "packages-alepha-cache",
  },
  {
    icon: IconBucket,
    title: "Bucket",
    description: "File storage for local, Azure, or Vercel.",
    slug: "packages-alepha-bucket",
  },

  // Background
  {
    icon: IconMessage2,
    title: "Queue",
    description: "Background job processing with retries.",
    slug: "packages-alepha-queue",
  },
  {
    icon: IconClock,
    title: "Scheduler",
    description: "Cron-based scheduled tasks.",
    slug: "packages-alepha-scheduler",
  },
  {
    icon: IconChecklist,
    title: "Jobs",
    description: "Scheduler with DB execution history.",
    slug: "packages-alepha-api-jobs",
  },

  // React
  {
    icon: IconBrandReact,
    title: "React",
    description: "SSR, CSR, or SSG with routing.",
    slug: "packages-react-core",
  },
  {
    icon: IconSeo,
    title: "Head",
    description: "Document head and SEO metadata.",
    slug: "packages-react-head",
  },
  {
    icon: IconUserCheck,
    title: "Auth UI",
    description: "Ready-to-use authentication components.",
    slug: "packages-react-auth",
  },

  // Communication
  {
    icon: IconMail,
    title: "Email",
    description: "Send emails with templates.",
    slug: "packages-alepha-email",
  },
  {
    icon: IconPhone,
    title: "SMS",
    description: "Send SMS messages.",
    slug: "packages-alepha-sms",
  },
  {
    icon: IconMessageCircle,
    title: "Topic",
    description: "Pub/sub messaging.",
    slug: "packages-alepha-topic",
  },

  // Utilities
  {
    icon: IconLink,
    title: "Links",
    description: "Type-safe API client.",
    slug: "packages-alepha-server-links",
  },
  {
    icon: IconLock,
    title: "Lock",
    description: "Distributed locking.",
    slug: "packages-alepha-lock",
  },
  {
    icon: IconRepeat,
    title: "Retry",
    description: "Retry failed operations.",
    slug: "packages-alepha-retry",
  },
  {
    icon: IconPackage,
    title: "Batch",
    description: "Group operations together.",
    slug: "packages-alepha-batch",
  },

  // APIs
  {
    icon: IconUsers,
    title: "Users API",
    description: "Multi-realm user management.",
    slug: "packages-alepha-api-users",
  },
  {
    icon: IconFileText,
    title: "Files API",
    description: "File upload and download.",
    slug: "packages-alepha-api-files",
  },

  // Dev & Ops
  {
    icon: IconTool,
    title: "Command",
    description: "CLI task runner.",
    slug: "packages-alepha-command",
  },
  {
    icon: IconHeartRateMonitor,
    title: "Health",
    description: "Health check endpoints.",
    slug: "packages-alepha-server-health",
  },
  {
    icon: IconDeviceDesktop,
    title: "DevTools",
    description: "Inspect actions, queues, logs.",
    slug: "packages-devtools",
  },
  {
    icon: IconLayoutDashboard,
    title: "Admin UI",
    description: "Auto-generated admin panel.",
    slug: "packages-ui-admin",
  },
  {
    icon: IconCloud,
    title: "Deploy",
    description: "Docker, Vercel, or VPS.",
    slug: "guides-operations-deployment",
  },
  {
    icon: IconCpu,
    title: "Thread",
    description: "Multi-threading utilities.",
    slug: "packages-alepha-thread",
  },
];
