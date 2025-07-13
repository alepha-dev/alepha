import { useActive } from "@alepha/react";
import {
	Flex,
	NavLink as MantineNavLink,
	type NavLinkProps,
	ScrollArea,
	Text,
} from "@mantine/core";
import {
	IconHeartHandshake,
	IconMap2,
	IconPackage,
	IconTools,
} from "@tabler/icons-react";
import { data } from "../../node_modules/data";

const NavLink = (props: NavLinkProps & { to?: string }) => {
	const to = props.to ?? "/";

	const active = useActive(to);

	return (
		<MantineNavLink
			{...props}
			{...active.anchorProps}
			active={active.isActive}
		/>
	);
};

const Sidebar = () => {
	return (
		<ScrollArea>
			<Flex direction={"column"}>
				<Flex direction={"column"}>
					<MantineNavLink
						label={"Guide"}
						leftSection={<IconMap2 />}
						description={"Explore the Alepha guide"}
					>
						<NavLink label={"Getting Started"} to={"/"}></NavLink>
						<NavLink label={"Installation"} to={"/installation"}></NavLink>
					</MantineNavLink>
					<MantineNavLink
						label={"Core Concepts"}
						description={"Learn the core concepts of Alepha"}
						leftSection={<IconHeartHandshake />}
					>
						<NavLink
							label={"Alepha Instance"}
							to={"/alepha-instance"}
						></NavLink>
						<NavLink label={"Descriptors"} to={"/descriptors"}></NavLink>
						<NavLink
							label={"Module & Providers"}
							to={"/module-and-providers"}
						></NavLink>
						<NavLink label={"Type Safety"} to={"type-safety"}></NavLink>
					</MantineNavLink>
					<MantineNavLink label={"Packages"} leftSection={<IconPackage />}>
						{data
							.filter((it) => it.description)
							.map((module) => (
								<NavLink
									key={module.name}
									px={"xs"}
									label={
										<Text size={"sm"} fw={"bold"} tt={"capitalize"}>
											Alepha{" "}
											{module.name.replace("@alepha/", "").replaceAll("-", " ")}
										</Text>
									}
									description={module.description}
									to={`/m/${module.name.replaceAll("@alepha/", "")}`}
									onClick={(ev) => {
										ev.preventDefault();
										console.log(`Navigating to ${module.name}`);
									}}
								></NavLink>
							))}
					</MantineNavLink>
					<MantineNavLink
						label={"Recipes"}
						leftSection={<IconTools />}
					></MantineNavLink>
				</Flex>
			</Flex>
		</ScrollArea>
	);
};

export default Sidebar;
