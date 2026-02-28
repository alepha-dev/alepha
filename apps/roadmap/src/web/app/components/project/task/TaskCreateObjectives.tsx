import { ActionButton, type CustomControlProps, Flex } from "@alepha/ui";
import { TextInput } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { theme } from "@/web/app/constants/theme.ts";

export interface Objective {
  title: string;
  completed: boolean;
}

interface ObjectiveEditorProps extends CustomControlProps {}

const TaskCreateObjectives = (props: ObjectiveEditorProps) => {
  const [objectives, setObjectives] = useState<Objective[]>(
    props.defaultValue || [],
  );
  const [newObjective, setNewObjective] = useState<string>("");

  const addObjective = () => {
    if (newObjective.trim()) {
      const list = [
        ...objectives,
        { title: newObjective.trim(), completed: false },
      ];
      setObjectives(list);
      setNewObjective("");
      props.onChange(list);
    }
  };

  const removeObjective = (index: number) => {
    const list = objectives.filter((_, i) => i !== index);
    setObjectives(list);
    props.onChange(list);
  };

  const updateObjective = (index: number, title: string) => {
    const updated = [...objectives];
    updated[index] = { ...updated[index], title };
    setObjectives(updated);
    props.onChange(updated);
  };

  return (
    <Flex direction="column" gap={2}>
      {objectives.map((objective, index) => (
        <Flex key={index} gap="xs" align="center">
          <TextInput
            size={"xs"}
            flex={1}
            value={objective.title}
            onChange={(e) => updateObjective(index, e.currentTarget.value)}
            placeholder="Objective description"
            rightSection={
              <ActionButton
                color="red"
                variant="subtle"
                onClick={() => removeObjective(index)}
              >
                <IconTrash size={theme.icon.size.sm} />
              </ActionButton>
            }
          />
        </Flex>
      ))}

      <Flex gap="xs" align="center">
        <TextInput
          size={"xs"}
          flex={1}
          w={"300px"}
          value={newObjective}
          onChange={(e) => setNewObjective(e.currentTarget.value)}
          placeholder="Add new objective..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addObjective();
            }
          }}
          rightSection={
            <ActionButton
              size={"xs"}
              icon={IconPlus}
              variant="minimal"
              onClick={addObjective}
              disabled={!newObjective.trim()}
            />
          }
        />
      </Flex>
    </Flex>
  );
};

export default TaskCreateObjectives;
