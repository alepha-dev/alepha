import { type BaseDialogOptions, DialogService, ui } from "@alepha/ui";
import { Flex } from "@mantine/core";
import { JsonViewer } from "../components/JsonViewer.tsx";

declare module "@alepha/ui" {
  interface DialogService {
    /**
     * Opens a JSON viewer dialog.
     *
     * @param data - The JSON data to display.
     * @param options - Additional dialog options.
     */
    json(data?: any, options?: BaseDialogOptions): void;
  }
}

DialogService.prototype.json = function (
  data?: any,
  options?: BaseDialogOptions,
) {
  this.open({
    size: "lg",
    title: options?.title || "Json Viewer",
    ...options,
    content: (
      <Flex bdrs={"md"} w={"100%"} flex={1} p={"sm"} bg={ui.colors.surface}>
        <JsonViewer size={"xs"} data={data} />
      </Flex>
    ),
  });
};
