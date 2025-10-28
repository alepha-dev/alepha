import { Button, Group, Text } from "@mantine/core";
import type { AlertDialogProps } from "../../services/DialogService";

export function AlertDialog({ options, onClose }: AlertDialogProps) {
  return (
    <>
      {options?.message && <Text mb="md">{options.message}</Text>}
      <Group justify="flex-end">
        <Button onClick={onClose}>{options?.okLabel || "OK"}</Button>
      </Group>
    </>
  );
}
