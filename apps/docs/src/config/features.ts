import {
  IconApi,
  IconBox,
  IconBrandReact,
  IconBucket,
  IconChecklist,
  IconClock,
  IconCloud,
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
  IconPlugConnected,
  IconRepeat,
  IconRobot,
  IconSeo,
  IconServer,
  IconShieldCheck,
  IconTool,
  IconUserCheck,
  IconUsers,
} from "@tabler/icons-react";

export const coreFeatures = [
  // Server & API
  {
    icon: IconServer,
    title: "Server",
    module: "alepha/server",
    description: "HTTP server with type-safe REST APIs.",
    slug: "packages-alepha-server-core",
  },
  {
    icon: IconApi,
    title: "OpenAPI",
    module: "alepha/server-swagger",
    description: "Auto-generated API documentation.",
    slug: "packages-alepha-server-swagger",
  },
  {
    icon: IconShieldCheck,
    title: "Security",
    module: "alepha/security",
    description: "Realms, roles, and permissions.",
    slug: "packages-alepha-security",
  },
  {
    icon: IconRobot,
    title: "MCP",
    module: "alepha/mcp",
    description: "Model Context Protocol for AI agents.",
    slug: "packages-alepha-mcp",
    new: true,
  },

  // Data
  {
    icon: IconDatabase,
    title: "ORM",
    module: "alepha/orm",
    description: "Type-safe database queries with Drizzle.",
    slug: "packages-alepha-orm",
  },
  {
    icon: IconBox,
    title: "Cache",
    module: "alepha/cache",
    description: "In-memory or Redis caching.",
    slug: "packages-alepha-cache-core",
  },
  {
    icon: IconBucket,
    title: "Bucket",
    module: "alepha/bucket",
    description: "File storage for local, S3, etc.",
    slug: "packages-alepha-bucket",
  },

  // Background
  {
    icon: IconMessage2,
    title: "Queue",
    module: "alepha/queue",
    description: "Background job processing with retries.",
    slug: "packages-alepha-queue-core",
  },
  {
    icon: IconClock,
    title: "Scheduler",
    module: "alepha/scheduler",
    description: "Cron-based scheduled tasks.",
    slug: "packages-alepha-scheduler",
  },

  // React
  {
    icon: IconBrandReact,
    title: "React",
    module: "alepha/react",
    description: "SSR, CSR, or SSG with routing.",
    slug: "packages-alepha-react-core",
  },
  {
    icon: IconSeo,
    title: "Head",
    module: "alepha/react/head",
    description: "Document head and SEO metadata.",
    slug: "packages-alepha-react-head",
  },

  // Communication
  {
    icon: IconMail,
    title: "Email",
    module: "alepha/email",
    description: "Send emails with templates.",
    slug: "packages-alepha-email",
  },
  {
    icon: IconPhone,
    title: "SMS",
    module: "alepha/sms",
    description: "Send SMS messages.",
    slug: "packages-alepha-sms",
  },
  {
    icon: IconMessageCircle,
    title: "Topic",
    module: "alepha/topic",
    description: "Pub/sub messaging.",
    slug: "packages-alepha-topic-core",
  },
  {
    icon: IconPlugConnected,
    title: "WebSocket",
    module: "alepha/websocket",
    description: "Real-time bidirectional communication.",
    slug: "packages-alepha-websocket",
  },

  // Utilities
  {
    icon: IconLink,
    title: "Links",
    module: "alepha/server-links",
    description: "Type-safe API client.",
    slug: "packages-alepha-server-links",
  },
  {
    icon: IconLock,
    title: "Lock",
    module: "alepha/lock",
    description: "Distributed locking.",
    slug: "packages-alepha-lock-core",
  },
  {
    icon: IconRepeat,
    title: "Retry",
    module: "alepha/retry",
    description: "Retry failed operations.",
    slug: "packages-alepha-retry",
  },
  {
    icon: IconPackage,
    title: "Batch",
    module: "alepha/batch",
    description: "Group operations together.",
    slug: "packages-alepha-batch",
  },

  // Dev & Ops
  {
    icon: IconTool,
    title: "Command",
    module: "alepha/command",
    description: "CLI task runner.",
    slug: "packages-alepha-command",
  },
  {
    icon: IconHeartRateMonitor,
    title: "Health",
    module: "alepha/server-health",
    description: "Health check endpoints.",
    slug: "packages-alepha-server-health",
  },
  {
    icon: IconDeviceDesktop,
    title: "DevTools",
    module: "alepha/devtools",
    description: "Inspect actions, queues, logs.",
    slug: "packages-alepha-devtools",
  },
  {
    icon: IconCloud,
    title: "Deploy",
    module: null,
    description: "Docker, Cloudflare, and more.",
    slug: "guides-production-overview",
  },
];

export const apiFeatures = [
  {
    icon: IconUsers,
    title: "Users API",
    module: "alepha/api/users",
    description: "Multi-realm user management.",
    slug: "packages-alepha-api-users",
  },
  {
    icon: IconUserCheck,
    title: "Auth UI",
    module: "@alepha/ui/auth",
    description: "Ready-to-use authentication components.",
    slug: "packages-alepha-ui-auth",
  },
  {
    icon: IconFileText,
    title: "Files API",
    module: "alepha/api/files",
    description: "File upload and download.",
    slug: "packages-alepha-api-files",
  },
  {
    icon: IconChecklist,
    title: "Jobs API",
    module: "alepha/api/jobs",
    description: "Scheduler with DB execution history.",
    slug: "packages-alepha-api-jobs",
  },
  {
    icon: IconLayoutDashboard,
    title: "Admin UI",
    module: "@alepha/ui/admin",
    description: "Auto-generated admin panel.",
    slug: "packages-alepha-ui-admin",
  },
];
