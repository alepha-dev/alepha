import { ActionButton, Flex, Text, TypeForm } from "@alepha/ui";
import { Box, Card, Code, Group, Loader, Stack } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";
import { jsonSchemaToTypeBox, type TObject, t } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";
import { formatJson, type ParameterValue } from "./types.ts";

export interface ParameterDetailsProps {
  selectedConfig: string | null;
  configValue: ParameterValue | null;
  loading: boolean;
  saving: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}

/**
 * Loading state.
 */
const LoadingState = () => (
  <Box
    flex={1}
    h="100%"
    p="md"
    style={{
      overflow: "hidden",
      minWidth: 0,
      display: "flex",
    }}
  >
    <Flex flex={1} justify="center" align="center" h="100%">
      <Loader size="sm" />
    </Flex>
  </Box>
);

interface ConfigFormProps {
  selectedConfig: string;
  configValue: ParameterValue | null;
  saving: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}

/**
 * The actual form component - only rendered when a config is selected.
 */
const ConfigForm = ({
  selectedConfig,
  configValue,
  saving,
  onSave,
}: ConfigFormProps) => {
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
      return t.object({});
    }
    try {
      return jsonSchemaToTypeBox(configValue.schema) as TObject;
    } catch {
      return t.object({});
    }
  }, [configValue?.schema]);

  const form = useForm(
    {
      schema: schemaForForm,
      initialValues: (currentContent ?? {}) as Record<string, unknown>,
      handler: async (values) => {
        await onSave(values as Record<string, unknown>);
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
      Object.keys(schema.properties as object).length > 0
    );
  }, [configValue?.schema]);

  // Count the number of fields to determine column layout
  const fieldCount = useMemo(() => {
    const schema = configValue?.schema;
    if (
      schema &&
      typeof schema === "object" &&
      "properties" in schema &&
      schema.properties
    ) {
      return Object.keys(schema.properties as object).length;
    }
    return 0;
  }, [configValue?.schema]);

  // Determine optimal column count based on field count
  const columns = useMemo(() => {
    if (fieldCount <= 2) return 1;
    if (fieldCount <= 6) return 2;
    return 3;
  }, [fieldCount]);

  return (
    <Box
      flex={1}
      h="100%"
      style={{
        overflow: "hidden",
        minWidth: 0,
        display: "flex",
      }}
    >
      <Flex direction="column" h="100%" w="100%" style={{ minHeight: 0 }}>
        {/* Content */}
        <Box flex={1} p="md" className="overflow-auto" style={{ minHeight: 0 }}>
          {currentContent !== null ? (
            <Stack gap="lg">
              {/* Form or JSON view */}
              <Box>
                {hasValidSchema ? (
                  <TypeForm
                    form={form}
                    columns={columns}
                    skipSubmitButton
                    fill={false}
                  />
                ) : (
                  <Box>
                    <Text size="xs" c="dimmed" mb={4}>
                      Current Value
                    </Text>
                    <Code block style={{ whiteSpace: "pre-wrap" }}>
                      {formatJson(currentContent)}
                    </Code>
                  </Box>
                )}
              </Box>

              {/* Metadata */}
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

              {/* Scheduled update preview */}
              {configValue?.next && (
                <Card withBorder p="sm" bg="var(--mantine-color-blue-light)">
                  <Stack gap="xs">
                    <Group gap="xs">
                      <IconClock
                        size={14}
                        color="var(--mantine-color-blue-6)"
                      />
                      <Text size="xs" fw={500} c="blue">
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
        </Box>

        {/* Footer with actions */}
        {hasValidSchema && currentContent !== null && (
          <Box
            p="md"
            style={{
              flexShrink: 0,
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            <Group justify="flex-end" gap="sm">
              <ActionButton
                variant="subtle"
                onClick={() => form.reset({} as any)}
                disabled={saving}
              >
                Reset
              </ActionButton>
              <ActionButton intent="primary" form={form} loading={saving}>
                Save Changes
              </ActionButton>
            </Group>
          </Box>
        )}
      </Flex>
    </Box>
  );
};

/**
 * Parameter details panel.
 * Shows loading state or the config form.
 * Note: Empty state is handled by parent (AdminParameters).
 */
const ParameterDetails = ({
  selectedConfig,
  configValue,
  loading,
  saving,
  onSave,
}: ParameterDetailsProps) => {
  // Loading state
  if (loading) {
    return <LoadingState />;
  }

  // Config form (selectedConfig is guaranteed to be non-null by parent)
  return (
    <ConfigForm
      selectedConfig={selectedConfig!}
      configValue={configValue}
      saving={saving}
      onSave={onSave}
    />
  );
};

export default ParameterDetails;
