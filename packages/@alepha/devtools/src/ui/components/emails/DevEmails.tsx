import { Flex, ui } from "@alepha/mantine";
import { Badge, CloseButton, ScrollArea, Text, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

interface EmailEntry {
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString();
};

const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
};

export const DevEmails = () => {
  const http = useInject(HttpClient);
  const [emails, setEmails] = useState<EmailEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const fetchEmails = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await http.fetch("/__devtools/api/emails");
      const data = res.data as any;
      setEmails(data?.emails ?? []);
    } catch {
      // silently fail
    }
  }, [http]);

  useEffect(() => {
    fetchEmails();
    const interval = setInterval(fetchEmails, 10_000);
    return () => clearInterval(interval);
  }, [fetchEmails]);

  const filtered = emails.filter((email) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      email.to.toLowerCase().includes(q) ||
      email.subject.toLowerCase().includes(q)
    );
  });

  const selectedEmail = selectedIndex !== null ? filtered[selectedIndex] : null;

  return (
    <Flex style={{ flex: 1, overflow: "hidden" }} direction="column">
      {/* Filter bar */}
      <Flex
        px="md"
        py="xs"
        gap="sm"
        align="center"
        style={{
          borderBottom: `1px solid ${ui.colors.border}`,
          flexShrink: 0,
        }}
      >
        <TextInput
          size="xs"
          placeholder="Search..."
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 150, maxWidth: 300 }}
        />
        <Badge variant="light" color="gray" size="sm">
          {filtered.length} emails
        </Badge>
      </Flex>

      {/* Main area: list + detail */}
      <Flex style={{ flex: 1, overflow: "hidden" }}>
        {/* Email list */}
        <Flex direction="column" style={{ flex: 1, overflow: "hidden" }}>
          <ScrollArea style={{ flex: 1 }}>
            {filtered.length === 0 && (
              <Flex align="center" justify="center" py="xl" c="dimmed">
                <Text fz="sm">No emails to display</Text>
              </Flex>
            )}
            {filtered.map((email, i) => {
              const isSelected = selectedIndex === i;

              return (
                <Flex
                  key={`${email.sentAt}-${i}`}
                  direction="column"
                  px="md"
                  py="xs"
                  onClick={() => setSelectedIndex(isSelected ? null : i)}
                  style={{
                    borderBottom: `1px solid ${ui.colors.border}20`,
                    background: isSelected ? ui.colors.elevated : "transparent",
                    cursor: "pointer",
                    transition: "background 100ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background =
                        `${ui.colors.elevated}80`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }
                  }}
                >
                  <Flex justify="space-between" align="center">
                    <Text fz="sm" truncate>
                      {email.to}
                    </Text>
                    <Text fz={11} c="dimmed" style={{ flexShrink: 0 }}>
                      {formatRelative(email.sentAt)}
                    </Text>
                  </Flex>
                  <Text fz="xs" c="dimmed" truncate>
                    {email.subject}
                  </Text>
                </Flex>
              );
            })}
          </ScrollArea>
        </Flex>

        {/* Detail panel */}
        {selectedEmail && (
          <Flex
            w={500}
            direction="column"
            style={{
              borderLeft: `1px solid ${ui.colors.border}`,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <Flex
              px="md"
              py="xs"
              align="center"
              justify="space-between"
              style={{
                borderBottom: `1px solid ${ui.colors.border}`,
                flexShrink: 0,
              }}
            >
              <Text fz="xs" fw={600} tt="uppercase" c="dimmed" lts={0.5}>
                Email Detail
              </Text>
              <CloseButton size="xs" onClick={() => setSelectedIndex(null)} />
            </Flex>
            <ScrollArea style={{ flex: 1 }} p="md">
              <Flex direction="column" gap="md">
                {/* To */}
                <Flex direction="column">
                  <Text
                    fz={10}
                    c="dimmed"
                    tt="uppercase"
                    fw={600}
                    lts={0.5}
                    mb={4}
                  >
                    To
                  </Text>
                  <Text fz="xs">{selectedEmail.to}</Text>
                </Flex>

                {/* Date */}
                <Flex direction="column">
                  <Text
                    fz={10}
                    c="dimmed"
                    tt="uppercase"
                    fw={600}
                    lts={0.5}
                    mb={4}
                  >
                    Date
                  </Text>
                  <Text fz="xs">{formatDate(selectedEmail.sentAt)}</Text>
                </Flex>

                {/* Subject */}
                <Flex direction="column">
                  <Text
                    fz={10}
                    c="dimmed"
                    tt="uppercase"
                    fw={600}
                    lts={0.5}
                    mb={4}
                  >
                    Subject
                  </Text>
                  <Text fz="xs">{selectedEmail.subject}</Text>
                </Flex>

                {/* Body */}
                <Flex direction="column">
                  <Text
                    fz={10}
                    c="dimmed"
                    tt="uppercase"
                    fw={600}
                    lts={0.5}
                    mb={4}
                  >
                    Body
                  </Text>
                  <div
                    style={{
                      background: "white",
                      color: "#333",
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      padding: 12,
                    }}
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: devtools renders developer's own email HTML
                    dangerouslySetInnerHTML={{ __html: selectedEmail.body }}
                  />
                </Flex>
              </Flex>
            </ScrollArea>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};

export default DevEmails;
