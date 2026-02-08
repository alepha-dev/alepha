import {
  ActionIcon,
  Badge,
  Divider,
  Flex,
  Popover,
  Text,
  TextInput,
  type TextInputProps,
} from "@mantine/core";
import { IconFilter, IconInfoTriangle, IconX } from "@tabler/icons-react";
import type { TObject } from "alepha";
import { parseQueryString } from "alepha/orm";
import { useEvents } from "alepha/react";
import { useRef, useState } from "react";
import { ui } from "../../constants/ui.ts";
import {
  extractSchemaFields,
  OPERATOR_INFO,
  type SchemaField,
} from "../../utils/extractSchemaFields.ts";
import ActionButton from "../buttons/ActionButton.tsx";

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
  placeholder = "Enter query or click for assistance...",
  ...textInputProps
}: ControlQueryBuilderProps) => {
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
    <Flex
      gap="md"
      align="flex-start"
      wrap="nowrap"
      bg={ui.colors.surface}
      p={"sm"}
      bdrs={"sm"}
    >
      {/* Left Column: Operators */}
      <Flex direction="column" gap="md" style={{ flex: 1 }}>
        {/* Available Operators */}
        <Flex direction="column" gap="xs">
          <Text size="sm" fw={600}>
            Operators
          </Text>
          <Flex direction="column" gap={4}>
            {Object.entries(OPERATOR_INFO).map(([key, info]) => (
              <Flex key={key} gap="xs" wrap="nowrap">
                <ActionButton
                  px={"xs"}
                  size={"xs"}
                  h={24}
                  variant={"default"}
                  justify={"center"}
                  miw={48}
                  onClick={() => onInsert(info.symbol)}
                >
                  {info.symbol}
                </ActionButton>
                <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                  {info.label}
                </Text>
              </Flex>
            ))}
          </Flex>
        </Flex>

        <Divider />

        {/* Logic Operators */}
        <Flex direction="column" gap="xs">
          <Text size="sm" fw={600}>
            Logic
          </Text>
          <Flex direction="column" gap={4}>
            <Flex gap="xs" wrap="nowrap">
              <ActionButton
                px={"xs"}
                size={"xs"}
                h={24}
                variant={"default"}
                justify={"center"}
                miw={48}
                onClick={() => onInsert("&")}
              >
                &
              </ActionButton>
              <Text size="xs" c="dimmed">
                AND
              </Text>
            </Flex>
            <Flex gap="xs" wrap="nowrap">
              <ActionButton
                px={"xs"}
                size={"xs"}
                h={24}
                variant={"default"}
                justify={"center"}
                miw={48}
                onClick={() => onInsert("|")}
              >
                |
              </ActionButton>
              <Text size="xs" c="dimmed">
                OR
              </Text>
            </Flex>
          </Flex>
        </Flex>
      </Flex>

      {/* Divider */}
      {fields.length > 0 && <Divider orientation="vertical" />}

      {/* Right Column: Fields */}
      {fields.length > 0 && (
        <Flex direction={"column"} gap="xs" style={{ flex: 2 }}>
          <Text size="sm" fw={600}>
            Fields
          </Text>
          <Flex
            direction={"column"}
            gap={4}
            style={{ maxHeight: 300, overflowY: "auto" }}
          >
            {fields.map((field) => (
              <Flex key={field.path} gap="xs" wrap="nowrap" align="flex-start">
                <ActionButton
                  px={"xs"}
                  size={"xs"}
                  h={24}
                  variant={"default"}
                  justify={"end"}
                  miw={120}
                  onClick={() => onInsert(field.path)}
                >
                  {field.path}
                </ActionButton>
                <Flex
                  mt={3}
                  direction={"column"}
                  gap={2}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {field.description || field.type}
                  </Text>
                  {field.enum && (
                    <Flex gap={0} wrap="wrap">
                      {field.enum.map((enumValue) => (
                        <ActionButton
                          px={"xs"}
                          size={"xs"}
                          h={24}
                          key={enumValue}
                          onClick={() => onInsert(enumValue)}
                        >
                          {enumValue}
                        </ActionButton>
                      ))}
                    </Flex>
                  )}
                </Flex>
                <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                  {field.type}
                </Badge>
              </Flex>
            ))}
          </Flex>
        </Flex>
      )}
    </Flex>
  );
}

export default ControlQueryBuilder;
