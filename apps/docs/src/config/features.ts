import {
	IconApi,
	IconBox,
	IconBrandReact,
	IconBucket,
	IconClock,
	IconDatabase,
	IconLink,
	IconLock,
	IconMessage2,
	IconMessageCircle,
	IconNotification,
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
		description: "Generates OpenAPI documentation and a Swagger UI for APIs.",
		slug: "server-swagger",
	},
	{
		icon: IconShieldCheck,
		title: "Security",
		description:
			"Manage realms, roles, permissions, and JWT-based authentication.",
		slug: "server-security",
	},

	{
		icon: IconDatabase,
		title: "Database ORM",
		description: "A type-safe SQL query builder and ORM using Drizzle.",
		slug: "postgres",
	},
	{
		icon: IconBucket,
		title: "Bucket",
		description: "A universal interface for object and file storage providers.",
		slug: "bucket",
	},
	{
		icon: IconBox,
		title: "Cache",
		description:
			"A generic key-value caching interface with in-memory implementation.",
		slug: "cache",
	},

	{
		icon: IconMessage2,
		title: "Queue",
		description: "A simple, powerful interface for message queueing systems.",
		slug: "queue",
	},
	{
		icon: IconMessageCircle,
		title: "Topic",
		description:
			"A publish-subscribe (pub/sub) messaging interface for eventing.",
		slug: "topic",
	},
	{
		icon: IconClock,
		title: "Scheduler",
		description:
			"Schedule recurring tasks using cron expressions or fixed intervals.",
		slug: "scheduler",
	},

	{
		icon: IconBrandReact,
		title: "React",
		description:
			"Build server-side rendered (SSR) or single-page React applications.",
		slug: "react",
	},
	{
		icon: IconSeo,
		title: "SEO",
		description: "Manages the document <head> for SEO and metadata.",
		slug: "react-head",
	},
	{
		icon: IconUserCheck,
		title: "Auth",
		description: "Simplifies user authentication flows in React applications.",
		slug: "react-auth",
	},
	{
		icon: IconLink,
		title: "Links",
		description: "Enables type-safe communication between different services.",
		slug: "server-links",
	},
	{
		icon: IconLock,
		title: "Locking",
		description:
			"Distributed mutex and semaphore for resource locking and synchronization.",
		slug: "lock",
	},
	{
		icon: IconRepeat,
		title: "Retry",
		description:
			"Simple, declarative, and powerful automatic retry for failed operations.",
		slug: "retry",
	},
	{
		icon: IconPackage,
		title: "Batch",
		description: "Efficiently process operations in groups by size or time.",
		slug: "batch",
	},
	{
		icon: IconTool,
		title: "Command",
		description:
			"A versatile task runner for scripts and automation workflows.",
		slug: "command",
	},
	{
		icon: IconNotification,
		disabled: true,
		title: "Notification",
		description: "Create and send templated email or mobile notifications.",
		slug: "notification",
	},
];
