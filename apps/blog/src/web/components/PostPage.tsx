import { Flex, Text } from "@alepha/ui";
import { ClientOnly } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { Post } from "@/api/entities/posts.ts";
import { PostPageEditLink } from "./PostPageEditLink.tsx";

export interface PostPageProps {
  post: Post;
}

const PostPage = (props: PostPageProps) => {
  const { post } = props;
  const { l } = useI18n();

  return (
    <Flex direction="column" gap="md">
      <Text fw="bold" size="xl">
        {post.title}
      </Text>
      <Flex gap="xs" align="center">
        {post.publishedAt && (
          <ClientOnly>
            <Text size="sm" c="dimmed">
              {l(post.publishedAt)}
            </Text>{" "}
          </ClientOnly>
        )}
        {post.tags.map((tag) => (
          <Text key={tag} size="xs" c="blue">
            #{tag}
          </Text>
        ))}
      </Flex>
      <ClientOnly>
        <PostPageEditLink slug={post.slug} />
      </ClientOnly>
      {/** biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized */}
      <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
    </Flex>
  );
};

export default PostPage;
