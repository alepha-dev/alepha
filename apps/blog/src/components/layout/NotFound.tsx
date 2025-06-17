import { Flex, Text, Title } from "@mantine/core";
import type { Blog } from "../../Blog.ts";
import Go from "../shared/Go.tsx";

const NotFound = () => {
	return (
		<Flex
			h={"60vh"}
			p={"xl"}
			gap={"xl"}
			justify="center"
			align={"center"}
			direction={"column"}
		>
			<Text size={"xl"}>404</Text>
			<Title ff={"monospace"}>Page Not Found</Title>
			<Text size={"xl"} c={"dimmed"}>
				The page you are looking for does not exist.
			</Text>
			<Go<Blog> to={"home"}>Take me back to the homepage</Go>
		</Flex>
	);
};

export default NotFound;
