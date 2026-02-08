import { ActionButton, Flex } from "@alepha/ui";
import { Text } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";
import type { CategoryResource } from "../../api/schemas/categorySchemas.ts";
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

export interface BlogCategoryProps {
  category: CategoryResource | null;
  categories: CategoryResource[];
  posts: PostResource[];
}

const BlogCategory = ({ category, categories, posts }: BlogCategoryProps) => {
  return (
    <Flex direction="column" maw={720} mx="auto" w="100%">
      {/* Category header */}
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
          {category?.name || "Category"}
        </Text>
        {category?.description && (
          <Text fz="md" c="var(--blog-text-muted)" lh={1.5} mt="xs" maw={600}>
            {category.description}
          </Text>
        )}
      </Flex>

      {/* Other categories */}
      {categories.length > 1 && (
        <Flex gap="sm" mb="xl" wrap="wrap" align="center">
          <Text
            fz="xs"
            fw={600}
            c="var(--blog-text-faint)"
            ff="var(--blog-font-mono)"
            mr="xs"
          >
            Related
          </Text>
          {categories
            .filter((c) => c.id !== category?.id)
            .map((cat) => (
              <ActionButton
                key={cat.id}
                anchorProps={{ underline: "never" }}
                href={`/category/${cat.slug}`}
                unstyled
              >
                <Text
                  fz="xs"
                  c="var(--blog-text-muted)"
                  ff="var(--blog-font-mono)"
                  className="blog-nav-link"
                >
                  {cat.name}
                </Text>
              </ActionButton>
            ))}
        </Flex>
      )}

      {/* Posts */}
      {posts.length === 0 ? (
        <Flex direction="column" align="center" py={60}>
          <Text fz="sm" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
            No posts in this category yet.
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

                {/* Author */}
                <Text fz="xs" c="var(--blog-text-faint)" mt={6}>
                  {post.authorName}
                </Text>
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

export default BlogCategory;
