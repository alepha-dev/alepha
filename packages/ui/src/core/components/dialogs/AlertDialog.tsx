import { Button, Flex, Text } from "@mantine/core";
import type { AlertDialogProps } from "../../services/DialogService.tsx";

const AlertDialog = ({ options, onClose }: AlertDialogProps) => (
  <>
    {options?.message && <Text mb="md">{options.message}</Text>}
    <Flex justify="flex-end">
      <Button onClick={onClose}>{options?.okLabel || "OK"}</Button>
    </Flex>
  </>
);

export default AlertDialog;
