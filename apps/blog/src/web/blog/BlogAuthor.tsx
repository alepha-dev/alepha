import { ActionButton, Flex } from "@alepha/ui";
import { Text } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";
import type { PostResource } from "../../api/schemas/postSchemas.ts";

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function estimateReadTime(content?: string): string {
  if (!content) return "1 min";
  const words = content.replace(/<[^>]*>/g, "").split(/\s+/).length;
  return `${Math.max(1, Math.ceil(words / 250))} min`;
}

export interface BlogAuthorProps {
  posts: PostResource[];
}

const BlogAuthor = ({ posts }: BlogAuthorProps) => {
  const authorName = posts[0]?.authorName || "Author";

  return (
    <Flex direction="column" maw={720} mx="auto" w="100%">
      {/* Author header */}
      <Flex
        direction="column"
        mb="xl"
        pb="lg"
        style={{ borderBottom: "1px solid var(--blog-border)" }}
      >
        <Text
          fw={700}
          fz={{ base: "1.5rem", sm: "2rem" }}
          c="var(--blog-text)"
          ff="var(--blog-font-mono)"
          lh={1.2}
          style={{ letterSpacing: "-0.02em" }}
        >
          {authorName}
        </Text>
        <Text
          fz="sm"
          c="var(--blog-text-faint)"
          ff="var(--blog-font-mono)"
          mt="xs"
        >
          {posts.length} {posts.length === 1 ? "post" : "posts"}
        </Text>
      </Flex>

      {/* Post list */}
      {posts.length === 0 ? (
        <Flex direction="column" align="center" py={60}>
          <Text fz="sm" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
            No posts by this author.
          </Text>
        </Flex>
      ) : (
        <Flex direction="column">
          {posts.map((post, i) => (
            <Flex key={post.id} direction="column">
              <Flex direction="column">
                {/* Date + read time */}
                <Flex gap="sm" align="center" mb={6}>
                  <Text
                    fz="xs"
                    c="var(--blog-text-faint)"
                    ff="var(--blog-font-mono)"
                  >
                    {formatDate(post.publishedAt)}
                  </Text>
                  <Flex gap={3} align="center">
                    <IconClock
                      size={12}
                      color="var(--blog-text-faint)"
                      stroke={1.5}
                    />
                    <Text
                      fz="xs"
                      c="var(--blog-text-faint)"
                      ff="var(--blog-font-mono)"
                    >
                      {estimateReadTime(post.content)}
                    </Text>
                  </Flex>
                </Flex>

                {/* Title */}
                <ActionButton
                  anchorProps={{ underline: "never" }}
                  href={`/post/${post.slug}`}
                  unstyled
                >
                  <Text
                    fw={700}
                    fz="1.25rem"
                    lh={1.35}
                    c="var(--blog-text)"
                    ff="var(--blog-font-mono)"
                    className="blog-post-title"
                    style={{ letterSpacing: "-0.01em" }}
                  >
                    {post.title}
                  </Text>
                </ActionButton>

                {/* Excerpt */}
                {post.excerpt && (
                  <Text
                    fz="sm"
                    c="var(--blog-text-muted)"
                    lh={1.6}
                    lineClamp={2}
                    mt={6}
                  >
                    {post.excerpt}
                  </Text>
                )}

                {/* Tags */}
                {post.tags && post.tags.length > 0 && (
                  <Flex gap="sm" mt={8}>
                    {post.tags.map((tag) => (
                      <Text
                        key={tag}
                        fz="xs"
                        c="var(--blog-accent)"
                        ff="var(--blog-font-mono)"
                        className="blog-anchor-link"
                      >
                        #{tag}
                      </Text>
                    ))}
                  </Flex>
                )}
              </Flex>

              {i < posts.length - 1 && (
                <hr
                  className="blog-post-separator"
                  style={{ margin: "24px 0" }}
                />
              )}
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
};

export default BlogAuthor;
