import { ClientOnly } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import {
	ActionIcon,
	Avatar,
	Button,
	Flex,
	Menu,
	Skeleton,
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
import type { AppRouter } from "../../AppRouter.ts";
import type { PostController } from "../../controllers/PostController.ts";
import { GoogleIcon } from "../icons/GoogleIcon.tsx";
import Go from "../shared/Go.tsx";

const Header = () => {
	const auth = useAuth();
	return (
		<Flex h={"100%"} align="center" justify="center">
			<Flex flex={1}>
				<Go<AppRouter> to={"home"} skipActiveCheck variant={"transparent"}>
					<Flex direction={"column"}>
						<Text size={"xs"} c={"dimmed"}>
							Alepha
						</Text>
						<Text size={"xl"} ff={"monospace"} mt={-10} fw={"bold"}>
							Blog
						</Text>
					</Flex>
				</Go>
				<Flex
					style={{
						position: "relative",
					}}
				>
					<img
						src={"/alepha.png"}
						style={{
							height: 50,
							width: 50,
							top: 10,
							left: -20,
							position: "absolute",
						}}
						alt={"logo"}
					/>
				</Flex>
			</Flex>

			<Flex gap={"sm"} align={"center"}>
				<ClientOnly
					disabled={!auth.user}
					fallback={
						<Button variant={"default"}>
							<Skeleton height={24} width={143} />
						</Button>
					}
				>
					{auth.can<PostController>("createPost") && (
						<Go<AppRouter>
							to={"newPost"}
							leftSection={<IconPlus size={16} />}
							variant={"filled"}
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
				</ClientOnly>
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
				<ActionIcon size={"lg"} variant={"transparent"}>
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
