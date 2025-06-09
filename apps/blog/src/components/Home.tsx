import {
	Badge,
	Card,
	Flex,
	Group,
	Image,
	SimpleGrid,
	Text,
} from "@mantine/core";
import type { Static } from "@sinclair/typebox";
import type { Blog } from "../Blog.ts";
import type { post } from "../entities.ts";
import Go from "./Go.tsx";

interface Props {
	posts: Array<Static<typeof post.$schema>>;
}

const Home = (props: Props) => {
	return (
		<Flex direction={"column"}>
			<h1>Hello, Alepha!</h1>
			<p>Welcome to your Alepha blog.</p>
			<SimpleGrid cols={3} spacing="md">
				{props.posts.map((post) => (
					<Card key={post.id} shadow="sm" padding="lg" radius="md" withBorder>
						<Card.Section>
							<Image
								src="https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/images/bg-8.png"
								height={160}
								alt="Norway"
							/>
						</Card.Section>

						<Group justify="space-between" mt="md" mb="xs">
							<Text fw={500}>{post.title}</Text>
							<Badge color="pink">New</Badge>
						</Group>

						<Text size="sm" c="dimmed">
							{post.content.slice(0, 100)}
							{post.content.length > 100 ? "..." : ""}
						</Text>

						<Go<Blog>
							to={"viewPost"}
							params={{ slug: post.slug }}
							color="blue"
							fullWidth
							mt="md"
							radius="md"
						>
							Continue reading
						</Go>
					</Card>
				))}
			</SimpleGrid>
		</Flex>
	);
};

export default Home;
