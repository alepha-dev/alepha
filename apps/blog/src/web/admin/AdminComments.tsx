import { ActionButton, Flex } from "@alepha/ui";
import {
  Avatar,
  Badge,
  Card,
  Pagination,
  SegmentedControl,
  Skeleton,
  Text,
  Title,
} from "@mantine/core";
import {
  IconCheck,
  IconDots,
  IconExclamationMark,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { useEffect, useState } from "react";
import type { AdminCommentController } from "../../api/controllers/AdminCommentController.ts";
import type { CommentResource } from "../../api/schemas/commentSchemas.ts";

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const statusColors: Record<string, string> = {
  pending: "yellow",
  approved: "green",
  spam: "red",
  rejected: "gray",
};

export interface AdminCommentsProps {
  initialComments: CommentResource[];
  initialTotal: number;
}

const AdminComments = ({
  initialComments,
  initialTotal,
}: AdminCommentsProps) => {
  const client = useClient<AdminCommentController>();

  const [comments, setComments] = useState<CommentResource[]>(initialComments);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 20;

  const load = async () => {
    setLoading(true);
    try {
      const query: Record<string, unknown> = { page: page - 1, size: pageSize };
      if (statusFilter !== "all") query.status = statusFilter;

      const res = await client.findComments({ query: query as any });
      const data = res as unknown as {
        content: CommentResource[];
        page: { totalElements?: number };
      };
      setComments(data.content);
      setTotal(data.page.totalElements || 0);
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, statusFilter]);

  const updateStatus = async (id: string, status: string) => {
    await client.updateComment({
      params: { id },
      body: { status } as any,
    });
    load();
  };

  const deleteComment = async (id: string) => {
    if (!confirm("Delete this comment permanently?")) return;
    await client.deleteComment({ params: { id } });
    load();
  };

  return (
    <Flex direction="column" gap="lg" p="lg">
      <Title order={2}>Comments</Title>

      <SegmentedControl
        value={statusFilter}
        onChange={(val) => {
          setStatusFilter(val);
          setPage(1);
        }}
        data={[
          { label: "All", value: "all" },
          { label: "Pending", value: "pending" },
          { label: "Approved", value: "approved" },
          { label: "Spam", value: "spam" },
          { label: "Rejected", value: "rejected" },
        ]}
        size="sm"
      />

      {loading ? (
        <Flex direction="column" gap="md">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={120} radius="sm" />
          ))}
        </Flex>
      ) : comments.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No comments found.
        </Text>
      ) : (
        <Flex direction="column" gap="md">
          {comments.map((comment) => (
            <Card
              key={comment.id}
              withBorder
              radius="sm"
              p="md"
              className="cf-card"
            >
              <Flex
                justify="space-between"
                mb="sm"
                wrap="nowrap"
                align="flex-start"
              >
                <Flex gap="sm" wrap="nowrap">
                  <Avatar radius="xl" size={36} color="dark">
                    {(comment.authorName || "?")[0]?.toUpperCase()}
                  </Avatar>
                  <Flex>
                    <Flex gap="xs">
                      <Text fz="sm" fw={600}>
                        {comment.authorName}
                      </Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color={statusColors[comment.status] || "gray"}
                      >
                        {comment.status}
                      </Badge>
                    </Flex>
                    <Flex gap="xs">
                      <Text fz="xs" c="dimmed">
                        {formatDate(comment.createdAt)}
                      </Text>
                      {comment.postTitle && (
                        <>
                          <Text fz="xs" c="dimmed">
                            on
                          </Text>
                          <ActionButton
                            anchorProps={{ underline: "never" }}
                            href={`/post/${comment.postSlug}`}
                            target="_blank"
                            fz="xs"
                            unstyled
                          >
                            {comment.postTitle}
                          </ActionButton>
                        </>
                      )}
                    </Flex>
                  </Flex>
                </Flex>

                <ActionButton
                  icon={IconDots}
                  variant="subtle"
                  color="gray"
                  size="sm"
                  menu={{
                    position: "bottom-end",
                    items: [
                      ...(comment.status !== "approved"
                        ? [
                            {
                              label: "Approve",
                              icon: <IconCheck size={14} />,
                              color: "green",
                              onClick: () =>
                                updateStatus(comment.id, "approved"),
                            },
                          ]
                        : []),
                      ...(comment.status !== "rejected"
                        ? [
                            {
                              label: "Reject",
                              icon: <IconX size={14} />,
                              onClick: () =>
                                updateStatus(comment.id, "rejected"),
                            },
                          ]
                        : []),
                      ...(comment.status !== "spam"
                        ? [
                            {
                              label: "Mark as Spam",
                              icon: <IconExclamationMark size={14} />,
                              color: "orange",
                              onClick: () => updateStatus(comment.id, "spam"),
                            },
                          ]
                        : []),
                      { type: "divider" as const },
                      {
                        label: "Delete",
                        icon: <IconTrash size={14} />,
                        color: "red",
                        onClick: () => deleteComment(comment.id),
                      },
                    ],
                  }}
                />
              </Flex>

              <Text fz="sm" c="dimmed" lh={1.5} pl={48}>
                {comment.content}
              </Text>
            </Card>
          ))}
        </Flex>
      )}

      {total > pageSize && (
        <Flex justify="center">
          <Pagination
            value={page}
            onChange={setPage}
            total={Math.ceil(total / pageSize)}
            size="sm"
          />
        </Flex>
      )}
    </Flex>
  );
};

export default AdminComments;
