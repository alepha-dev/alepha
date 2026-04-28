import { ActionButton, Flex, Text } from "@alepha/mantine";
import { TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsConfirmationModalProps {
  project: { title: string };
  resolve: (value: boolean) => void;
}

const ProjectSettingsConfirmationModal = (
  props: ProjectSettingsConfirmationModalProps,
) => {
  const { project, resolve } = props;
  const [inputValue, setInputValue] = useState("");
  const { tr } = useI18n<I18n, "en">();
  const isValid = inputValue === project.title;

  return (
    <Flex direction="column" gap="md">
      <Text size="sm">{tr("project.settings.delete.modal.description")}</Text>
      <Text size="sm">
        {tr("project.settings.delete.modal.confirm", {
          args: [project.title],
        })}
      </Text>
      <TextInput
        value={inputValue}
        onChange={(event) => setInputValue(event.currentTarget.value)}
        placeholder={project.title}
        data-autofocus
      />
      <Flex justify="flex-end" gap="sm">
        <ActionButton
          variant="default"
          onClick={() => {
            resolve(false);
            modals.closeAll();
          }}
        >
          {tr("project.settings.delete.modal.cancel")}
        </ActionButton>
        <ActionButton
          color="red"
          disabled={!isValid}
          onClick={() => {
            resolve(true);
            modals.closeAll();
          }}
        >
          {tr("project.settings.delete.modal.submit")}
        </ActionButton>
      </Flex>
    </Flex>
  );
};

export default ProjectSettingsConfirmationModal;
