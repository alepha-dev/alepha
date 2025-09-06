import {
	IconApi,
	IconArrowsExchange,
	IconBolt,
	IconBox,
	IconBrandReact,
	IconBucket,
	IconChartBar,
	IconClock,
	IconCode,
	IconCommand,
	IconComponents,
	IconCookie,
	IconDatabase,
	IconFile,
	IconFileZip,
	IconForms,
	IconHeartbeat,
	IconHelmet,
	IconLanguage,
	IconLineDashed,
	IconLink,
	IconLock,
	IconMessage2,
	IconMessageCircle,
	IconNotes,
	IconPackage,
	IconRepeat,
	IconServer,
	IconServerBolt,
	IconServerSpark,
	IconShieldCheck,
	IconTestPipe,
	IconTower,
	IconUserCheck,
	IconWorldWww,
} from "@tabler/icons-react";
import { createElement } from "react";

export const iconByName = (name: string, props: any = {}) => {
	const size = 16;
	const iconName = name
		.replace(" Redis", "")
		.toLowerCase()
		.split(" ")
		.slice(-1)[0];

	const icon = keywordToIconMap[iconName];
	if (name === "Alepha Redis") {
		return createElement(IconDatabase, { size, ...props });
	}
	if (!icon) {
		return null;
	}

	return createElement(icon, { size, ...props });
};

const keywordToIconMap: Record<string, any> = {
	// Core & Core concepts
	core: IconBox,
	router: IconWorldWww,
	datetime: IconClock,
	file: IconFile,
	logger: IconNotes,

	// Application Layers
	server: IconServer,
	react: IconBrandReact,
	postgres: IconDatabase,
	command: IconCommand,

	// Backend Abstractions & Patterns
	batch: IconPackage,
	bucket: IconBucket,
	cache: IconServerBolt, // Represents in-memory storage
	lock: IconLock,
	queue: IconMessage2,
	retry: IconRepeat,
	scheduler: IconClock,
	security: IconShieldCheck,
	thread: IconLineDashed,
	topic: IconMessageCircle,

	// Concrete Implementations (drivers)
	azure: IconBucket, // Inherits from bucket
	vercel: IconBucket, // Inherits from bucket
	redis: IconDatabase, // Represents a data store

	// Server Plugins
	compress: IconFileZip,
	cookies: IconCookie,
	cors: IconArrowsExchange,
	health: IconHeartbeat,
	helmet: IconHelmet,
	limit: IconTower,
	links: IconLink,
	metrics: IconChartBar,
	multipart: IconFile, // Represents file uploads
	static: IconFile,
	swagger: IconApi,
	proxy: IconServerSpark,

	// React Ecosystem
	auth: IconUserCheck,
	form: IconForms,
	head: IconCode,
	i18n: IconLanguage,

	// Development & Tooling
	protobuf: IconComponents, // Represents data structures/components
	testing: IconTestPipe,
	vite: IconBolt,
};
