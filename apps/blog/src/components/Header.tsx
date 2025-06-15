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
import SearchBar from "./SearchBar.tsx";
import { GoogleIcon } from "./icons/GoogleIcon.tsx";

const Header = () => {
	const auth = useAuth();
	return (
		<Flex h={"100%"} align="center" justify="center">
			<Flex flex={1}>
				<Go<Blog> to={"home"} skipActiveCheck variant={"transparent"}>
					<Flex direction={"column"}>
						<Text fw={"bold"} size={"xl"}>
							Alepha Blog
						</Text>
						<Text c={"dimmed"} size={"xs"} mt={-10}>
							or something like that
						</Text>
					</Flex>
				</Go>
			</Flex>
			<Flex gap={"sm"} align={"center"}>
				<SearchBar />
				{auth.can<PostController>("createPost") && (
					<Go<Blog>
						to={"newPost"}
						leftSection={<IconPlus size={16} />}
						variant={"default"}
					>
						New Post
					</Go>
				)}
				{!auth.user && (
					<Button
						variant={"default"}
						leftSection={<GoogleIcon />}
						onClick={() => auth.login()}
					>
						Sign in with Google
					</Button>
				)}
				{auth.user && (
					<Menu width={200}>
						<Menu.Target>
							<Button
								leftSection={
									<Avatar size={24} color={"orange"} alt={"avatar"}>
										{auth.user.name
											?.split(" ")
											.map((it) => it.charAt(0).toUpperCase())
											.join("")}
									</Avatar>
								}
								variant={"default"}
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
		<Menu position={"bottom-end"}>
			<Menu.Target>
				<ActionIcon size={"lg"} variant={"default"}>
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
