import { Button, Group, Text, TextInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { PromptDialogProps } from "../../services/DialogService.tsx";

const PromptDialog = ({ options, onSubmit }: PromptDialogProps) => {
  const [value, setValue] = useState(options?.defaultValue || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // autofocus the input when the dialog opens
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!options?.required || value.trim()) {
      onSubmit(value);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <>
      {options?.message && <Text mb="md">{options.message}</Text>}
      <TextInput
        ref={inputRef}
        label={options?.label}
        placeholder={options?.placeholder}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        required={options?.required}
        mb="md"
      />
      <Group justify="flex-end">
        <Button variant="subtle" onClick={() => onSubmit(null)}>
          {options?.cancelLabel || "Cancel"}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={options?.required && !value.trim()}
        >
          {options?.submitLabel || "OK"}
        </Button>
      </Group>
    </>
  );
};

export default PromptDialog;
