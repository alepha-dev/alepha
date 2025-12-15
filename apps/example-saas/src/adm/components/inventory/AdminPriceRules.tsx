import { useAction, useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlus, IconTrash, IconTrendingUp } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { AdminInventoryController } from "../../../api/inventory/controllers/AdminInventoryController.ts";
import type { PriceRule } from "../../../api/pricing/entities/priceRules.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const ruleTypeColors: Record<string, string> = {
  occupancy: "blue",
  time_to_departure: "orange",
  day_of_week: "purple",
  peak_hours: "red",
};

const ruleTypeLabels: Record<string, string> = {
  occupancy: "Occupancy",
  time_to_departure: "Time to Departure",
  day_of_week: "Day of Week",
  peak_hours: "Peak Hours",
};

type RuleType =
  | "occupancy"
  | "time_to_departure"
  | "day_of_week"
  | "peak_hours";

const AdminPriceRules = () => {
  const client = useClient<AdminInventoryController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    ruleType: "occupancy" as RuleType,
    thresholds: [{ value: 50, multiplier: 1.1 }] as Array<{
      value: number;
      multiplier: number;
    }>,
    dayMultipliers: {} as Record<string, number>,
    hourMultipliers: {} as Record<string, number>,
    priority: 100,
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.name) return;

        const config: {
          thresholds?: Array<{ value: number; multiplier: number }>;
          dayMultipliers?: Record<string, number>;
          hourMultipliers?: Record<string, number>;
        } = {};

        if (
          createForm.ruleType === "occupancy" ||
          createForm.ruleType === "time_to_departure"
        ) {
          config.thresholds = createForm.thresholds;
        } else if (createForm.ruleType === "day_of_week") {
          config.dayMultipliers = createForm.dayMultipliers;
        } else if (createForm.ruleType === "peak_hours") {
          config.hourMultipliers = createForm.hourMultipliers;
        }

        await client.createPriceRule({
          body: {
            name: createForm.name,
            description: createForm.description || undefined,
            ruleType: createForm.ruleType,
            config,
            priority: createForm.priority,
          },
        });

        closeCreate();
        setCreateForm({
          name: "",
          description: "",
          ruleType: "occupancy",
          thresholds: [{ value: 50, multiplier: 1.1 }],
          dayMultipliers: {},
          hourMultipliers: {},
          priority: 100,
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    ruleType: t.optional(
      t.enum(["occupancy", "time_to_departure", "day_of_week", "peak_hours"]),
    ),
    active: t.optional(t.boolean()),
  });

  const formatConfig = (rule: PriceRule): string => {
    switch (rule.ruleType) {
      case "occupancy":
      case "time_to_departure":
        if (rule.config.thresholds && rule.config.thresholds.length > 0) {
          return rule.config.thresholds
            .map(
              (threshold) =>
                `${rule.ruleType === "occupancy" ? `${threshold.value}%` : `${threshold.value}d`} → ${threshold.multiplier}x`,
            )
            .join(", ");
        }
        return "No thresholds";
      case "day_of_week":
        if (rule.config.dayMultipliers) {
          return Object.entries(rule.config.dayMultipliers)
            .map(([day, mult]) => `${day.slice(0, 3)}: ${mult}x`)
            .join(", ");
        }
        return "No days configured";
      case "peak_hours":
        if (rule.config.hourMultipliers) {
          return Object.entries(rule.config.hourMultipliers)
            .map(([hour, mult]) => `${hour}h: ${mult}x`)
            .join(", ");
        }
        return "No hours configured";
      default:
        return "Unknown";
    }
  };

  // Add threshold
  const addThreshold = () => {
    setCreateForm({
      ...createForm,
      thresholds: [...createForm.thresholds, { value: 0, multiplier: 1.0 }],
    });
  };

  // Remove threshold
  const removeThreshold = (index: number) => {
    setCreateForm({
      ...createForm,
      thresholds: createForm.thresholds.filter((_, i) => i !== index),
    });
  };

  // Update threshold
  const updateThreshold = (
    index: number,
    field: "value" | "multiplier",
    value: number,
  ) => {
    const newThresholds = [...createForm.thresholds];
    newThresholds[index] = { ...newThresholds[index], [field]: value };
    setCreateForm({ ...createForm, thresholds: newThresholds });
  };

  return (
    <Flex flex={1} direction="column">
      <DataTable<PriceRule, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconTrendingUp,
            onClick: openCreate,
            label: "Create Price Rule",
          },
        ]}
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        onFilterChange={(key, value, form) => {
          return form.submit();
        }}
        filters={filters}
        items={async (filters) => {
          const response = await client.findPriceRules({
            query: filters,
          });
          return response as Page<PriceRule>;
        }}
        columns={{
          name: {
            label: "Name",
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm" fw={500}>
                  {item.name}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {item.description}
                </Text>
              </Stack>
            ),
          },
          ruleType: {
            label: "Type",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={ruleTypeColors[item.ruleType] || "gray"}
              >
                {ruleTypeLabels[item.ruleType] || item.ruleType}
              </Badge>
            ),
          },
          config: {
            label: "Configuration",
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace" lineClamp={1}>
                {formatConfig(item)}
              </Text>
            ),
          },
          priority: {
            label: "Priority",
            fit: true,
            value: (item) => (
              <Badge variant="outline" color="gray" size="sm">
                {item.priority}
              </Badge>
            ),
          },
          active: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={item.active ? "green" : "gray"}
              >
                {item.active ? "Active" : "Inactive"}
              </Badge>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
      />

      {/* Create Price Rule Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Price Rule"
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="Peak Season Surge"
            required
            value={createForm.name}
            onChange={(e) =>
              setCreateForm({ ...createForm, name: e.currentTarget.value })
            }
          />

          <Textarea
            label="Description"
            placeholder="Apply price surge during peak travel seasons"
            value={createForm.description}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                description: e.currentTarget.value,
              })
            }
          />

          <Group grow>
            <Select
              label="Rule Type"
              required
              data={[
                { value: "occupancy", label: "Occupancy Based" },
                { value: "time_to_departure", label: "Time to Departure" },
                { value: "day_of_week", label: "Day of Week" },
                { value: "peak_hours", label: "Peak Hours" },
              ]}
              value={createForm.ruleType}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  ruleType: (v as RuleType) || "occupancy",
                })
              }
            />
            <NumberInput
              label="Priority"
              description="Lower = higher priority"
              min={0}
              value={createForm.priority}
              onChange={(v) =>
                setCreateForm({ ...createForm, priority: Number(v) })
              }
            />
          </Group>

          {/* Threshold-based config */}
          {(createForm.ruleType === "occupancy" ||
            createForm.ruleType === "time_to_departure") && (
            <Stack gap="sm">
              <Group justify="space-between">
                <Text size="sm" fw={500}>
                  Thresholds
                </Text>
                <ActionButton
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={addThreshold}
                >
                  Add Threshold
                </ActionButton>
              </Group>
              <Text size="xs" c="dimmed">
                {createForm.ruleType === "occupancy"
                  ? "When occupancy reaches X%, apply Y multiplier"
                  : "When X days remain, apply Y multiplier"}
              </Text>
              {createForm.thresholds.map((threshold, index) => (
                <Card key={index} withBorder p="sm">
                  <Group>
                    <NumberInput
                      label={
                        createForm.ruleType === "occupancy"
                          ? "Occupancy %"
                          : "Days Before"
                      }
                      min={0}
                      max={
                        createForm.ruleType === "occupancy" ? 100 : undefined
                      }
                      value={threshold.value}
                      onChange={(v) =>
                        updateThreshold(index, "value", Number(v))
                      }
                      style={{ flex: 1 }}
                    />
                    <NumberInput
                      label="Multiplier"
                      min={0.1}
                      max={5}
                      step={0.05}
                      decimalScale={2}
                      value={threshold.multiplier}
                      onChange={(v) =>
                        updateThreshold(index, "multiplier", Number(v))
                      }
                      style={{ flex: 1 }}
                    />
                    {createForm.thresholds.length > 1 && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        mt="lg"
                        onClick={() => removeThreshold(index)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Card>
              ))}
            </Stack>
          )}

          {/* Day of week config */}
          {createForm.ruleType === "day_of_week" && (
            <Stack gap="sm">
              <Text size="sm" fw={500}>
                Day Multipliers
              </Text>
              <Text size="xs" c="dimmed">
                Set price multiplier for each day of the week
              </Text>
              {[
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
              ].map((day) => (
                <Group key={day} gap="sm">
                  <Text size="sm" style={{ width: 100 }}>
                    {day.charAt(0).toUpperCase() + day.slice(1)}
                  </Text>
                  <NumberInput
                    min={0.1}
                    max={5}
                    step={0.05}
                    decimalScale={2}
                    value={createForm.dayMultipliers[day] || 1.0}
                    onChange={(v) =>
                      setCreateForm({
                        ...createForm,
                        dayMultipliers: {
                          ...createForm.dayMultipliers,
                          [day]: Number(v),
                        },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </Group>
              ))}
            </Stack>
          )}

          {/* Peak hours config */}
          {createForm.ruleType === "peak_hours" && (
            <Stack gap="sm">
              <Text size="sm" fw={500}>
                Hour Multipliers
              </Text>
              <Text size="xs" c="dimmed">
                Set price multiplier for peak departure hours
              </Text>
              {["6", "7", "8", "9", "17", "18", "19", "20"].map((hour) => (
                <Group key={hour} gap="sm">
                  <Text size="sm" style={{ width: 100 }}>
                    {hour}:00
                  </Text>
                  <NumberInput
                    min={0.1}
                    max={5}
                    step={0.05}
                    decimalScale={2}
                    value={createForm.hourMultipliers[hour] || 1.0}
                    onChange={(v) =>
                      setCreateForm({
                        ...createForm,
                        hourMultipliers: {
                          ...createForm.hourMultipliers,
                          [hour]: Number(v),
                        },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </Group>
              ))}
            </Stack>
          )}

          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeCreate}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="pink"
              onClick={createAction.run}
              loading={createAction.loading}
              disabled={!createForm.name}
            >
              Create
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminPriceRules;
