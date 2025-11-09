import type { TObject } from "@alepha/core";
import {
  ActionIcon,
  Badge,
  Code,
  Divider,
  Group,
  Popover,
  Stack,
  Text,
  TextInput,
  type TextInputProps,
} from "@mantine/core";
import { IconFilter, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";
import {
  extractSchemaFields,
  OPERATOR_INFO,
  type SchemaField,
} from "../../utils/extractSchemaFields.ts";

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
const ControlQueryBuilder = ({
  schema,
  value = "",
  onChange,
  placeholder = "Enter query or click help for assistance...",
  ...textInputProps
}: ControlQueryBuilderProps) => {
  const [helpOpened, setHelpOpened] = useState(false);
  const [textValue, setTextValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const fields = schema ? extractSchemaFields(schema) : [];

  const handleTextChange = (newValue: string) => {
    setTextValue(newValue);
    onChange?.(newValue);
  };

  const handleClear = () => {
    setTextValue("");
    onChange?.("");
  };

  const handleInsert = (text: string) => {
    const newValue = textValue ? `${textValue}${text} ` : `${text} `;
    setTextValue(newValue);
    onChange?.(newValue);
    // Refocus the input after inserting
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  return (
    <Popover
      width={800}
      position="bottom-start"
      shadow="md"
      opened={helpOpened}
      onChange={setHelpOpened}
      closeOnClickOutside
      closeOnEscape
      withArrow
      arrowSize={14}
      transitionProps={{
        transition: "fade-down",
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
          leftSection={<IconFilter size={16} />}
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
      <Popover.Dropdown>
        <QueryHelp fields={fields} onInsert={handleInsert} />
      </Popover.Dropdown>
    </Popover>
  );
};

// ---------------------------------------------------------------------------------------------------------------------
// Query Help Component
// ---------------------------------------------------------------------------------------------------------------------

interface QueryHelpProps {
  fields: SchemaField[];
  onInsert: (text: string) => void;
}

function QueryHelp({ fields, onInsert }: QueryHelpProps) {
  return (
    <Group gap="md" align="flex-start" wrap="nowrap">
      {/* Left Column: Operators */}
      <Stack gap="md" style={{ flex: 1 }}>
        {/* Available Operators */}
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Operators
          </Text>
          <Stack gap={4}>
            {Object.entries(OPERATOR_INFO).map(([key, info]) => (
              <Group key={key} gap="xs" wrap="nowrap">
                <Code
                  style={{
                    minWidth: 35,
                    textAlign: "center",
                    cursor: "pointer",
                  }}
                  onClick={() => onInsert(info.symbol)}
                >
                  {info.symbol}
                </Code>
                <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                  {info.label}
                </Text>
              </Group>
            ))}
          </Stack>
        </Stack>

        <Divider />

        {/* Logic Operators */}
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Logic
          </Text>
          <Stack gap={4}>
            <Group gap="xs" wrap="nowrap">
              <Code
                style={{
                  minWidth: 35,
                  textAlign: "center",
                  cursor: "pointer",
                }}
                onClick={() => onInsert("&")}
              >
                &
              </Code>
              <Text size="xs" c="dimmed">
                AND
              </Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Code
                style={{
                  minWidth: 35,
                  textAlign: "center",
                  cursor: "pointer",
                }}
                onClick={() => onInsert("|")}
              >
                |
              </Code>
              <Text size="xs" c="dimmed">
                OR
              </Text>
            </Group>
          </Stack>
        </Stack>
      </Stack>

      {/* Divider */}
      {fields.length > 0 && <Divider orientation="vertical" />}

      {/* Right Column: Fields */}
      {fields.length > 0 && (
        <Stack gap="xs" style={{ flex: 2 }}>
          <Text size="sm" fw={600}>
            Fields
          </Text>
          <Stack gap={4} style={{ maxHeight: 300, overflowY: "auto" }}>
            {fields.map((field) => (
              <Group key={field.path} gap="xs" wrap="nowrap" align="flex-start">
                <Code
                  style={{ minWidth: 120, cursor: "pointer" }}
                  onClick={() => onInsert(field.path)}
                >
                  {field.path}
                </Code>
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {field.description || field.type}
                  </Text>
                  {field.enum && (
                    <Group gap={4} wrap="wrap">
                      {field.enum.map((enumValue) => (
                        <Code
                          key={enumValue}
                          style={{
                            cursor: "pointer",
                            fontStyle: "italic",
                            fontSize: "0.75rem",
                          }}
                          c="blue"
                          onClick={() => onInsert(enumValue)}
                        >
                          {enumValue}
                        </Code>
                      ))}
                    </Group>
                  )}
                </Stack>
                <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                  {field.type}
                </Badge>
              </Group>
            ))}
          </Stack>
        </Stack>
      )}
    </Group>
  );
}

export default ControlQueryBuilder;
