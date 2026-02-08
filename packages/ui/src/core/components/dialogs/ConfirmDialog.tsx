import { Button, Flex, Text } from "@mantine/core";
import type { ConfirmDialogProps } from "../../services/DialogService.tsx";

const ConfirmDialog = ({ options, onConfirm }: ConfirmDialogProps) => (
  <>
    {options?.message && <Text mb="md">{options.message}</Text>}
    <Flex justify="flex-end">
      <Button variant="subtle" onClick={() => onConfirm(false)}>
        {options?.cancelLabel || "Cancel"}
      </Button>
      <Button
        color={options?.confirmColor || "blue"}
        onClick={() => onConfirm(true)}
      >
        {options?.confirmLabel || "Confirm"}
      </Button>
    </Flex>
  </>
);

export default ConfirmDialog;
