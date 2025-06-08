import { useAuth } from "@alepha/react-auth";
import {
	AppShell,
	Avatar,
	Button,
	Container,
	Flex,
	MantineProvider,
	Menu,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	IconChevronDown,
	IconLogout,
	IconMoon,
	IconSettings,
	IconSun,
} from "@tabler/icons-react";
import { useState } from "react";
import type { PostController } from "../api/PostController.ts";

const Hello = () => {
	const auth = useAuth();

	return (
		<MantineProvider>
			<AppShell header={{ height: 60 }}>
				<AppShell.Header>
					<Container h={"100%"}>
						<Flex h={"100%"} align="center" justify="center">
							<Flex flex={1}>
								<Title>Blog</Title>
							</Flex>
							<Flex gap={"sm"}>
								{!auth.user && (
									<Button onClick={() => auth.login()}>Login</Button>
								)}
								{auth.can<PostController>("createPost") && (
									<Button
										variant={"light"}
										onClick={() => {
											console.log("Admin clicked");
										}}
									>
										Admin
									</Button>
								)}
								{auth.user && (
									<Menu width={200}>
										<Menu.Target>
											<Button
												leftSection={
													<Avatar
														size={24}
														color={"cyan"}
														alt={"avatar"}
														src={auth.user.picture}
													/>
												}
												variant={"light"}
												rightSection={<IconChevronDown size={16} />}
											>
												{auth.user.name}
											</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<Menu.Label>Application</Menu.Label>
											<Menu.Item leftSection={<IconSettings size={14} />}>
												Settings
											</Menu.Item>
											<Menu.Item
												onClick={() => auth.logout()}
												leftSection={<IconLogout size={14} />}
											>
												Logout
											</Menu.Item>
										</Menu.Dropdown>
									</Menu>
								)}
								<ToggleDarkMode />
							</Flex>
						</Flex>
					</Container>
				</AppShell.Header>
				<AppShell.Main>
					<Container>
						<h1>Hello, Alepha!</h1>
						<p>Welcome to your Alepha blog.</p>
					</Container>
				</AppShell.Main>
			</AppShell>
		</MantineProvider>
	);
};

export default Hello;

const ToggleDarkMode = () => {
	const [dark, setDark] = useState(false);

	return (
		<Tooltip label={dark ? "Light mode" : "Dark mode"}>
			<Button
				onClick={() => {
					setDark(!dark);
					document.documentElement.setAttribute(
						"data-mantine-color-scheme",
						dark ? "light" : "dark",
					);
				}}
				variant={"subtle"}
			>
				{dark ? <IconSun /> : <IconMoon />}
			</Button>
		</Tooltip>
	);
};
