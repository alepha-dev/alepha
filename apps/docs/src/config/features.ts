import {
  IconApi,
  IconBox,
  IconBrandReact,
  IconBucket,
  IconClock,
  IconDatabase,
  IconLink,
  IconLock,
  IconMail,
  IconMessage2,
  IconMessageCircle,
  IconPackage,
  IconRepeat,
  IconSeo,
  IconServer,
  IconShieldCheck,
  IconTool,
  IconUserCheck,
} from "@tabler/icons-react";

export const features = [
  {
    icon: IconServer,
    title: "Server",
    description: "Core HTTP server for creating REST APIs.",
    slug: "packages-alepha-server",
  },
  {
    icon: IconApi,
    title: "OpenAPI",
    description: "Generates OpenAPI documentation for APIs.",
    slug: "packages-alepha-server-swagger",
  },
  {
    icon: IconShieldCheck,
    title: "Security",
    description: "Manage realms, roles, permissions.",
    slug: "packages-alepha-server-security",
  },

  {
    icon: IconDatabase,
    title: "Database ORM",
    description: "A type-safe SQL query builder and ORM.",
    slug: "packages-alepha-orm",
  },
  {
    icon: IconBucket,
    title: "Bucket",
    description: "A universal interface for object storages.",
    slug: "packages-alepha-bucket",
  },
  {
    icon: IconBox,
    title: "Cache",
    description: "A generic key-value caching interface.",
    slug: "packages-alepha-cache",
  },

  {
    icon: IconMessage2,
    title: "Queue",
    description: "A powerful interface for message queueing systems.",
    slug: "packages-alepha-queue",
  },
  {
    icon: IconMessageCircle,
    title: "Topic",
    description: "A publish-subscribe messaging interface.",
    slug: "packages-alepha-topic",
  },
  {
    icon: IconClock,
    title: "Scheduler",
    description: "Schedule recurring tasks using cron expressions.",
    slug: "packages-alepha-scheduler",
  },

  {
    icon: IconBrandReact,
    title: "React",
    description: "Build SSR, CSR or SSG applications.",
    slug: "packages-react-core",
  },
  {
    icon: IconSeo,
    title: "SEO",
    description: "Manages the document <head> and metadata.",
    slug: "packages-react-head",
  },
  {
    icon: IconUserCheck,
    title: "Auth",
    description: "Simplifies user authentication flows.",
    slug: "react-auth",
  },
  {
    icon: IconLink,
    title: "Links",
    description: "Type-safe communication between services.",
    slug: "packages-alepha-server-links",
  },
  {
    icon: IconLock,
    title: "Locking",
    description: "Resource locking and synchronization.",
    slug: "packages-alepha-lock",
  },
  {
    icon: IconRepeat,
    title: "Retry",
    description: "Simple, declarative retry for failed operations.",
    slug: "packages-alepha-retry",
  },
  {
    icon: IconPackage,
    title: "Batch",
    description: "Efficiently process operations in groups.",
    slug: "packages-alepha-batch",
  },
  {
    icon: IconTool,
    title: "Command",
    description: "A versatile task runner for scripts.",
    slug: "packages-alepha-command",
  },
  {
    icon: IconMail,
    title: "Email",
    description: "Create and send templated email.",
    slug: "packages-alepha-email",
  },
];
