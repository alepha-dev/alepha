import { ActionButton, Flex } from "@alepha/ui";
import { Text } from "@mantine/core";
import { IconClock, IconEye } from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { useMemo, useState } from "react";
import type { PostController } from "../../api/controllers/PostController.ts";
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

/* ──────────────────────────────────────────────────────────────────────────── */

function PostEntry({
  post,
  onTagClick,
}: {
  post: PostResource;
  onTagClick?: (tag: string) => void;
}) {
  return (
    <Flex direction="column">
      {/* Date + read time + stats */}
      <Flex gap="sm" align="center" mb={6} wrap="wrap">
        <Text fz="xs" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
          {formatDate(post.publishedAt)}
        </Text>
        <Flex gap={3} align="center">
          <IconClock size={12} color="var(--blog-text-faint)" stroke={1.5} />
          <Text fz="xs" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
            {estimateReadTime(post.content)}
          </Text>
        </Flex>
        {post.viewCount > 0 && (
          <Flex gap={3} align="center">
            <IconEye size={12} color="var(--blog-text-faint)" stroke={1.5} />
            <Text fz="xs" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
              {post.viewCount}
            </Text>
          </Flex>
        )}
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
        <Text fz="sm" c="var(--blog-text-muted)" lh={1.6} lineClamp={2} mt={6}>
          {post.excerpt}
        </Text>
      )}

      {/* Tags — anchor style */}
      {post.tags && post.tags.length > 0 && (
        <Flex gap="sm" mt={8}>
          {post.tags.map((tag) => (
            <ActionButton key={tag} unstyled onClick={() => onTagClick?.(tag)}>
              <Text
                fz="xs"
                c="var(--blog-accent)"
                ff="var(--blog-font-mono)"
                className="blog-anchor-link"
              >
                #{tag}
              </Text>
            </ActionButton>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── */

export interface BlogHomeProps {
  featured: PostResource[];
  posts: PostResource[];
  categories: CategoryResource[];
  hasMore: boolean;
}

const BlogHome = ({
  featured,
  posts: initialPosts,
  categories,
  hasMore: initialHasMore,
}: BlogHomeProps) => {
  const postClient = useClient<PostController>();

  const [posts, setPosts] = useState<PostResource[]>(initialPosts);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await postClient.listPublishedPosts({
        query: { page: nextPage, size: 10 },
      });
      const postPage = res as unknown as {
        content: PostResource[];
        page: { isLast: boolean };
      };
      setPosts((prev) => [...prev, ...postPage.content]);
      setPage(nextPage);
      setHasMore(!postPage.page.isLast);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  };

  const allPosts = useMemo(() => {
    const seen = new Set<string>();
    const result: PostResource[] = [];
    for (const p of [...featured, ...posts]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        result.push(p);
      }
    }
    return result;
  }, [featured, posts]);

  const filteredPosts = activeTag
    ? allPosts.filter((p) => p.tags?.includes(activeTag))
    : allPosts;

  const handleTagClick = (tag: string) => {
    setActiveTag(tag);
  };

  const clearTag = () => {
    setActiveTag(null);
  };

  return (
    <Flex direction="column" maw={720} mx="auto" w="100%">
      {/* Categories */}
      {categories.length > 0 && (
        <Flex gap="sm" mb="xl" wrap="wrap" align="center">
          <Text
            fz="xs"
            fw={600}
            c="var(--blog-text-faint)"
            ff="var(--blog-font-mono)"
            mr="xs"
          >
            Categories
          </Text>
          {categories.map((cat) => (
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

      {/* Active tag filter */}
      {activeTag && (
        <Flex gap="sm" align="center" mb="lg">
          <Text fz="xs" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
            Filtered by
          </Text>
          <Text
            fz="xs"
            c="var(--blog-accent)"
            ff="var(--blog-font-mono)"
            fw={600}
          >
            #{activeTag}
          </Text>
          <ActionButton
            variant="subtle"
            size="compact-xs"
            fz="xs"
            c="var(--blog-text-faint)"
            onClick={clearTag}
            style={{ fontFamily: "var(--blog-font-mono)" }}
          >
            Clear
          </ActionButton>
        </Flex>
      )}

      {/* Post list */}
      {filteredPosts.length === 0 ? (
        <Flex direction="column" align="center" py={80}>
          <Text fz="lg" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
            {activeTag ? `No posts tagged #${activeTag}.` : "No stories yet."}
          </Text>
          {!activeTag && (
            <Text fz="sm" c="var(--blog-text-faint)" mt="xs">
              Check back soon for new articles.
            </Text>
          )}
        </Flex>
      ) : (
        <Flex direction="column">
          {filteredPosts.map((post, i) => (
            <Flex key={post.id} direction="column">
              <PostEntry post={post} onTagClick={handleTagClick} />
              {i < filteredPosts.length - 1 && (
                <hr
                  className="blog-post-separator"
                  style={{ margin: "24px 0" }}
                />
              )}
            </Flex>
          ))}
        </Flex>
      )}

      {/* Load more */}
      {hasMore && !activeTag && filteredPosts.length > 0 && (
        <Flex justify="center" mt="xl">
          <ActionButton
            unstyled
            loading={loadingMore}
            onClick={loadMore}
            className="blog-load-more"
          >
            <Text fz="sm" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
              Load more...
            </Text>
          </ActionButton>
        </Flex>
      )}
    </Flex>
  );
};

export default BlogHome;
