import { useActive } from "@alepha/react";
import {
	Flex,
	NavLink,
	type NavLinkProps,
	ScrollArea,
	Text,
	useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconHeartHandshake, IconMap2, IconPackage } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { docs } from "../config/docs.ts";
import { theme } from "../config/theme.ts";

type Props = {
	toggle: () => void;
};

const MyNavLink = (
	props: NavLinkProps & { to?: string; onActive: () => void } & Props,
) => {
	const { to = "/", toggle, onActive, ...rest } = props;

	const { isActive, anchorProps } = useActive(to);
	const mantineTheme = useMantineTheme();
	const isMobile = useMediaQuery(
		`(max-width: ${mantineTheme.breakpoints[theme.sidebarBreakpoint]})`,
	);

	useEffect(() => {
		if (isActive) {
			onActive();
		}
	}, []);

	return (
		<NavLink
			{...rest}
			{...anchorProps}
			active={isActive}
			onClick={(ev) => {
				if (isMobile) {
					props.toggle();
				}
				anchorProps.onClick(ev);
			}}
		/>
	);
};

const Sidebar = (props: Props) => {
	const navLinks = useMemo(
		() => [
			{
				name: "Guide",
				icon: <IconMap2 />,
				items: docs.filter((it) => it.category === "guides"),
			},
			{
				name: "Core Concepts",
				icon: <IconHeartHandshake />,
				items: docs.filter((it) => it.category === "concepts"),
			},
			{
				name: "Packages",
				icon: <IconPackage />,
				items: docs.filter((it) => it.category === "packages"),
			},
		],
		[],
	);

	const [opened, setOpened] = useState("");

	return (
		<ScrollArea>
			<Flex direction={"column"} p={{ sm: "xs" }}>
				<Flex direction={"column"}>
					{navLinks.map((link) => (
						<NavLink
							onClick={() => setOpened(link.name === opened ? "" : link.name)}
							opened={link.name === opened}
							key={link.name}
							label={link.name}
							leftSection={link.icon}
						>
							{link.items.map((it) => (
								<MyNavLink
									onActive={() => {
										setOpened(link.name);
									}}
									toggle={props.toggle}
									key={it.name}
									px={"xs"}
									description={it.description}
									label={
										<Text size={"sm"} fw={"light"}>
											{it.name.replace("@", "").replaceAll("-", "/")}
										</Text>
									}
									to={`/docs/${it.slug}`}
								></MyNavLink>
							))}
						</NavLink>
					))}
				</Flex>
			</Flex>
		</ScrollArea>
	);
};

export default Sidebar;
