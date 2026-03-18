import type { BaseDialogOptions } from "@alepha/ui";
import { ui } from "@alepha/ui";
import { Flex } from "@mantine/core";
import { JsonViewer } from "../components/JsonViewer.tsx";

/**
 * Creates dialog options for a JSON viewer dialog.
 *
 * @param data - The JSON data to display.
 * @param options - Additional dialog options.
 */
export const dialogJson = (
  data?: any,
  options?: BaseDialogOptions,
): BaseDialogOptions => ({
  size: "lg",
  title: options?.title || "Json Viewer",
  ...options,
  content: (
    <Flex bdrs={"md"} w={"100%"} flex={1} p={"sm"} bg={ui.colors.surface}>
      <JsonViewer size={"xs"} data={data} />
    </Flex>
  ),
});
