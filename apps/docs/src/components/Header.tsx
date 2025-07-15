import { Link } from "@alepha/react";
import {
	ActionIcon,
	Burger,
	Button,
	Container,
	Divider,
	Flex,
	Image,
	Kbd,
	Menu,
	Text,
	useMantineColorScheme,
} from "@mantine/core";
import {
	IconBrandGithub,
	IconCheck,
	IconDeviceLaptop,
	IconMoon,
	IconSearch,
	IconSun,
} from "@tabler/icons-react";
import { theme } from "../config/theme.ts";

type Props = {
	opened?: boolean;
	toggle?: () => void;
};

const Header = (props: Props) => {
	return (
		<Container fluid px={0} h={"100%"}>
			<Flex
				h={"100%"}
				align={"center"}
				px={"lg"}
				gap={{ base: "xs", md: "lg" }}
			>
				<Burger
					opened={props.opened}
					onClick={props.toggle}
					size="sm"
					hiddenFrom={theme.sidebarBreakpoint}
				/>

				<HomeButton />

				<Flex flex={1}></Flex>

				<Button
					visibleFrom={"md"}
					variant={"subtle"}
					component={Link}
					to={"/docs/introduction"}
				>
					Guide
				</Button>
				<Divider visibleFrom={"md"} orientation={"vertical"} />
				<Flex visibleFrom={"md"}>
					<SearchButton />
				</Flex>
				<Divider visibleFrom={"md"} orientation={"vertical"} />

				<ActionIcon
					size={"lg"}
					variant={"default"}
					component={"a"}
					href={"https://github.com/feunard/alepha"}
				>
					<IconBrandGithub />
				</ActionIcon>

				<DarkModeButton />
			</Flex>
		</Container>
	);
};

export default Header;

const SearchButton = () => {
	return (
		<Button
			leftSection={<IconSearch size={16} />}
			variant={"default"}
			c={"dimmed"}
			rightSection={<Kbd>Ctrl K</Kbd>}
		>
			Search...
		</Button>
	);
};

const HomeButton = () => {
	return (
		<>
			<Button
				size={"xs"}
				variant={"transparent"}
				component={Link}
				to={"/"}
				hiddenFrom={"md"}
			>
				<Flex direction={"column"} align={"start"}>
					<Text fw={"bold"} ff={"monospace"} size={"md"}>
						Alepha
					</Text>
					<Text size={"xs"} c={"dimmed"} mt={-8} fw={"300"}>
						Docs
					</Text>
				</Flex>
			</Button>

			<Button
				size={"xl"}
				variant={"transparent"}
				component={Link}
				to={"/"}
				visibleFrom={"md"}
			>
				<Flex>
					<Image
						src={`${import.meta.env.BASE_URL}logo.png`}
						alt={"logo"}
						width={64}
						height={64}
					/>
				</Flex>
				<Flex direction={"column"}>
					<Text fw={"bold"} ff={"monospace"} size={"xl"}>
						Alepha
					</Text>
					<Text size={"xs"} c={"dimmed"} mt={-8} fw={"300"}>
						Documentation
					</Text>
				</Flex>
			</Button>
		</>
	);
};

const DarkModeButton = () => {
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	return (
		<Menu position={"bottom-end"}>
			<Menu.Target>
				<ActionIcon size={"lg"} variant={"default"}>
					<IconMoon />
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
