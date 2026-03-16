import { ActionButton, Flex, Text } from "@alepha/ui";
import { useRouter } from "alepha/react/router";
import type { Post } from "@/api/entities/posts.ts";
import type { AppRouter } from "@/web/AppRouter.ts";

export interface TagPageProps {
  posts: Post[];
  tag: string;
}

const TagPage = (props: TagPageProps) => {
  const router = useRouter<AppRouter>();

  return (
    <Flex direction="column" gap="xl">
      <Text fw="bold" size="lg">
        Posts tagged: #{props.tag}
      </Text>
      {props.posts.map((post) => (
        <ActionButton
          key={post.id}
          variant="minimal"
          variantActive="minimal"
          href={router.path("post", { params: { slug: post.slug } })}
          anchor
        >
          <Flex direction="column" gap="xs" w="100%">
            <Text fw="bold">{post.title}</Text>
            <Text size="sm" c="dimmed">
              {post.summary}
            </Text>
          </Flex>
        </ActionButton>
      ))}
      {props.posts.length === 0 && (
        <Text c="dimmed">No posts with this tag.</Text>
      )}
    </Flex>
  );
};

export default TagPage;
