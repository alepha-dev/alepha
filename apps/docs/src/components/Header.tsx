import { Link, useRouter } from "@alepha/react";
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
import { Spotlight, spotlight } from "@mantine/spotlight";
import {
	IconBrandGithub,
	IconCheck,
	IconDeviceLaptop,
	IconMoon,
	IconPlayerPlay,
	IconSearch,
	IconSun,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { docs } from "../config/docs.ts";
import { iconByName } from "../config/icons.ts";
import { theme } from "../config/theme.ts";

type Props = {
	opened?: boolean;
	toggle?: () => void;
	withBurger?: boolean;
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
				{props.withBurger && (
					<Burger
						opened={props.opened}
						onClick={props.toggle}
						size="sm"
						hiddenFrom={theme.sidebarBreakpoint}
					/>
				)}

				<HomeButton />

				<Flex flex={1}></Flex>

				<Button
					leftSection={<IconPlayerPlay size={16} />}
					visibleFrom={"md"}
					variant={"transparent"}
					component={Link}
					href={"/docs/introduction"}
				>
					Start
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
	const router = useRouter();

	const actions = useMemo(() => {
		return docs.map((doc) => ({
			id: doc.slug,
			label: doc.name,
			description: doc.description,
			onClick: () => router.go(`/docs/${doc.slug}`),
			leftSection: iconByName(doc.name),
		}));
	}, []);

	return (
		<>
			<Button
				leftSection={<IconSearch size={16} />}
				variant={"default"}
				c={"dimmed"}
				rightSection={<Kbd>Ctrl K</Kbd>}
				onClick={spotlight.open}
			>
				Search...
			</Button>
			<Spotlight
				shortcut={["mod + K", "mod + P", "/"]}
				limit={7}
				actions={actions}
				nothingFound="Nothing found..."
				highlightQuery
				searchProps={{
					leftSection: <IconSearch size={20} stroke={1.5} />,
					placeholder: "Search...",
				}}
			/>
		</>
	);
};

const HomeButton = () => {
	const router = useRouter();
	return (
		<Button size={"xl"} variant={"transparent"} component={Link} href={"/"}>
			<Flex align={"center"} justify={"center"}>
				<Flex>
					<Image
						style={{ marginBottom: -32 }}
						src={router.base("/alepha.png")}
						alt={"logo"}
						width={50}
						height={50}
					/>
				</Flex>
				<Flex direction={"column"} align={"start"}>
					<Text size={"xl"} ff={"var(--mantine-font-family-monospace)"}>
						Alepha
					</Text>
					<Text size={"xs"} c={"dimmed"} mt={-6} fw={"300"}>
						Documentation
					</Text>
				</Flex>
			</Flex>
		</Button>
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
