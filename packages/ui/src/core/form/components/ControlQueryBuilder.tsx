import { extractSchemaFields, ui } from "@alepha/ui";
import {
  ActionIcon,
  Popover,
  TextInput,
  type TextInputProps,
} from "@mantine/core";
import { IconFilter, IconInfoTriangle, IconX } from "@tabler/icons-react";
import type { TObject } from "alepha";
import { parseQueryString } from "alepha/orm";
import { useEvents } from "alepha/react";
import { useRef, useState } from "react";
import ControlQueryBuilderHelp from "./ControlQueryBuilderHelp.tsx";

export interface ControlQueryBuilderProps
  extends Omit<TextInputProps, "value" | "onChange"> {
  schema?: TObject;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}

/**
 * Query builder with text input and help popover.
 * Generates query strings for parseQueryString syntax.
 */
const ControlQueryBuilder = (props: ControlQueryBuilderProps) => {
  const {
    schema,
    value = "",
    onChange,
    placeholder = "Enter query or click for assistance...",
    ...textInputProps
  } = props;

  const [helpOpened, setHelpOpened] = useState(false);
  const [textValue, setTextValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const fields = schema ? extractSchemaFields(schema) : [];
  const [error, setError] = useState<string | null>(null);

  const isValid = (value: string) => {
    try {
      parseQueryString(value.trim());
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
    setError(null);
    return true;
  };

  const handleTextChange = (newValue: string) => {
    setTextValue(newValue);
    if (isValid(newValue)) {
      onChange?.(newValue);
    }
  };

  const handleClear = () => {
    setTextValue("");
    onChange?.("");
    isValid("");
  };

  const handleInsert = (text: string) => {
    const newValue = textValue ? `${textValue}${text} ` : `${text} `;
    setTextValue(newValue);
    if (isValid(newValue)) {
      onChange?.(newValue);
    }
    // Refocus the input after inserting
    setTimeout(() => {
      inputRef.current?.focus();
      // set cursor to end
      const length = inputRef.current?.value.length || 0;
      inputRef.current?.setSelectionRange(length, length);
    }, 0);
  };

  useEvents(
    {
      "form:change": (event) => {
        if (event.id === inputRef.current?.form?.id) {
          if (event.path === (textInputProps as any)["data-path"]) {
            setTextValue(event.value ?? "");
          }
        }
      },
    },
    [],
  );

  return (
    <Popover
      width={800}
      position="bottom-start"
      shadow="md"
      opened={helpOpened}
      onChange={setHelpOpened}
      closeOnClickOutside
      closeOnEscape
      transitionProps={{
        transition: "fade-up",
        duration: 200,
        timingFunction: "ease",
      }}
    >
      <Popover.Target>
        <TextInput
          ref={inputRef}
          placeholder={placeholder}
          value={textValue}
          onChange={(e) => handleTextChange(e.currentTarget.value)}
          onFocus={() => setHelpOpened(true)}
          leftSection={
            error ? <IconInfoTriangle size={16} /> : <IconFilter size={16} />
          }
          rightSection={
            textValue && (
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={handleClear}
              >
                <IconX size={14} />
              </ActionIcon>
            )
          }
          {...textInputProps}
        />
      </Popover.Target>
      <Popover.Dropdown
        bg={"transparent"}
        p={"xs"}
        bd={`1px solid ${ui.colors.border}`}
        style={{
          backdropFilter: "blur(20px)",
        }}
      >
        <ControlQueryBuilderHelp fields={fields} onInsert={handleInsert} />
      </Popover.Dropdown>
    </Popover>
  );
};

export default ControlQueryBuilder;
