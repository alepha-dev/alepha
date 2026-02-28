import { ActionButton, Flex, Text, useToast } from "@alepha/ui";
import { Badge, Card, Container, Modal, TextInput } from "@mantine/core";
import {
  IconBook2,
  IconCopy,
  IconDownload,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
} from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useState } from "react";
import type { ChapterController } from "../../../../api/controllers/ChapterController.ts";
import type { Chapter } from "../../../../api/entities/chapters.ts";
import { currentChaptersAtom } from "../../atoms/currentChaptersAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";

type ChapterWithCount = Chapter & { questCount: number };

const ProjectChapters = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [chapters, setChapters] = useStore(currentChaptersAtom);
  const chapterApi = useClient<ChapterController>();
  const toast = useToast();
  const [showStartForm, setShowStartForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [changelogModal, setChangelogModal] = useState<{
    markdown: string;
    chapter: Chapter;
  } | null>(null);
  const [closeModal, setCloseModal] = useState<ChapterWithCount | null>(null);

  const activeChapter = chapters?.find((c) => !c.closedAt);

  const reload = useCallback(async () => {
    if (!project) return;
    const updated = await chapterApi.getChapters({
      params: { projectId: project.id },
    });
    setChapters(updated as ChapterWithCount[]);
  }, [project?.id]);

  const handleStart = async () => {
    if (!project) return;
    await chapterApi.startChapter({
      params: { projectId: project.id },
      body: newTitle.trim() ? { title: newTitle.trim() } : {},
    });
    setNewTitle("");
    setShowStartForm(false);
    await reload();
  };

  const handleClose = async (id: number, title: string) => {
    await chapterApi.closeChapter({
      params: { id },
      body: { title },
    });
    setCloseModal(null);
    await reload();
  };

  const handleDelete = async (id: number) => {
    try {
      await chapterApi.deleteChapter({
        params: { id },
      });
      await reload();
    } catch {
      toast.danger({ message: tr("chapter.delete.error") });
    }
  };

  const handleViewChangelog = async (id: number) => {
    const result = await chapterApi.getChapterChangelog({
      params: { id },
    });
    setChangelogModal({
      markdown: result.markdown,
      chapter: result.chapter,
    });
  };

  if (!project) return null;

  return (
    <Container size="md" w="100%" px={{ base: 0, md: "xs" }}>
      <Flex direction="column" flex={1} p="md" gap="md">
        {/* Active chapter banner */}
        {activeChapter && (
          <Card
            withBorder
            radius="md"
            bg={theme.colors.card}
            className="shadow"
            p="md"
          >
            <Flex align="center" justify="space-between" gap="md">
              <Flex align="center" gap="sm">
                <IconBook2
                  size={theme.icon.size.md}
                  color="var(--mantine-color-green-6)"
                />
                <Flex direction="column" gap={0}>
                  <Text size="sm" fw={600}>
                    {tr("chapter.banner.active")}
                  </Text>
                  <Text size="lg" fw={700}>
                    {tr("chapter.banner.title", {
                      args: [String(activeChapter.number), activeChapter.title],
                    })}
                  </Text>
                </Flex>
              </Flex>
              <ActionButton
                color="orange"
                leftSection={<IconPlayerStop size={theme.icon.size.sm} />}
                onClick={() => setCloseModal(activeChapter as ChapterWithCount)}
              >
                {tr("chapter.close")}
              </ActionButton>
            </Flex>
          </Card>
        )}

        {/* Start new chapter */}
        {!activeChapter && (
          <Card
            withBorder
            radius="md"
            bg={theme.colors.card}
            className="shadow"
            p="md"
          >
            {showStartForm ? (
              <Flex gap="sm" align="end">
                <TextInput
                  flex={1}
                  label={tr("chapter.start.title")}
                  placeholder={tr("chapter.start.placeholder")}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleStart();
                  }}
                  data-autofocus
                />
                <ActionButton color="green" onClick={handleStart}>
                  {tr("chapter.start")}
                </ActionButton>
                <ActionButton
                  variant="default"
                  onClick={() => {
                    setShowStartForm(false);
                    setNewTitle("");
                  }}
                >
                  {tr("chapter.start.cancel")}
                </ActionButton>
              </Flex>
            ) : (
              <Flex align="center" justify="space-between">
                <Text size="sm" c="dimmed">
                  {tr("chapter.list.noActive")}
                </Text>
                <ActionButton
                  color="green"
                  leftSection={<IconPlayerPlay size={theme.icon.size.sm} />}
                  onClick={() => setShowStartForm(true)}
                >
                  {tr("chapter.start")}
                </ActionButton>
              </Flex>
            )}
          </Card>
        )}

        {/* Chapter list */}
        <Flex direction="column" gap="xs">
          <Text fw={600}>{tr("chapter.list.title")}</Text>
          {(!chapters || chapters.length === 0) && (
            <Text size="sm" c="dimmed">
              {tr("chapter.list.empty")}
            </Text>
          )}
          {chapters?.map((chapter) => (
            <ChapterRow
              key={chapter.id}
              chapter={chapter}
              onDelete={handleDelete}
              onViewChangelog={handleViewChangelog}
            />
          ))}
        </Flex>

        {/* Close Chapter Modal */}
        <Modal
          opened={!!closeModal}
          onClose={() => setCloseModal(null)}
          title={tr("chapter.close.modal.title")}
          centered
        >
          {closeModal && (
            <CloseChapterModal
              chapter={closeModal}
              onConfirm={(title) => handleClose(closeModal.id, title)}
              onCancel={() => setCloseModal(null)}
            />
          )}
        </Modal>

        {/* Changelog Modal */}
        <Modal
          opened={!!changelogModal}
          onClose={() => setChangelogModal(null)}
          title={
            changelogModal
              ? tr("chapter.changelog.title", {
                  args: [
                    String(changelogModal.chapter.number),
                    changelogModal.chapter.title,
                  ],
                })
              : ""
          }
          size="lg"
        >
          {changelogModal && (
            <ChangelogContent
              markdown={changelogModal.markdown}
              chapter={changelogModal.chapter}
            />
          )}
        </Modal>
      </Flex>
    </Container>
  );
};

export default ProjectChapters;

const ChapterRow = ({
  chapter,
  onDelete,
  onViewChangelog,
}: {
  chapter: ChapterWithCount;
  onDelete: (id: number) => void;
  onViewChangelog: (id: number) => void;
}) => {
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const isActive = !chapter.closedAt;

  return (
    <Card
      withBorder
      radius="md"
      bg={theme.colors.card}
      className="shadow"
      p="sm"
    >
      <Flex align="center" justify="space-between" gap="sm">
        <Flex align="center" gap="sm" flex={1}>
          <Badge
            size="lg"
            variant={isActive ? "filled" : "light"}
            color={isActive ? "green" : "gray"}
          >
            #{chapter.number}
          </Badge>
          <Flex direction="column" gap={0} flex={1}>
            <Text size="sm" fw={600}>
              {chapter.title}
            </Text>
            <Flex gap="xs">
              <Text size="xs" c="dimmed">
                {tr("chapter.list.quests", {
                  args: [String(chapter.questCount)],
                })}
              </Text>
              {chapter.closedAt && (
                <Text size="xs" c="dimmed">
                  {tr("chapter.list.closed", {
                    args: [String(i18n.l(chapter.closedAt, { date: "ll" }))],
                  })}
                </Text>
              )}
            </Flex>
          </Flex>
        </Flex>
        <Flex gap="xs">
          <ActionButton
            variant="minimal"
            size="sm"
            leftSection={<IconBook2 size={theme.icon.size.sm} />}
            onClick={() => onViewChangelog(chapter.id)}
          >
            {tr("chapter.changelog")}
          </ActionButton>
          {chapter.questCount === 0 && (
            <ActionButton
              variant="light"
              color="red"
              size="sm"
              leftSection={<IconTrash size={theme.icon.size.sm} />}
              onClick={() => onDelete(chapter.id)}
            >
              {tr("chapter.delete")}
            </ActionButton>
          )}
        </Flex>
      </Flex>
    </Card>
  );
};

const CloseChapterModal = ({
  chapter,
  onConfirm,
  onCancel,
}: {
  chapter: ChapterWithCount;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}) => {
  const { tr } = useI18n<I18n, "en">();
  const [title, setTitle] = useState(chapter.title);

  return (
    <Flex direction="column" gap="md">
      <Text size="sm">{tr("chapter.close.modal.description")}</Text>
      <TextInput
        label={tr("chapter.close.modal.label")}
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) onConfirm(title.trim());
        }}
        data-autofocus
      />
      <Flex justify="end" gap="sm">
        <ActionButton variant="default" onClick={onCancel}>
          {tr("chapter.start.cancel")}
        </ActionButton>
        <ActionButton
          color="orange"
          disabled={!title.trim()}
          onClick={() => onConfirm(title.trim())}
        >
          {tr("chapter.close")}
        </ActionButton>
      </Flex>
    </Flex>
  );
};

const ChangelogContent = ({
  markdown,
  chapter,
}: {
  markdown: string;
  chapter: Chapter;
}) => {
  const { tr } = useI18n<I18n, "en">();
  const toast = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    toast.success({ message: tr("chapter.changelog.copied") });
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chapter-${chapter.number}-changelog.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Flex direction="column" gap="md">
      <Flex gap="xs" justify="end">
        <ActionButton
          variant="light"
          size="sm"
          leftSection={<IconCopy size={14} />}
          onClick={handleCopy}
        >
          {tr("chapter.changelog.copy")}
        </ActionButton>
        <ActionButton
          variant="light"
          size="sm"
          leftSection={<IconDownload size={14} />}
          onClick={handleDownload}
        >
          {tr("chapter.changelog.download")}
        </ActionButton>
      </Flex>
      <Card
        withBorder
        radius="md"
        p="md"
        style={{
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          fontSize: "0.85rem",
          maxHeight: "60vh",
          overflow: "auto",
        }}
      >
        {markdown}
      </Card>
    </Flex>
  );
};
