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
    slug: "server",
  },
  {
    icon: IconApi,
    title: "OpenAPI",
    description: "Generates OpenAPI documentation for APIs.",
    slug: "server-swagger",
  },
  {
    icon: IconShieldCheck,
    title: "Security",
    description: "Manage realms, roles, permissions.",
    slug: "server-security",
  },

  {
    icon: IconDatabase,
    title: "Database ORM",
    description: "A type-safe SQL query builder and ORM.",
    slug: "postgres",
  },
  {
    icon: IconBucket,
    title: "Bucket",
    description: "A universal interface for object storages.",
    slug: "bucket",
  },
  {
    icon: IconBox,
    title: "Cache",
    description: "A generic key-value caching interface.",
    slug: "cache",
  },

  {
    icon: IconMessage2,
    title: "Queue",
    description: "A powerful interface for message queueing systems.",
    slug: "queue",
  },
  {
    icon: IconMessageCircle,
    title: "Topic",
    description: "A publish-subscribe messaging interface.",
    slug: "topic",
  },
  {
    icon: IconClock,
    title: "Scheduler",
    description: "Schedule recurring tasks using cron expressions.",
    slug: "scheduler",
  },

  {
    icon: IconBrandReact,
    title: "React",
    description: "Build SSR, CSR or SSG applications.",
    slug: "react",
  },
  {
    icon: IconSeo,
    title: "SEO",
    description: "Manages the document <head> and metadata.",
    slug: "react-head",
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
    slug: "server-links",
  },
  {
    icon: IconLock,
    title: "Locking",
    description: "Resource locking and synchronization.",
    slug: "lock",
  },
  {
    icon: IconRepeat,
    title: "Retry",
    description: "Simple, declarative retry for failed operations.",
    slug: "retry",
  },
  {
    icon: IconPackage,
    title: "Batch",
    description: "Efficiently process operations in groups.",
    slug: "batch",
  },
  {
    icon: IconTool,
    title: "Command",
    description: "A versatile task runner for scripts.",
    slug: "command",
  },
  {
    icon: IconMail,
    title: "Email",
    description: "Create and send templated email.",
    slug: "email",
  },
];
