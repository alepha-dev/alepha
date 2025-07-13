import {
	ActionIcon,
	Burger,
	Container,
	Flex,
	Image,
	Menu,
	Text,
	TextInput,
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

type Props = {
	opened?: boolean;
	toggle?: () => void;
};

const Header = (props: Props) => {
	return (
		<Container fluid px={0} h={"100%"}>
			<Flex h={"100%"} align={"center"} px={"lg"} gap={"lg"}>
				<Burger
					opened={props.opened}
					onClick={props.toggle}
					size="sm"
					hiddenFrom={"sm"}
				/>
				<Flex align={"center"}>
					<Flex>
						<Image src={"/logo.png"} alt={"logo"} width={64} height={64} />
					</Flex>
					<Flex direction={"column"}>
						<Text size={"xl"}>Alepha</Text>
						<Text size={"xs"} c={"dimmed"} mt={-8}>
							Docs
						</Text>
					</Flex>
				</Flex>
				<Flex flex={1}></Flex>
				<TextInput
					visibleFrom={"sm"}
					leftSection={<IconSearch size={16} />}
					placeholder={"Search"}
					size={"xs"}
					radius={"xl"}
				/>
				<ActionIcon
					size={"lg"}
					variant={"default"}
					component={"a"}
					href={"https://github.com/feunard/alepha"}
				>
					<IconBrandGithub />
				</ActionIcon>
				<ToggleDarkMode />
			</Flex>
		</Container>
	);
};

export default Header;

const ToggleDarkMode = () => {
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
