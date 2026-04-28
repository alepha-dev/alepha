import { ActionButton, Flex, useToast } from "@alepha/mantine";
import { Card } from "@mantine/core";
import { IconCopy, IconDownload } from "@tabler/icons-react";
import { useI18n } from "alepha/react/i18n";
import type { Chapter } from "@/api/entities/chapters.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectChaptersChangelogProps {
  markdown: string;
  chapter: Chapter;
}

const ProjectChaptersChangelog = (props: ProjectChaptersChangelogProps) => {
  const { markdown, chapter } = props;
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

export default ProjectChaptersChangelog;
