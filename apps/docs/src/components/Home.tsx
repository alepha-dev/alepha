import { Link } from "@alepha/react";
import {
	Alert,
	Anchor,
	Button,
	Container,
	Flex,
	Group,
	Paper,
	SimpleGrid,
	Tabs,
	Text,
	ThemeIcon,
	Title,
	UnstyledButton,
} from "@mantine/core";
import { useSessionStorage } from "@mantine/hooks";
import {
	IconAlertTriangle,
	IconApi,
	IconBook,
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
	IconPlayerPlay,
	IconRepeat,
	IconSeo,
	IconServer,
	IconShieldCheck,
	IconTool,
	IconTools,
	IconUserCheck,
} from "@tabler/icons-react";
import { snippets } from "../config/docs.ts";

const features = [
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

const Home = () => {
	return (
		<Flex
			align={"center"}
			direction={"column"}
			w={"100%"}
			className={"graph-paper"}
		>
			<AlphaWarning />
			<HeroSection />
			<FeatureGrid />
		</Flex>
	);
};

export default Home;

const FeatureGrid = () => (
	<Container size="lg" py="xl" w={"100%"}>
		<Title order={2} ta="center" mb="xl">
			A Complete Toolkit for Modern Applications
		</Title>
		<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xl">
			{features.map((feature) => (
				<UnstyledButton
					style={{ opacity: feature.disabled ? 0.3 : 1 }}
					size={"xl"}
					component={Link}
					to={feature.disabled ? "/" : `/docs/alepha-${feature.slug}`}
					flex={1}
					key={feature.title}
				>
					<Flex direction={"row"} gap="md">
						<ThemeIcon variant="light" size={40} radius="md">
							<feature.icon size={24} />
						</ThemeIcon>
						<div>
							<Text fw={700}>{feature.title}</Text>
							<Text size="sm" c="dimmed">
								{feature.description}
							</Text>
						</div>
					</Flex>
				</UnstyledButton>
			))}
		</SimpleGrid>
	</Container>
);

const AlphaWarning = () => {
	const [hide, setHide] = useSessionStorage<boolean>({
		key: "warning.not-ready-yet",
		defaultValue: false,
	});

	if (hide) return null;

	return (
		<Container size="lg" my="xl">
			<Alert
				withCloseButton={true}
				onClick={() => {
					setHide(true);
				}}
				icon={<IconAlertTriangle size={24} />}
				title="Not Ready for Production"
				color="orange"
				radius="md"
			>
				<Text>
					Welcome, early adopter! While the documentation is taking shape,
					Alepha itself is in an early and active development stage. The API is
					subject to change, and it is not yet recommended for production use.
				</Text>
				<Text mt="xs">
					Your feedback is invaluable. Please feel free to{" "}
					<Anchor
						href="https://github.com/feunard/alepha/issues"
						target="_blank"
					>
						report issues or suggest features
					</Anchor>{" "}
					on GitHub.
				</Text>
			</Alert>
		</Container>
	);
};
const HeroSection = () => (
	<Container size="xl" style={{ minHeight: "85vh", display: "flex" }}>
		<Flex direction="column" justify="center">
			<SimpleGrid cols={{ lg: 2 }} spacing={"xl"}>
				<HeroSectionMessage />
				<ShowcaseSection />
			</SimpleGrid>
		</Flex>
	</Container>
);

const HeroSectionMessage = () => {
	return (
		<Flex
			direction="column"
			justify="center"
			align="center"
			style={{ textAlign: "center" }}
		>
			<Title
				order={1}
				style={{
					fontSize: "clamp(2.5rem, 5vw, 4.5rem)", // Responsive font size
					fontWeight: 900,
					letterSpacing: "-1.5px",
				}}
				mb="md"
			>
				Build with{" "}
				<Text
					component="span"
					variant="gradient"
					gradient={{ from: "teal", to: "cyan" }}
					inherit
				>
					Clarity.
				</Text>
			</Title>

			<Text c="dimmed" size="xl" maw={600} mb="xl">
				Alepha is a convention-driven TypeScript framework for building robust,
				end-to-end type-safe applications, from serverless APIs to full-stack
				React apps.
			</Text>

			<Group>
				<Button
					size="lg"
					radius="xl"
					leftSection={<IconPlayerPlay size={20} />}
					component={Link}
					to="/docs/introduction"
				>
					Get Started
				</Button>
				<Button
					variant="default"
					size="lg"
					radius="xl"
					leftSection={<IconBook size={20} />}
					component={Link}
					to="/docs/alepha-core"
				>
					Explore Packages
				</Button>
			</Group>
		</Flex>
	);
};

const ShowcaseSection = () => (
	<Paper withBorder shadow="md">
		<Tabs defaultValue="server" radius="md">
			<Tabs.List grow>
				<Tabs.Tab value="server" leftSection={<IconServer size={16} />}>
					API Server
				</Tabs.Tab>
				<Tabs.Tab value="react" leftSection={<IconBrandReact size={16} />}>
					Full-Stack React
				</Tabs.Tab>
				<Tabs.Tab value="db" leftSection={<IconDatabase size={16} />}>
					Database
				</Tabs.Tab>
				<Tabs.Tab value="queue" leftSection={<IconMessage2 size={16} />}>
					Queues
				</Tabs.Tab>
				<Tabs.Tab value="cli" leftSection={<IconTools size={16} />}>
					CLI
				</Tabs.Tab>
			</Tabs.List>

			<Tabs.Panel value="server">
				<CodeSection content={snippets.server} />
			</Tabs.Panel>
			<Tabs.Panel value="react">
				<CodeSection content={snippets.react} />
			</Tabs.Panel>
			<Tabs.Panel value="db">
				<CodeSection content={snippets.db} />
			</Tabs.Panel>
			<Tabs.Panel value="queue">
				<CodeSection content={snippets.queue} />
			</Tabs.Panel>
			<Tabs.Panel value="cli">
				<CodeSection content={snippets.command} />
			</Tabs.Panel>
		</Tabs>
	</Paper>
);

const CodeSection = (props: { content: string }) => (
	<div
		// biome-ignore lint/security/noDangerouslySetInnerHtml: _
		dangerouslySetInnerHTML={{ __html: props.content }}
	/>
);
