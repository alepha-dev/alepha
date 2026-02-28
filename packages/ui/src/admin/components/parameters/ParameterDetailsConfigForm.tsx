import { ActionButton, Flex, Text, TypeForm } from "@alepha/ui";
import { Card, Code } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";
import { jsonSchemaToTypeBox, type TObject, t } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";
import { formatJson, type ParameterValue } from "./types.ts";

interface Props {
  selectedConfig: string;
  configValue: ParameterValue | null;
  saving: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}

/**
 * The actual form component - only rendered when a config is selected.
 */
const ParameterDetailsConfigForm = (props: Props) => {
  const { l } = useI18n();

  // Get the current value to display (from saved version or default)
  const currentContent = useMemo(() => {
    if (props.configValue?.current?.content) {
      return props.configValue.current.content;
    }
    if (props.configValue?.currentValue !== undefined) {
      return props.configValue.currentValue;
    }
    return null;
  }, [props.configValue]);

  // Convert JSON Schema from API to TypeBox schema
  const schemaForForm = useMemo(() => {
    if (!props.configValue?.schema) {
      return t.object({});
    }
    try {
      return jsonSchemaToTypeBox(props.configValue.schema) as TObject;
    } catch {
      return t.object({});
    }
  }, [props.configValue?.schema]);

  const form = useForm(
    {
      schema: schemaForForm,
      initialValues: (currentContent ?? {}) as Record<string, unknown>,
      handler: async (values) => {
        await props.onSave(values as Record<string, unknown>);
      },
    },
    [props.selectedConfig, schemaForForm, currentContent],
  );

  // Check if we have a valid schema with properties
  const hasValidSchema = useMemo(() => {
    const schema = props.configValue?.schema;
    return (
      schema &&
      typeof schema === "object" &&
      "properties" in schema &&
      Object.keys(schema.properties as object).length > 0
    );
  }, [props.configValue?.schema]);

  // Count the number of fields to determine column layout
  const fieldCount = useMemo(() => {
    const schema = props.configValue?.schema;
    if (
      schema &&
      typeof schema === "object" &&
      "properties" in schema &&
      schema.properties
    ) {
      return Object.keys(schema.properties as object).length;
    }
    return 0;
  }, [props.configValue?.schema]);

  // Determine optimal column count based on field count
  const columns = useMemo(() => {
    if (fieldCount <= 2) return 1;
    if (fieldCount <= 6) return 2;
    return 3;
  }, [fieldCount]);

  return (
    <Flex
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
        <Flex
          flex={1}
          p="md"
          className="overflow-auto"
          style={{ minHeight: 0 }}
        >
          {currentContent !== null ? (
            <Flex direction="column" gap="lg">
              {/* Form or JSON view */}
              <Flex>
                {hasValidSchema ? (
                  <TypeForm
                    form={form}
                    columns={columns}
                    skipSubmitButton
                    fill={false}
                  />
                ) : (
                  <Flex>
                    <Text size="xs" c="dimmed" mb={4}>
                      Current Value
                    </Text>
                    <Code block style={{ whiteSpace: "pre-wrap" }}>
                      {formatJson(currentContent)}
                    </Code>
                  </Flex>
                )}
              </Flex>

              {/* Metadata */}
              {props.configValue?.current?.changeDescription && (
                <Flex>
                  <Text size="xs" c="dimmed" mb={4}>
                    Change Description
                  </Text>
                  <Text size="sm">
                    {props.configValue.current.changeDescription}
                  </Text>
                </Flex>
              )}

              {props.configValue?.current && (
                <Flex gap="xl">
                  <Flex>
                    <Text size="xs" c="dimmed" mb={2}>
                      Updated
                    </Text>
                    <Text size="sm">
                      {l(props.configValue.current.updatedAt, {
                        date: "fromNow",
                      })}
                    </Text>
                  </Flex>
                  {props.configValue.current.creatorName && (
                    <Flex>
                      <Text size="xs" c="dimmed" mb={2}>
                        Updated By
                      </Text>
                      <Text size="sm">
                        {props.configValue.current.creatorName}
                      </Text>
                    </Flex>
                  )}
                </Flex>
              )}

              {!props.configValue?.current &&
                props.configValue?.currentValue !== undefined && (
                  <Text size="xs" c="dimmed">
                    This configuration is using its default value. No versions
                    have been saved to the database yet.
                  </Text>
                )}

              {/* Scheduled update preview */}
              {props.configValue?.next && (
                <Card withBorder p="sm" bg="var(--mantine-color-blue-light)">
                  <Flex direction="column" gap="xs">
                    <Flex gap="xs">
                      <IconClock
                        size={14}
                        color="var(--mantine-color-blue-6)"
                      />
                      <Text size="xs" fw={500} c="blue">
                        Scheduled Update (v{props.configValue.next.version})
                      </Text>
                    </Flex>
                    <Text size="xs" c="dimmed">
                      Activates{" "}
                      {l(props.configValue.next.activationDate, {
                        date: "fromNow",
                      })}
                    </Text>
                    <Code block style={{ whiteSpace: "pre-wrap" }} fz="xs">
                      {formatJson(props.configValue.next.content)}
                    </Code>
                  </Flex>
                </Card>
              )}
            </Flex>
          ) : (
            <Flex justify="center" align="center" h={200}>
              <Text c="dimmed" size="sm">
                No current value
              </Text>
            </Flex>
          )}
        </Flex>

        {/* Footer with actions */}
        {hasValidSchema && currentContent !== null && (
          <Flex
            p="md"
            style={{
              flexShrink: 0,
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            <Flex justify="flex-end" gap="sm">
              <ActionButton
                variant="subtle"
                onClick={() => form.reset({} as any)}
                disabled={props.saving}
              >
                Reset
              </ActionButton>
              <ActionButton intent="primary" form={form} loading={props.saving}>
                Save Changes
              </ActionButton>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};

export default ParameterDetailsConfigForm;
