import { useClient, useStore } from "@alepha/react";
import { useDialog } from "@alepha/ui";
import { ActionIcon, Box, Flex, Loader, Text } from "@mantine/core";
import { IconBrush, IconPlus } from "@tabler/icons-react";
import { type ComponentType, useEffect, useState } from "react";
import type { WhiteboardController } from "../../../../api/controllers/WhiteboardController.ts";
import type { Project } from "../../../../api/entities/projects.ts";
import type { Whiteboard } from "../../../../api/entities/whiteboards.ts";
import {
  currentWhiteboardAtom,
  currentWhiteboardsAtom,
} from "../../atoms/currentWhiteboardsAtom.ts";
import type { WhiteboardCanvasProps } from "./whiteboard/types.ts";

export interface ProjectWhiteboardsProps {
  project: Project;
  whiteboards: Whiteboard[];
}

const ProjectWhiteboards = (props: ProjectWhiteboardsProps) => {
  const { project } = props;
  const [whiteboards, setWhiteboards] = useStore(currentWhiteboardsAtom);
  const [currentWhiteboard, setCurrentWhiteboard] = useStore(
    currentWhiteboardAtom,
  );
  const whiteboardApi = useClient<WhiteboardController>();
  const dialog = useDialog();
  const [CanvasComponent, setCanvasComponent] =
    useState<ComponentType<WhiteboardCanvasProps> | null>(null);

  // Dynamically import canvas only on client side (Konva requires browser APIs)
  useEffect(() => {
    import("./whiteboard/WhiteboardCanvas.tsx").then((mod) => {
      setCanvasComponent(() => mod.default);
    });
  }, []);

  const handleCreateWhiteboard = async () => {
    const title = await dialog.prompt({
      title: "Create Drawing",
      message: "Enter a name for the new drawing:",
      placeholder: "My Drawing",
    });

    if (!title) return;

    const newWhiteboard = await whiteboardApi.createWhiteboard({
      body: {
        projectId: project.id,
        title,
      },
    });

    setWhiteboards([...whiteboards, newWhiteboard]);
    setCurrentWhiteboard(newWhiteboard);
  };

  const handleRenameWhiteboard = async () => {
    if (!currentWhiteboard) return;

    const newTitle = await dialog.prompt({
      title: "Rename Drawing",
      message: "Enter a new name:",
      placeholder: currentWhiteboard.title,
      defaultValue: currentWhiteboard.title,
    });

    if (!newTitle || newTitle === currentWhiteboard.title) return;

    const updated = await whiteboardApi.updateWhiteboard({
      params: { id: currentWhiteboard.id },
      body: { title: newTitle },
    });

    setWhiteboards(whiteboards.map((w) => (w.id === updated.id ? updated : w)));
    setCurrentWhiteboard(updated);
  };

  const handleDeleteWhiteboard = async () => {
    if (!currentWhiteboard) return;

    const confirmed = await dialog.confirm({
      title: "Delete Drawing",
      message: `Are you sure you want to delete "${currentWhiteboard.title}"? This action cannot be undone.`,
      color: "red",
    });

    if (!confirmed) return;

    await whiteboardApi.deleteWhiteboard({
      params: { id: currentWhiteboard.id },
    });

    const remaining = whiteboards.filter((w) => w.id !== currentWhiteboard.id);
    setWhiteboards(remaining);
    setCurrentWhiteboard(remaining[0] ?? undefined);
  };

  const handleSelectWhiteboard = (id: string) => {
    const selected = whiteboards.find((w) => String(w.id) === id);
    if (selected) {
      setCurrentWhiteboard(selected);
    }
  };

  const handleSaveWhiteboard = async (data: Whiteboard["data"]) => {
    if (!currentWhiteboard) return;

    const updated = await whiteboardApi.updateWhiteboard({
      params: { id: currentWhiteboard.id },
      body: { data },
    });

    setWhiteboards(whiteboards.map((w) => (w.id === updated.id ? updated : w)));
    setCurrentWhiteboard(updated);
  };

  const whiteboardControls = {
    whiteboards,
    currentWhiteboard,
    onSelectWhiteboard: handleSelectWhiteboard,
    onCreateWhiteboard: handleCreateWhiteboard,
    onRenameWhiteboard: handleRenameWhiteboard,
    onDeleteWhiteboard: handleDeleteWhiteboard,
  };

  return (
    <Box
      h="100%"
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box style={{ flex: 1, overflow: "hidden" }}>
        {!CanvasComponent ? (
          <Flex h="100%" align="center" justify="center">
            <Loader size="lg" />
          </Flex>
        ) : currentWhiteboard ? (
          <CanvasComponent
            whiteboard={currentWhiteboard}
            onSave={handleSaveWhiteboard}
            whiteboardControls={whiteboardControls}
          />
        ) : (
          <Flex
            h="100%"
            align="center"
            justify="center"
            direction="column"
            gap="md"
          >
            <IconBrush size={64} opacity={0.3} />
            <Text c="dimmed" size="lg" ta="center">
              No drawings yet
            </Text>
            <ActionIcon
              variant="light"
              color="green"
              size="lg"
              onClick={handleCreateWhiteboard}
              title="Create drawing"
            >
              <IconPlus size={20} />
            </ActionIcon>
          </Flex>
        )}
      </Box>
    </Box>
  );
};

export default ProjectWhiteboards;
