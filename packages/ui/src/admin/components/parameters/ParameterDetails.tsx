import { Flex, Text, TypeForm } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Code,
  Group,
  Loader,
  ScrollArea,
  Stack,
} from "@mantine/core";
import { IconClock, IconSettings } from "@tabler/icons-react";
import { jsonSchemaToTypeBox, type TObject } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";
import { type ConfigValue, formatJson } from "./types.ts";

export interface ParameterDetailsProps {
  selectedConfig: string | null;
  configValue: ConfigValue | null;
  loading: boolean;
}

const ParameterDetails = ({
  selectedConfig,
  configValue,
  loading,
}: ParameterDetailsProps) => {
  const { l } = useI18n();

  // Get the current value to display (from saved version or default)
  const currentContent = useMemo(() => {
    if (configValue?.current?.content) {
      return configValue.current.content;
    }
    if (configValue?.currentValue !== undefined) {
      return configValue.currentValue;
    }
    return null;
  }, [configValue]);

  // Convert JSON Schema from API to TypeBox schema
  const schemaForForm = useMemo(() => {
    if (!configValue?.schema) {
      return { type: "object", properties: {} } as unknown as TObject;
    }
    return jsonSchemaToTypeBox(configValue.schema) as TObject;
  }, [configValue?.schema]);

  const form = useForm(
    {
      schema: schemaForForm,
      initialValues: (currentContent ?? {}) as Record<string, unknown>,
      handler: async () => {
        // Read-only for now
      },
    },
    [selectedConfig, schemaForForm, currentContent],
  );

  // Check if we have a valid schema with properties
  const hasValidSchema = useMemo(() => {
    const schema = configValue?.schema;
    return (
      schema &&
      typeof schema === "object" &&
      "properties" in schema &&
      Object.keys(schema.properties ?? {}).length > 0
    );
  }, [configValue?.schema]);

  if (!selectedConfig) {
    return (
      <Card withBorder flex={1} h="100%" style={{ overflow: "hidden" }}>
        <Flex flex={1} justify="center" align="center" h="100%">
          <Stack align="center" gap="xs">
            <IconSettings
              size={32}
              stroke={1.5}
              color="var(--mantine-color-dimmed)"
            />
            <Text c="dimmed" size="sm">
              Select a parameter to view its value
            </Text>
          </Stack>
        </Flex>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card withBorder flex={1} h="100%" style={{ overflow: "hidden" }}>
        <Flex flex={1} justify="center" align="center" h="100%">
          <Loader size="sm" />
        </Flex>
      </Card>
    );
  }

  return (
    <Card withBorder flex={1} h="100%" style={{ overflow: "hidden" }}>
      <Stack gap="md" h="100%">
        <Group justify="space-between">
          <Stack gap={2}>
            <Text size="sm" fw={500}>
              {selectedConfig}
            </Text>
            {configValue?.current && (
              <Group gap="xs">
                <Badge size="xs" color="green" variant="light">
                  v{configValue.current.version}
                </Badge>
                {configValue.next && (
                  <Badge size="xs" color="blue" variant="light">
                    Next: v{configValue.next.version}
                  </Badge>
                )}
              </Group>
            )}
            {!configValue?.current &&
              configValue?.currentValue !== undefined && (
                <Badge size="xs" color="yellow" variant="light">
                  Default
                </Badge>
              )}
          </Stack>
        </Group>

        <ScrollArea flex={1} offsetScrollbars>
          {currentContent !== null ? (
            <Stack gap="md">
              <Box>
                <Text size="xs" c="dimmed" mb={4}>
                  Current Value
                </Text>
                {hasValidSchema ? (
                  <TypeForm
                    form={form}
                    columns={1}
                    skipSubmitButton
                    skipFormElement
                  />
                ) : (
                  <Code block style={{ whiteSpace: "pre-wrap" }}>
                    {formatJson(currentContent)}
                  </Code>
                )}
              </Box>

              {configValue?.current?.changeDescription && (
                <Box>
                  <Text size="xs" c="dimmed" mb={4}>
                    Change Description
                  </Text>
                  <Text size="sm">{configValue.current.changeDescription}</Text>
                </Box>
              )}

              {configValue?.current && (
                <Group gap="xl">
                  <Box>
                    <Text size="xs" c="dimmed" mb={2}>
                      Updated
                    </Text>
                    <Text size="sm">
                      {l(configValue.current.updatedAt, { date: "fromNow" })}
                    </Text>
                  </Box>
                  {configValue.current.creatorName && (
                    <Box>
                      <Text size="xs" c="dimmed" mb={2}>
                        Updated By
                      </Text>
                      <Text size="sm">{configValue.current.creatorName}</Text>
                    </Box>
                  )}
                </Group>
              )}

              {!configValue?.current &&
                configValue?.currentValue !== undefined && (
                  <Text size="xs" c="dimmed">
                    This configuration is using its default value. No versions
                    have been saved to the database yet.
                  </Text>
                )}

              {configValue?.next && (
                <Card withBorder bg="blue.0" p="sm">
                  <Stack gap="xs">
                    <Group gap="xs">
                      <IconClock
                        size={14}
                        color="var(--mantine-color-blue-6)"
                      />
                      <Text size="xs" fw={500} c="blue.7">
                        Scheduled Update (v{configValue.next.version})
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Activates{" "}
                      {l(configValue.next.activationDate, {
                        date: "fromNow",
                      })}
                    </Text>
                    <Code block style={{ whiteSpace: "pre-wrap" }} fz="xs">
                      {formatJson(configValue.next.content)}
                    </Code>
                  </Stack>
                </Card>
              )}
            </Stack>
          ) : (
            <Flex justify="center" align="center" h={200}>
              <Text c="dimmed" size="sm">
                No current value
              </Text>
            </Flex>
          )}
        </ScrollArea>
      </Stack>
    </Card>
  );
};

export default ParameterDetails;
