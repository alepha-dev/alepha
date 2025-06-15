import { useAuth } from "@alepha/react-auth";
import {
	ActionIcon,
	Avatar,
	Button,
	Flex,
	Menu,
	Text,
	useMantineColorScheme,
} from "@mantine/core";
import {
	IconCheck,
	IconChevronDown,
	IconDeviceLaptop,
	IconLogout,
	IconMoon,
	IconPlus,
	IconSun,
} from "@tabler/icons-react";
import type { Blog } from "../Blog.ts";
import type { PostController } from "../controllers/PostController.ts";
import Go from "./Go.tsx";
import { GoogleIcon } from "./icons/GoogleIcon.tsx";

const Header = () => {
	const auth = useAuth();

	return (
		<Flex h={"100%"} align="center" justify="center">
			<Flex flex={1}>
				<Go<Blog> to={"home"} variant={"transparent"} skipActiveCheck>
					<Text size={"xl"} c={"orange"}>
						Alepha Blog
					</Text>
				</Go>
			</Flex>
			<Flex gap={"sm"} align={"center"}>
				{!auth.user && (
					<Button
						variant={"default"}
						leftSection={<GoogleIcon />}
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
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	return (
		<Menu>
			<Menu.Target>
				<ActionIcon color={"dark"} size={"lg"} variant={"transparent"}>
					{<IconMoon />}
				</ActionIcon>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Item
					leftSection={<IconSun size={16} />}
					rightSection={colorScheme === "light" && <IconCheck size={16} />}
					onClick={() => setColorScheme("light")}
				>
					Light
				</Menu.Item>
				<Menu.Item
					leftSection={<IconMoon size={16} />}
					rightSection={colorScheme === "dark" && <IconCheck size={16} />}
					onClick={() => setColorScheme("dark")}
				>
					Dark
				</Menu.Item>
				<Menu.Item
					leftSection={<IconDeviceLaptop size={16} />}
					rightSection={colorScheme === "auto" && <IconCheck size={16} />}
					onClick={() => setColorScheme("auto")}
				>
					System
				</Menu.Item>
			</Menu.Dropdown>
		</Menu>
	);
};
