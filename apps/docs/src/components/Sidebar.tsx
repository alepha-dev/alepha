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
import { useMemo } from "react";
import { docs } from "../config/docs.ts";
import { renderIcon } from "../config/icons.ts";
import { theme } from "../config/theme.ts";

type Props = {
	toggle: () => void;
};

const MyNavLink = (props: NavLinkProps & { to?: string } & Props) => {
	const { to = "/", toggle, ...rest } = props;

	const active = useActive(to);
	const mantineTheme = useMantineTheme();
	const isMobile = useMediaQuery(
		`(max-width: ${mantineTheme.breakpoints[theme.sidebarBreakpoint]})`,
	);

	return (
		<NavLink
			{...rest}
			{...active.anchorProps}
			active={active.isActive}
			onClick={(ev) => {
				if (isMobile) {
					props.toggle();
				}
				active.anchorProps.onClick(ev);
			}}
		/>
	);
};

const Sidebar = (props: Props) => {
	const navLinks = useMemo(
		() => [
			{
				name: "Guides",
				icon: renderIcon("IconMap2"),
				items: docs.filter((it) => it.category === "guides"),
			},
			{
				name: "Core Concepts",
				icon: renderIcon("IconHeartHandshake"),
				items: docs.filter((it) => it.category === "concepts"),
			},
			{
				name: "Packages",
				icon: renderIcon("IconPackage"),
				items: docs.filter((it) => it.category === "packages"),
			},
		],
		[],
	);

	return (
		<ScrollArea>
			<Flex direction={"column"} p={{ sm: "xs" }}>
				<Flex direction={"column"}>
					{navLinks.map((link) => (
						<NavLink key={link.name} label={link.name} leftSection={link.icon}>
							{link.items.map((it) => (
								<MyNavLink
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
