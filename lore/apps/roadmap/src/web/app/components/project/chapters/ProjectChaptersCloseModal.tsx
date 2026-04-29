import { ActionButton, Flex, Text } from "@alepha/mantine";
import { TextInput } from "@mantine/core";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { ChapterWithCount } from "./ProjectChapters.tsx";

export interface ProjectChaptersCloseModalProps {
  chapter: ChapterWithCount;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

const ProjectChaptersCloseModal = (props: ProjectChaptersCloseModalProps) => {
  const { chapter, onConfirm, onCancel } = props;
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

export default ProjectChaptersCloseModal;
