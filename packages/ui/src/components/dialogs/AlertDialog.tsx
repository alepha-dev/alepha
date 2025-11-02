import { Button, Group, Text } from "@mantine/core";
import type { AlertDialogProps } from "../../services/DialogService";

const AlertDialog = ({ options, onClose }: AlertDialogProps) => (
  <>
    {options?.message && <Text mb="md">{options.message}</Text>}
    <Group justify="flex-end">
      <Button onClick={onClose}>{options?.okLabel || "OK"}</Button>
    </Group>
  </>
);

export default AlertDialog;
