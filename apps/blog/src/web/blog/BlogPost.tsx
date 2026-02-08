import { ActionButton, Flex } from "@alepha/ui";
import { Text, Textarea } from "@mantine/core";
import { IconClock, IconSend } from "@tabler/icons-react";
import { useClient } from "alepha/react";
import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import shell from "highlight.js/lib/languages/shell";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentController } from "../../api/controllers/CommentController.ts";
import type { CommentResource } from "../../api/schemas/commentSchemas.ts";
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
  if (!content) return "1 min read";
  const words = content.replace(/<[^>]*>/g, "").split(/\s+/).length;
  return `${Math.max(1, Math.ceil(words / 250))} min read`;
}

interface Heading {
  id: string;
  text: string;
  level: number;
}

function extractHeadings(html: string): Heading[] {
  const matches = html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi);
  const headings: Heading[] = [];
  for (const match of matches) {
    const level = Number.parseInt(match[1], 10);
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (text) {
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      headings.push({ id, text, level });
    }
  }
  return headings;
}

function addHeadingIds(html: string): string {
  return html.replace(
    /<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_, level, attrs, content) => {
      const text = content.replace(/<[^>]*>/g, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      return `<h${level}${attrs} id="${id}">${content}</h${level}>`;
    },
  );
}

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("shell", shell);

export interface BlogPostProps {
  post: PostResource;
  comments: CommentResource[];
}

const BlogPost = ({ post, comments: initialComments }: BlogPostProps) => {
  const commentClient = useClient<CommentController>();
  const contentRef = useRef<HTMLDivElement>(null);

  const [comments, setComments] = useState<CommentResource[]>(initialComments);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const headings = useMemo(() => extractHeadings(post.content), [post.content]);
  const contentWithIds = useMemo(
    () => addHeadingIds(post.content),
    [post.content],
  );

  useEffect(() => {
    if (!contentRef.current) return;
    const blocks = contentRef.current.querySelectorAll("pre code");
    for (const block of blocks) {
      hljs.highlightElement(block as HTMLElement);
    }
  }, [contentWithIds]);

  const submitComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    try {
      const c = await commentClient.createComment({
        params: { postId: post.id },
        body: { content: commentText.trim() },
      });
      setComments((prev) => [...prev, c as CommentResource]);
      setCommentText("");
    } catch {
      // handle error
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex direction="column">
      {/* Article meta */}
      <Flex direction="column" maw={720}>
        {/* Date + read time */}
        <Flex gap="sm" align="center" mb="sm">
          <Text fz="xs" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
            {formatDate(post.publishedAt)}
          </Text>
          <Flex gap={3} align="center">
            <IconClock size={12} color="var(--blog-text-faint)" stroke={1.5} />
            <Text fz="xs" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
              {estimateReadTime(post.content)}
            </Text>
          </Flex>
        </Flex>

        {/* Title */}
        <Text
          component="h1"
          fw={700}
          fz={{ base: "1.75rem", sm: "2.25rem" }}
          lh={1.2}
          c="var(--blog-text)"
          ff="var(--blog-font-mono)"
          mb="md"
          style={{ letterSpacing: "-0.02em" }}
        >
          {post.title}
        </Text>

        {/* Author + category — anchor style */}
        <Flex
          gap="xs"
          mb="xl"
          pb="lg"
          style={{ borderBottom: "1px solid var(--blog-border)" }}
        >
          <Text fz="sm" c="var(--blog-text-muted)">
            by{" "}
            <ActionButton
              anchorProps={{ underline: "never" }}
              href={`/author/${post.authorId}`}
              unstyled
            >
              <Text
                component="span"
                fz="sm"
                fw={600}
                c="var(--blog-accent)"
                className="blog-anchor-link"
              >
                {post.authorName}
              </Text>
            </ActionButton>
            {post.categoryName && (
              <>
                {" "}
                in{" "}
                <Text
                  component="span"
                  fz="sm"
                  fw={600}
                  c="var(--blog-accent)"
                  className="blog-anchor-link"
                >
                  {post.categoryName}
                </Text>
              </>
            )}
          </Text>
        </Flex>

        {/* Excerpt */}
        {post.excerpt && (
          <Text fz="lg" c="var(--blog-text-muted)" lh={1.6} mb="xl">
            {post.excerpt}
          </Text>
        )}
      </Flex>

      {/* Two-column layout: content + TOC */}
      <Flex gap={60}>
        {/* Main content */}
        <Flex
          direction="column"
          maw={720}
          style={{ flex: "1 1 720px", minWidth: 0 }}
        >
          {/* Content */}
          <Flex
            ref={contentRef}
            direction="column"
            className="blog-article-content"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: admin content
            dangerouslySetInnerHTML={{ __html: contentWithIds }}
            mb={48}
          />

          {/* Tags */}
          {post.tags.length > 0 && (
            <Flex
              gap="sm"
              mb="xl"
              pt="lg"
              style={{ borderTop: "1px solid var(--blog-border)" }}
            >
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

          {/* Comments */}
          <Flex
            direction="column"
            pt="xl"
            style={{ borderTop: "1px solid var(--blog-border)" }}
          >
            <Text
              fw={700}
              fz="1rem"
              c="var(--blog-text)"
              ff="var(--blog-font-mono)"
              mb="lg"
            >
              {comments.length === 0
                ? "No comments yet"
                : `${comments.length} Comment${comments.length !== 1 ? "s" : ""}`}
            </Text>

            {/* Comment form */}
            <Flex direction="column" mb="xl">
              <Textarea
                placeholder="Write a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.currentTarget.value)}
                minRows={3}
                mb="sm"
                styles={{
                  input: {
                    border: "1px solid var(--blog-border)",
                    backgroundColor: "var(--blog-surface)",
                    color: "var(--blog-text)",
                    fontFamily: "var(--blog-font-sans)",
                    fontSize: "0.9rem",
                  },
                }}
              />
              <Flex justify="flex-end">
                <ActionButton
                  size="sm"
                  radius="xs"
                  loading={submitting}
                  onClick={submitComment}
                  disabled={!commentText.trim()}
                  icon={<IconSend size={14} stroke={1.5} />}
                >
                  Comment
                </ActionButton>
              </Flex>
            </Flex>

            {/* Comment list */}
            <Flex direction="column" gap="md">
              {comments.map((comment) => (
                <Flex
                  key={comment.id}
                  direction="column"
                  pt="md"
                  style={{ borderTop: "1px solid var(--blog-border)" }}
                >
                  <Flex gap="sm" mb={4} align="center">
                    <Text
                      fz="sm"
                      fw={600}
                      c="var(--blog-accent)"
                      className="blog-anchor-link"
                    >
                      {comment.authorName}
                    </Text>
                    <Text
                      fz="xs"
                      c="var(--blog-text-faint)"
                      ff="var(--blog-font-mono)"
                    >
                      {formatDate(comment.createdAt)}
                    </Text>
                  </Flex>
                  <Text fz="sm" c="var(--blog-text-muted)" lh={1.6}>
                    {comment.content}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </Flex>

        {/* TOC — sticky sidebar */}
        {headings.length > 1 && (
          <Flex
            direction="column"
            w={260}
            visibleFrom="md"
            className="blog-toc"
            style={{ flexShrink: 0 }}
          >
            <Text
              fz="xs"
              fw={600}
              c="var(--blog-text-faint)"
              ff="var(--blog-font-mono)"
              mb="sm"
              style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
            >
              Contents
            </Text>
            {headings.map((h) => (
              <ActionButton
                key={h.id}
                anchorProps={{ underline: "never" }}
                href={`#${h.id}`}
                unstyled
                mb={4}
              >
                <Text
                  fz="sm"
                  c="var(--blog-text-muted)"
                  ff="var(--blog-font-mono)"
                  ml={(h.level - 1) * 16}
                  className="blog-toc-link"
                  lh={1.6}
                >
                  {h.text}
                </Text>
              </ActionButton>
            ))}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};

export default BlogPost;
