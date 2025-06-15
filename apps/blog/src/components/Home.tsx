import { Card, Divider, Flex, SimpleGrid, Text, Title } from "@mantine/core";
import type { Static } from "@sinclair/typebox";
import { IconRocket } from "@tabler/icons-react";
import type { Blog } from "../Blog.ts";
import type { post } from "../entities.ts";
import Go from "./shared/Go.tsx";

interface Props {
	posts: Array<Static<typeof post.$schema>>;
}

const Home = (props: Props) => {
	return (
		<Flex direction={"column"}>
			<Flex p={20}>
				<Flex flex={1} direction="column" gap={"lg"}>
					<Flex h={64} />
					<Flex align="center" gap={10}>
						<IconRocket size={20} />
						<Text size="sm" fw={"bold"}>
							HOSTED ON VERCEL{" "}
						</Text>
						<Text c={"dimmed"} size={"xs"}>
							(Please, don't spam, I only got the free tier.)
						</Text>
					</Flex>
					<Title>Extremely Complicated Spaghetti Bowl</Title>
					<Text c="dimmed" size="lg" mt={5}>
						This is a simple blog built with React, Alepha, and Mantine. It
						demonstrates server-side rendering (SSR) and some other cool stuff.
					</Text>
					<Flex h={32} />
				</Flex>
				<Flex flex={2} />
			</Flex>
			<Flex p={20} direction="column" gap="lg">
				<Divider w={"100%"} />
				<SimpleGrid cols={{ lg: 4, md: 3, sm: 2, xs: 1 }} spacing="md">
					{props.posts.map((post) => (
						<Card key={post.id} shadow="lg" padding="md" withBorder>
							<Flex direction="column" gap="lg">
								<Flex h={100} direction={"column"} gap={"sm"}>
									<Text fw={500}>{post.title}</Text>
									<Text size="xs" c="dimmed">
										{post.content.slice(0, 100)}
										{post.content.length > 100 ? "..." : ""}
									</Text>
								</Flex>

								<Go<Blog>
									to={"viewPost"}
									params={{ slug: post.slug }}
									fullWidth
								>
									Continue reading
								</Go>
							</Flex>
						</Card>
					))}
				</SimpleGrid>
			</Flex>
		</Flex>
	);
};

export default Home;
