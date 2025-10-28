import { Button, Group, Text } from "@mantine/core";
import type { ConfirmDialogProps } from "../../services/DialogService";

export function ConfirmDialog({ options, onConfirm }: ConfirmDialogProps) {
  return (
    <>
      {options?.message && <Text mb="md">{options.message}</Text>}
      <Group justify="flex-end">
        <Button variant="subtle" onClick={() => onConfirm(false)}>
          {options?.cancelLabel || "Cancel"}
        </Button>
        <Button
          color={options?.confirmColor || "blue"}
          onClick={() => onConfirm(true)}
        >
          {options?.confirmLabel || "Confirm"}
        </Button>
      </Group>
    </>
  );
}
