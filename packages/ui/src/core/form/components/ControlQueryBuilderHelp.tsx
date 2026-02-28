import { ActionButton, OPERATOR_INFO, type SchemaField, ui } from "@alepha/ui";
import { Badge, Divider, Flex, Text } from "@mantine/core";

export interface ControlQueryBuilderHelpProps {
  /**
   * Schema fields to display
   */
  fields: SchemaField[];

  /**
   * Callback when a text snippet is inserted
   */
  onInsert: (text: string) => void;
}

const ControlQueryBuilderHelp = (props: ControlQueryBuilderHelpProps) => {
  const { fields, onInsert } = props;

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
};

export default ControlQueryBuilderHelp;
