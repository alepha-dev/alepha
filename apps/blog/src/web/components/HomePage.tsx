import { ActionButton, Flex, Text } from "@alepha/ui";
import { useRouter } from "alepha/react/router";
import type { Post } from "@/api/entities/posts.ts";
import type { AppRouter } from "@/web/AppRouter.ts";

export interface HomePageProps {
  posts: Post[];
}

const HomePage = (props: HomePageProps) => {
  const router = useRouter<AppRouter>();

  return (
    <Flex direction="column" gap="xl">
      {props.posts.map((post) => (
        <ActionButton
          key={post.id}
          variant="minimal"
          variantActive="minimal"
          href={router.path("post", { params: { slug: post.slug } })}
          anchor
        >
          <Flex direction="column" gap="xs" w="100%">
            <Text fw="bold" size="lg">
              {post.title}
            </Text>
            <Text size="sm" c="dimmed">
              {post.summary}
            </Text>
            <Flex gap="xs">
              {post.tags.map((tag) => (
                <Text key={tag} size="xs" c="blue">
                  #{tag}
                </Text>
              ))}
            </Flex>
          </Flex>
        </ActionButton>
      ))}
      {props.posts.length === 0 && <Text c="dimmed">No posts yet.</Text>}
    </Flex>
  );
};

export default HomePage;
