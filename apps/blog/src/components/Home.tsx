import {
	Badge,
	Button,
	Card,
	Divider,
	Flex,
	SimpleGrid,
	Text,
	Title,
} from "@mantine/core";
import type { Static } from "@sinclair/typebox";
import {
	IconBrandReact,
	IconBrandVercel,
	IconHeart,
	IconUser,
} from "@tabler/icons-react";
import type { Blog } from "../Blog.ts";
import type { post } from "../entities.ts";
import Go from "./shared/Go.tsx";

interface Props {
	posts: Array<Static<typeof post.$schema>>;
}

const Home = (props: Props) => {
	console.log("Home component rendered with posts");
	return (
		<Flex direction={"column"}>
			<Flex>
				<SimpleGrid cols={{ xl: 3, md: 2, xs: 1 }} spacing="md">
					<Flex flex={1} direction="column" gap={"lg"}>
						<Flex h={64} />
						<Flex align="center" gap={10}>
							<IconBrandVercel size={20} />
							<Text size="sm" fw={"bold"}>
								HOSTED ON VERCEL{" "}
							</Text>
							<Text c={"dimmed"} size={"xs"}>
								(because it's free)
							</Text>
						</Flex>
						<Title>Extremely Complicated Spaghetti Bowl</Title>
						<Text c="dimmed" size="lg" mt={5}>
							This is a simple blog built with React, Alepha, and Mantine. It
							demonstrates server-side rendering (SSR) and some other cool
							stuff.
						</Text>
						<Flex h={32} />
					</Flex>
				</SimpleGrid>
			</Flex>
			<Flex direction="column" gap="lg">
				<Divider w={"100%"} />
				<SimpleGrid cols={{ lg: 4, md: 3, sm: 2, xs: 1 }} spacing="xl">
					{props.posts.map((post) => (
						<Card key={post.id} shadow="md" withBorder padding={0}>
							<Flex direction="column" h={"100%"}>
								<Flex p={"xs"}>
									<Flex flex={1} gap={"xs"}>
										<IconUser size={16} />
										<Text size="xs" fw={"bold"}>
											Author
										</Text>
									</Flex>
									<Flex>
										<Text size="xs" c="dimmed">
											{new Date(post.createdAt).toLocaleDateString("en-US", {
												year: "numeric",
												month: "long",
												day: "numeric",
											})}
										</Text>
									</Flex>
								</Flex>
								<Flex bg={"gray"} h={128} />
								<Divider />
								<Flex direction={"column"} gap={"sm"} p={"xs"} flex={1}>
									<Text size={"md"} fw={500}>
										{post.title}
									</Text>
									<Text ta={"justify"} size="xs" c="dimmed">
										{post.content.slice(0, 100)}
										{post.content.length > 100 ? "..." : ""}
									</Text>
								</Flex>
								<Divider />
								<Flex p={"xs"} gap={"xs"} justify="center">
									<Badge
										variant={"outline"}
										leftSection={<IconBrandReact size={16} />}
									>
										React
									</Badge>
									<Badge
										variant={"outline"}
										leftSection={<IconBrandVercel size={16} />}
									>
										Vercel
									</Badge>
								</Flex>
								<Divider />
								<Flex gap="sm" p={"xs"}>
									<Go<Blog>
										variant="default"
										to={"viewPost"}
										params={{ slug: post.slug }}
										fullWidth
									>
										Continue reading
									</Go>
									<Flex>
										<Button
											leftSection={<IconHeart />}
											c={"pink"}
											variant="default"
										>
											0
										</Button>
									</Flex>
								</Flex>
							</Flex>
						</Card>
					))}
				</SimpleGrid>
			</Flex>
		</Flex>
	);
};

export default Home;
