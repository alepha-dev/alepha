import { NestedView, useRouter } from "@alepha/react";
import { Card, Container, Flex, Stack, Text, Title } from "@mantine/core";
import { IconDatabase, IconUsers } from "@tabler/icons-react";
import { theme } from "../../constants/theme.ts";
import Action, { type ActionProps } from "../ui/Action.tsx";
import type { AdminRouter } from "./AdminRouter.ts";

const AdminLayout = () => {
	return (
		<Container w={theme.container} flex={1} className={"overflow-auto"}>
			<Stack flex={1} w={"100%"}>
				<Card
					withBorder
					className={"shadow"}
					flex={1}
					p={"md"}
					px={"lg"}
					bg={theme.colors.panel}
				>
					<Title order={2}>Admin Panel</Title>
					<Text size="sm" c="dimmed">
						Manage users and projects across the platform
					</Text>
				</Card>
				<Flex
					className={"overflow-auto"}
					flex={1}
					gap={"lg"}
					direction={{
						base: "column",
						md: "row",
					}}
				>
					<Flex
						h={"100%"}
						w={{
							base: "100%",
							md: "196px",
						}}
					>
						<AdminMenu />
					</Flex>
					<Flex flex={1} className={"overflow-auto"}>
						<NestedView />
					</Flex>
				</Flex>
			</Stack>
		</Container>
	);
};

export default AdminLayout;

const AdminMenu = () => {
	const adminRouter = useRouter<AdminRouter>();

	return (
		<Card
			withBorder
			bg={theme.colors.app}
			p={"xs"}
			w={{
				base: "100%",
				md: "196px",
			}}
		>
			<Flex
				flex={1}
				gap={"xs"}
				direction={{
					base: "row",
					md: "column",
				}}
			>
				<Text visibleFrom={"md"} size="xs">
					Resources
				</Text>
				<ActionNavLink
					leftSection={<IconUsers size={20} />}
					href={adminRouter.path("users")}
				>
					Users
				</ActionNavLink>
				<ActionNavLink
					leftSection={<IconDatabase size={20} />}
					href={adminRouter.path("projects")}
				>
					Projects
				</ActionNavLink>
			</Flex>
		</Card>
	);
};

const ActionNavLink = (props: ActionProps & { href: string }) => {
	return (
		<Action
			size={"xs"}
			textVisibleFrom={"sm"}
			justify={"flex-start"}
			variant={"minimal"}
			{...props}
		>
			{props.children}
		</Action>
	);
};
