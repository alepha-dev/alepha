import { Link } from "@alepha/react";
import { Flex, NavLink, ScrollArea, Space, Text } from "@mantine/core";
import data from "../../sidebar-data.json" with { type: "json" };

const Sidebar = () => {
	return (
		<ScrollArea>
			<Flex direction={"column"}>
				{data
					.filter((it) => it.description)
					.map((module) => (
						<NavLink
							key={module.slug}
							label={module.name.replace("@alepha/", "").replaceAll("-", " / ")}
						>
							<Link to={`/m/${module.name.replaceAll("@alepha/", "")}`}>
								Readme
							</Link>
							<Space h="md" />
							<Text fw={"bold"} size={"xs"} c={"dimmed"}>
								Descriptors
							</Text>
							<NavLink label="$batch" />
							<Space h="md" />
							<Text fw={"bold"} size={"xs"} c={"dimmed"}>
								Providers
							</Text>
							<NavLink label="BatchDescriptorProvider" />
							<Space h="md" />
						</NavLink>
					))}
			</Flex>
		</ScrollArea>
	);
};

export default Sidebar;
