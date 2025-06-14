import { useAuth } from "@alepha/react-auth";
import { ActionIcon, Avatar, Button, Flex, Menu, Tooltip } from "@mantine/core";
import {
	IconBrandGoogleFilled,
	IconChevronDown,
	IconHome,
	IconLogout,
	IconMoon,
	IconPlus,
	IconSun,
} from "@tabler/icons-react";
import { useState } from "react";
import type { Blog } from "../Blog.ts";
import type { PostController } from "../controllers/PostController.ts";
import Go from "./Go.tsx";

const Header = () => {
	const auth = useAuth();

	return (
		<Flex h={"100%"} align="center" justify="center">
			<Flex flex={1}>
				<Go<Blog> to={"home"} leftSection={<IconHome />} variant={"subtle"}>
					Home
				</Go>
			</Flex>
			<Flex gap={"sm"} align={"center"}>
				{!auth.user && (
					<Button
						variant={"outline"}
						leftSection={<IconBrandGoogleFilled />}
						radius={"xl"}
						onClick={() => auth.login()}
					>
						Sign in with Google
					</Button>
				)}
				{auth.can<PostController>("createPost") && (
					<Go<Blog>
						to={"newPost"}
						leftSection={<IconPlus size={16} />}
						variant={"subtle"}
					>
						New Post
					</Go>
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
									>
										NF
									</Avatar>
								}
								variant={"outline"}
								rightSection={<IconChevronDown size={16} />}
							>
								{auth.user.name}
							</Button>
						</Menu.Target>
						<Menu.Dropdown>
							<Menu.Label>Application</Menu.Label>
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
	);
};

export default Header;

const ToggleDarkMode = () => {
	const [dark, setDark] = useState(false);

	return (
		<Tooltip label={dark ? "Light mode" : "Dark mode"}>
			<ActionIcon
				size={"lg"}
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
			</ActionIcon>
		</Tooltip>
	);
};
