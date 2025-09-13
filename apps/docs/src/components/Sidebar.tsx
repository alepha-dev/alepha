import { useActive, useRouter } from "@alepha/react";
import {
	Flex,
	NavLink,
	type NavLinkProps,
	ScrollArea,
	Text,
	useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
	IconHeartHandshake,
	IconMap2,
	IconPackage,
	IconRobot,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { docs } from "../config/docs.ts";
import { iconByName } from "../config/icons.ts";
import { theme } from "../config/theme.ts";

type Props = {
	toggle: () => void;
};

const MyNavLink = (
	props: NavLinkProps & { href?: string; onActive: () => void } & Props,
) => {
	const { href = "/", toggle, onActive, ...rest } = props;

	const { isActive, anchorProps } = useActive(href);
	const mantineTheme = useMantineTheme();
	const isMobile = useMediaQuery(
		`(max-width: ${mantineTheme.breakpoints[theme.sidebarBreakpoint]})`,
	);

	useEffect(() => {
		if (isActive) {
			onActive();
		}
	}, [isActive]);

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
	const router = useRouter();
	const navLinks = useMemo(
		() => [
			{
				name: "Guide",
				icon: <IconMap2 />,
				items: docs.filter((it) => it.category === "guide"),
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
									leftSection={iconByName(it.name)}
									style={{ paddingTop: "4px", paddingBottom: "4px" }}
									toggle={props.toggle}
									key={it.name}
									px={"xs"}
									label={
										<Text size={"sm"} fw={"light"}>
											{it.name
												.replace("@", "")
												.replaceAll("-", "/")
												.replace("Alepha", "")}
										</Text>
									}
									href={`/docs/${it.slug}`}
								></MyNavLink>
							))}
						</NavLink>
					))}
					<NavLink
						component={"a"}
						href={router.base("/llms.txt")}
						label={"LLM"}
						leftSection={<IconRobot />}
					/>
				</Flex>
			</Flex>
		</ScrollArea>
	);
};

export default Sidebar;
