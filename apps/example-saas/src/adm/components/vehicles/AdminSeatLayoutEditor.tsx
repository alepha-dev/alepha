import { useAction, useClient, useRouter } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { ActionButton, Control, Flex, Text } from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArmchair,
  IconArrowLeft,
  IconCopy,
  IconDeviceFloppy,
  IconPlus,
  IconSettings,
  IconTrain,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { t } from "alepha";
import { useCallback, useState } from "react";
import type { SeatLayoutController } from "../../../api/vehicles/controllers/SeatLayoutController.ts";
import type {
  SeatLayout,
  SeatPosition,
  Wagon,
  WagonType,
} from "../../../api/vehicles/entities/seatLayouts.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

export interface AdminSeatLayoutEditorProps {
  layout: SeatLayout | null;
}

const wagonTypeLabels: Record<WagonType, string> = {
  first_class: "First Class",
  second_class: "Second Class",
  mixed: "Mixed",
  restaurant: "Restaurant",
  bar: "Bar",
  quiet: "Quiet Zone",
  family: "Family",
  business: "Business",
  accessible: "Accessible",
};

const wagonTypeColors: Record<WagonType, string> = {
  first_class: "yellow",
  second_class: "blue",
  mixed: "grape",
  restaurant: "orange",
  bar: "pink",
  quiet: "teal",
  family: "green",
  business: "indigo",
  accessible: "cyan",
};

// Helper to create a default wagon
function createDefaultWagon(wagonNumber: number): Wagon {
  return {
    wagonNumber,
    wagonType: "second_class",
    rows: [],
    seatsPerRow: 4,
    aisleAfterPosition: "B",
    hasWifi: false,
    hasPowerOutlets: true,
    hasToilet: wagonNumber === 1,
    hasBikeStorage: false,
    hasLuggageRack: true,
  };
}

// Helper to migrate legacy layout to wagon format
function migrateToWagons(layout: SeatLayout | null): Wagon[] {
  if (!layout) return [];

  // If already has wagons, use them
  if (layout.wagons && layout.wagons.length > 0) {
    return layout.wagons;
  }

  // Migrate legacy single-wagon layout
  if (layout.rows && layout.rows.length > 0) {
    const firstClassRows = layout.rows.filter(
      (r) => r.seats[0]?.seatClass === "first",
    ).length;
    const secondClassRows = layout.rows.length - firstClassRows;

    return [
      {
        wagonNumber: 1,
        wagonType:
          firstClassRows > secondClassRows ? "first_class" : "second_class",
        rows: layout.rows,
        seatsPerRow: layout.seatsPerRow ?? 4,
        aisleAfterPosition: layout.aisleAfterPosition ?? "B",
        hasWifi: false,
        hasPowerOutlets: true,
      },
    ];
  }

  return [];
}

const AdminSeatLayoutEditor = (props: AdminSeatLayoutEditorProps) => {
  const { layout: initialLayout } = props;
  const isNew = !initialLayout;
  const router = useRouter<AdmRouter>();
  const client = useClient<SeatLayoutController>();

  // Local state for wagons
  const [wagons, setWagons] = useState<Wagon[]>(migrateToWagons(initialLayout));
  const [activeWagonTab, setActiveWagonTab] = useState<string | null>(
    wagons.length > 0 ? "0" : null,
  );

  // Local state for form values (for controlled inputs)
  const [formValues, setFormValues] = useState({
    name: initialLayout?.name ?? "",
    description: initialLayout?.description ?? "",
    trainType: initialLayout?.trainType ?? "",
    isDefault: initialLayout?.isDefault ?? false,
    active: initialLayout?.active ?? true,
  });

  // Generate form state
  const [generateValues, setGenerateValues] = useState({
    totalRows: 10,
    seatsPerRow: 4,
    firstClassRows: 3,
    aisleAfterPosition: "B",
  });

  // Train generation state
  const [trainConfig, setTrainConfig] = useState<
    Array<{
      wagonType: WagonType;
      count: number;
      rowsPerWagon: number;
      seatsPerRow: number;
      aisleAfterPosition: string;
    }>
  >([
    {
      wagonType: "first_class",
      count: 1,
      rowsPerWagon: 8,
      seatsPerRow: 4,
      aisleAfterPosition: "B",
    },
    {
      wagonType: "second_class",
      count: 3,
      rowsPerWagon: 12,
      seatsPerRow: 4,
      aisleAfterPosition: "B",
    },
  ]);

  // Modal states
  const [generateOpened, { open: openGenerate, close: closeGenerate }] =
    useDisclosure(false);
  const [
    generateTrainOpened,
    { open: openGenerateTrain, close: closeGenerateTrain },
  ] = useDisclosure(false);
  const [editSeatOpened, { open: openEditSeat, close: closeEditSeat }] =
    useDisclosure(false);
  const [editWagonOpened, { open: openEditWagon, close: closeEditWagon }] =
    useDisclosure(false);
  const [selectedSeat, setSelectedSeat] = useState<{
    wagonIndex: number;
    rowIndex: number;
    seatIndex: number;
  } | null>(null);

  // Form for layout metadata
  const form = useForm({
    schema: t.object({
      name: t.text(),
      description: t.optional(t.text()),
      trainType: t.text(),
      isDefault: t.boolean(),
      active: t.boolean(),
    }),
    initialValues: formValues,
    handler: async (data) => {
      if (isNew) {
        const created = await client.createSeatLayout({
          body: {
            name: data.name,
            description: data.description,
            trainType: data.trainType,
            wagons,
            isDefault: data.isDefault,
          },
        });
        await router.go("adminSeatLayoutEditor", {
          params: { id: created.id },
          force: true,
        });
      } else {
        await client.updateSeatLayout({
          params: { id: initialLayout!.id },
          body: {
            name: data.name,
            description: data.description,
            trainType: data.trainType,
            wagons,
            isDefault: data.isDefault,
            active: data.active,
          },
        });
      }
    },
  });

  // Generate wagon handler
  const generateWagonAction = useAction(
    {
      handler: async () => {
        const wagonIndex = activeWagonTab
          ? Number.parseInt(activeWagonTab, 10)
          : 0;
        const wagon = wagons[wagonIndex];
        if (!wagon) return;

        const result = await client.generateWagon({
          body: {
            wagonNumber: wagon.wagonNumber,
            wagonType: wagon.wagonType,
            totalRows: generateValues.totalRows,
            seatsPerRow: generateValues.seatsPerRow,
            firstClassRows: generateValues.firstClassRows,
            aisleAfterPosition: generateValues.aisleAfterPosition,
          },
        });

        const newWagons = [...wagons];
        newWagons[wagonIndex] = {
          ...result,
          // Preserve wagon-level settings
          hasWifi: wagon.hasWifi,
          hasPowerOutlets: wagon.hasPowerOutlets,
          hasToilet: wagon.hasToilet,
          hasBikeStorage: wagon.hasBikeStorage,
          hasLuggageRack: wagon.hasLuggageRack,
        };
        setWagons(newWagons);
        closeGenerate();
      },
    },
    [activeWagonTab, wagons, generateValues],
  );

  // Generate full train handler
  const generateTrainAction = useAction(
    {
      handler: async () => {
        const result = await client.generateTrain({
          body: {
            trainType: formValues.trainType || "Generic",
            configuration: trainConfig,
          },
        });
        setWagons(result.wagons);
        setActiveWagonTab("0");
        closeGenerateTrain();
      },
    },
    [formValues.trainType, trainConfig],
  );

  // Delete action
  const deleteAction = useAction(
    {
      handler: async () => {
        if (!initialLayout) return;
        await client.deleteSeatLayout({ params: { id: initialLayout.id } });
        await router.go("adminSeatLayouts");
      },
    },
    [initialLayout],
  );

  // Clone action
  const cloneAction = useAction(
    {
      handler: async () => {
        if (!initialLayout) return;
        const cloned = await client.cloneSeatLayout({
          params: { id: initialLayout.id },
          body: { name: `${initialLayout.name} (Copy)` },
        });
        await router.go("adminSeatLayoutEditor", {
          params: { id: cloned.id },
          force: true,
        });
      },
    },
    [initialLayout],
  );

  // Add wagon
  const addWagon = useCallback(() => {
    const newWagonNumber =
      wagons.length > 0 ? Math.max(...wagons.map((w) => w.wagonNumber)) + 1 : 1;
    const newWagon = createDefaultWagon(newWagonNumber);
    setWagons([...wagons, newWagon]);
    setActiveWagonTab(String(wagons.length));
  }, [wagons]);

  // Remove wagon
  const removeWagon = useCallback(
    (wagonIndex: number) => {
      const newWagons = wagons.filter((_, i) => i !== wagonIndex);
      // Renumber wagons
      const renumbered = newWagons.map((w, i) => ({
        ...w,
        wagonNumber: i + 1,
      }));
      setWagons(renumbered);
      if (wagonIndex >= renumbered.length) {
        setActiveWagonTab(
          renumbered.length > 0 ? String(renumbered.length - 1) : null,
        );
      }
    },
    [wagons],
  );

  // Update wagon
  const updateWagon = useCallback(
    (wagonIndex: number, updates: Partial<Wagon>) => {
      const newWagons = [...wagons];
      newWagons[wagonIndex] = { ...newWagons[wagonIndex], ...updates };
      setWagons(newWagons);
    },
    [wagons],
  );

  // Add row to wagon
  const addRow = useCallback(
    (wagonIndex: number) => {
      const wagon = wagons[wagonIndex];
      if (!wagon) return;

      const newRowNumber =
        wagon.rows.length > 0
          ? Math.max(...wagon.rows.map((r) => r.rowNumber)) + 1
          : 1;

      const positions: string[] = [];
      for (let i = 0; i < wagon.seatsPerRow; i++) {
        positions.push(String.fromCharCode(65 + i));
      }

      const aisleIndex = positions.indexOf(wagon.aisleAfterPosition ?? "B");
      const isFirstClass =
        wagon.wagonType === "first_class" || wagon.wagonType === "business";

      const newSeats: SeatPosition[] = positions.map((pos, i) => {
        let seatType: "window" | "aisle" | "middle";
        if (i === 0 || i === positions.length - 1) {
          seatType = "window";
        } else if (i === aisleIndex || i === aisleIndex + 1) {
          seatType = "aisle";
        } else {
          seatType = "middle";
        }

        return {
          position: pos,
          seatType,
          seatClass: isFirstClass ? ("first" as const) : ("second" as const),
          premium: isFirstClass ? 35 : 0,
        };
      });

      const newWagons = [...wagons];
      newWagons[wagonIndex] = {
        ...wagon,
        rows: [...wagon.rows, { rowNumber: newRowNumber, seats: newSeats }],
      };
      setWagons(newWagons);
    },
    [wagons],
  );

  // Remove row from wagon
  const removeRow = useCallback(
    (wagonIndex: number, rowIndex: number) => {
      const wagon = wagons[wagonIndex];
      if (!wagon) return;

      const newWagons = [...wagons];
      newWagons[wagonIndex] = {
        ...wagon,
        rows: wagon.rows.filter((_, i) => i !== rowIndex),
      };
      setWagons(newWagons);
    },
    [wagons],
  );

  // Update seat
  const updateSeat = useCallback(
    (
      wagonIndex: number,
      rowIndex: number,
      seatIndex: number,
      updates: Partial<SeatPosition>,
    ) => {
      const newWagons = [...wagons];
      const wagon = newWagons[wagonIndex];
      if (!wagon) return;

      wagon.rows = wagon.rows.map((row, ri) =>
        ri === rowIndex
          ? {
              ...row,
              seats: row.seats.map((seat, si) =>
                si === seatIndex ? { ...seat, ...updates } : seat,
              ),
            }
          : row,
      );
      setWagons(newWagons);
    },
    [wagons],
  );

  // Toggle row class
  const toggleRowClass = useCallback(
    (wagonIndex: number, rowIndex: number) => {
      const wagon = wagons[wagonIndex];
      if (!wagon) return;

      const row = wagon.rows[rowIndex];
      const currentClass = row?.seats[0]?.seatClass ?? "second";
      const newClass = currentClass === "first" ? "second" : "first";
      const newPremium = newClass === "first" ? 35 : 0;

      const newWagons = [...wagons];
      newWagons[wagonIndex] = {
        ...wagon,
        rows: wagon.rows.map((r, ri) =>
          ri === rowIndex
            ? {
                ...r,
                seats: r.seats.map((seat) => ({
                  ...seat,
                  seatClass: newClass,
                  premium: newPremium,
                })),
              }
            : r,
        ),
      };
      setWagons(newWagons);
    },
    [wagons],
  );

  // Calculate totals
  const totals = {
    total: wagons.reduce(
      (sum, wagon) =>
        sum +
        wagon.rows.reduce(
          (rowSum, row) => rowSum + row.seats.filter((s) => !s.blocked).length,
          0,
        ),
      0,
    ),
    first: wagons.reduce(
      (sum, wagon) =>
        sum +
        wagon.rows.reduce(
          (rowSum, row) =>
            rowSum +
            row.seats.filter((s) => s.seatClass === "first" && !s.blocked)
              .length,
          0,
        ),
      0,
    ),
    second: wagons.reduce(
      (sum, wagon) =>
        sum +
        wagon.rows.reduce(
          (rowSum, row) =>
            rowSum +
            row.seats.filter((s) => s.seatClass === "second" && !s.blocked)
              .length,
          0,
        ),
      0,
    ),
    wagons: wagons.length,
  };

  // Get seat color
  const getSeatColor = (seat: SeatPosition) => {
    if (seat.blocked) return "var(--mantine-color-gray-4)";
    if (seat.seatClass === "first") return "var(--mantine-color-yellow-3)";
    return "var(--alepha-surface)";
  };

  // Open seat editor
  const handleSeatClick = (
    wagonIndex: number,
    rowIndex: number,
    seatIndex: number,
  ) => {
    setSelectedSeat({ wagonIndex, rowIndex, seatIndex });
    openEditSeat();
  };

  const selectedSeatData =
    selectedSeat !== null
      ? wagons[selectedSeat.wagonIndex]?.rows[selectedSeat.rowIndex]?.seats[
          selectedSeat.seatIndex
        ]
      : null;

  const activeWagonIndex = activeWagonTab
    ? Number.parseInt(activeWagonTab, 10)
    : 0;
  const activeWagon = wagons[activeWagonIndex];

  return (
    <Flex flex={1} direction="column" gap="lg">
      {/* Header */}
      <Group justify="space-between">
        <Group gap="md">
          <ActionButton
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => router.go("adminSeatLayouts")}
          >
            Back
          </ActionButton>
          <Divider orientation="vertical" />
          <Title order={3}>
            {isNew ? "Create Seat Layout" : "Edit Seat Layout"}
          </Title>
        </Group>
        <Group gap="sm">
          {!isNew && (
            <>
              <ActionButton
                variant="subtle"
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={deleteAction.run}
                loading={deleteAction.loading}
              >
                Delete
              </ActionButton>
              <ActionButton
                variant="subtle"
                leftSection={<IconCopy size={16} />}
                onClick={cloneAction.run}
                loading={cloneAction.loading}
              >
                Clone
              </ActionButton>
            </>
          )}
          <ActionButton
            variant="filled"
            color="pink"
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={() => form.submit()}
            loading={form.submitting}
          >
            {isNew ? "Create Layout" : "Save Changes"}
          </ActionButton>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
        {/* Left: Visual Editor */}
        <Stack gap="md">
          <Card withBorder radius="md" p="lg" bg="var(--alepha-elevated)">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Train Configuration</Text>
                <Group gap="sm">
                  <ActionButton
                    variant="light"
                    size="xs"
                    leftSection={<IconTrain size={14} />}
                    onClick={openGenerateTrain}
                  >
                    Generate Train
                  </ActionButton>
                  <ActionButton
                    variant="light"
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    onClick={addWagon}
                  >
                    Add Wagon
                  </ActionButton>
                </Group>
              </Group>

              {/* Wagon Tabs */}
              {wagons.length === 0 ? (
                <Card withBorder p="xl" ta="center" bg="var(--alepha-surface)">
                  <Stack gap="md" align="center">
                    <Text c="dimmed">No wagons configured</Text>
                    <Group gap="sm">
                      <ActionButton
                        variant="light"
                        leftSection={<IconTrain size={16} />}
                        onClick={openGenerateTrain}
                      >
                        Generate Train
                      </ActionButton>
                      <ActionButton
                        variant="light"
                        leftSection={<IconPlus size={16} />}
                        onClick={addWagon}
                      >
                        Add Wagon
                      </ActionButton>
                    </Group>
                  </Stack>
                </Card>
              ) : (
                <Tabs
                  value={activeWagonTab}
                  onChange={setActiveWagonTab}
                  variant="outline"
                >
                  <Tabs.List>
                    {wagons.map((wagon, index) => (
                      <Tabs.Tab
                        key={index}
                        value={String(index)}
                        leftSection={
                          <Badge
                            size="xs"
                            variant="light"
                            color={wagonTypeColors[wagon.wagonType]}
                          >
                            {wagon.wagonNumber}
                          </Badge>
                        }
                      >
                        {wagonTypeLabels[wagon.wagonType]}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>

                  {wagons.map((wagon, wagonIndex) => (
                    <Tabs.Panel key={wagonIndex} value={String(wagonIndex)}>
                      <Stack gap="md" mt="md">
                        {/* Wagon Header */}
                        <Group justify="space-between">
                          <Group gap="sm">
                            <Badge
                              size="lg"
                              variant="light"
                              color={wagonTypeColors[wagon.wagonType]}
                            >
                              Wagon {wagon.wagonNumber}
                            </Badge>
                            <Text size="sm" c="dimmed">
                              {wagonTypeLabels[wagon.wagonType]}
                            </Text>
                          </Group>
                          <Group gap="xs">
                            <ActionButton
                              variant="light"
                              size="xs"
                              leftSection={<IconSettings size={14} />}
                              onClick={openEditWagon}
                            >
                              Settings
                            </ActionButton>
                            <ActionButton
                              variant="light"
                              size="xs"
                              leftSection={<IconWand size={14} />}
                              onClick={openGenerate}
                            >
                              Generate
                            </ActionButton>
                            <ActionButton
                              variant="light"
                              size="xs"
                              leftSection={<IconPlus size={14} />}
                              onClick={() => addRow(wagonIndex)}
                            >
                              Add Row
                            </ActionButton>
                            {wagons.length > 1 && (
                              <ActionButton
                                variant="light"
                                size="xs"
                                color="red"
                                leftSection={<IconTrash size={14} />}
                                onClick={() => removeWagon(wagonIndex)}
                              >
                                Remove
                              </ActionButton>
                            )}
                          </Group>
                        </Group>

                        {/* Legend */}
                        <Group gap="lg">
                          <Group gap="xs">
                            <Box
                              w={20}
                              h={20}
                              bg="var(--mantine-color-yellow-3)"
                              style={{
                                borderRadius: 4,
                                border:
                                  "2px solid var(--mantine-color-yellow-5)",
                              }}
                            />
                            <Text size="xs">1st Class</Text>
                          </Group>
                          <Group gap="xs">
                            <Box
                              w={20}
                              h={20}
                              bg="var(--alepha-surface)"
                              style={{ borderRadius: 4 }}
                            />
                            <Text size="xs">2nd Class</Text>
                          </Group>
                          <Group gap="xs">
                            <Box
                              w={20}
                              h={20}
                              bg="var(--mantine-color-gray-4)"
                              style={{ borderRadius: 4 }}
                            />
                            <Text size="xs">Blocked</Text>
                          </Group>
                        </Group>

                        <Divider />

                        {/* Seat Map for this Wagon */}
                        <Flex direction="column" align="center" gap="sm">
                          <Badge variant="light" color="dark" mb="sm">
                            Front of Wagon {wagon.wagonNumber}
                          </Badge>

                          {wagon.rows.length === 0 ? (
                            <Card
                              withBorder
                              p="xl"
                              ta="center"
                              bg="var(--alepha-surface)"
                            >
                              <Stack gap="md" align="center">
                                <Text c="dimmed">No rows in this wagon</Text>
                                <Group gap="sm">
                                  <ActionButton
                                    variant="light"
                                    leftSection={<IconWand size={16} />}
                                    onClick={openGenerate}
                                  >
                                    Generate
                                  </ActionButton>
                                  <ActionButton
                                    variant="light"
                                    leftSection={<IconPlus size={16} />}
                                    onClick={() => addRow(wagonIndex)}
                                  >
                                    Add Row
                                  </ActionButton>
                                </Group>
                              </Stack>
                            </Card>
                          ) : (
                            wagon.rows.map((row, rowIndex) => {
                              const isFirstClass =
                                row.seats[0]?.seatClass === "first";
                              const aislePosition =
                                wagon.aisleAfterPosition ?? "B";
                              const aisleIndex =
                                row.seats.findIndex(
                                  (s) => s.position === aislePosition,
                                ) + 1;

                              return (
                                <Flex key={rowIndex} gap="md" align="center">
                                  <Text size="xs" c="dimmed" w={20} ta="right">
                                    {row.rowNumber}
                                  </Text>
                                  <Group gap="xs">
                                    {row.seats
                                      .slice(0, aisleIndex)
                                      .map((seat, seatIndex) => (
                                        <Tooltip
                                          key={seatIndex}
                                          label={`${row.rowNumber}${seat.position} - ${seat.seatType} (${seat.seatClass}${seat.premium > 0 ? `, +$${seat.premium}` : ""}${seat.blocked ? ", blocked" : ""})`}
                                        >
                                          <UnstyledButton
                                            onClick={() =>
                                              handleSeatClick(
                                                wagonIndex,
                                                rowIndex,
                                                seatIndex,
                                              )
                                            }
                                          >
                                            <Flex
                                              w={36}
                                              h={36}
                                              justify="center"
                                              align="center"
                                              bg={getSeatColor(seat)}
                                              style={{
                                                borderRadius: 6,
                                                border: isFirstClass
                                                  ? "2px solid var(--mantine-color-yellow-5)"
                                                  : "1px solid var(--alepha-border)",
                                                opacity: seat.blocked ? 0.5 : 1,
                                                color:
                                                  seat.seatClass === "first"
                                                    ? "var(--mantine-color-dark-7)"
                                                    : undefined,
                                              }}
                                            >
                                              <IconArmchair size={18} />
                                            </Flex>
                                          </UnstyledButton>
                                        </Tooltip>
                                      ))}
                                  </Group>
                                  <Box w={30} /> {/* Aisle */}
                                  <Group gap="xs">
                                    {row.seats
                                      .slice(aisleIndex)
                                      .map((seat, seatIndex) => (
                                        <Tooltip
                                          key={seatIndex}
                                          label={`${row.rowNumber}${seat.position} - ${seat.seatType} (${seat.seatClass}${seat.premium > 0 ? `, +$${seat.premium}` : ""}${seat.blocked ? ", blocked" : ""})`}
                                        >
                                          <UnstyledButton
                                            onClick={() =>
                                              handleSeatClick(
                                                wagonIndex,
                                                rowIndex,
                                                aisleIndex + seatIndex,
                                              )
                                            }
                                          >
                                            <Flex
                                              w={36}
                                              h={36}
                                              justify="center"
                                              align="center"
                                              bg={getSeatColor(seat)}
                                              style={{
                                                borderRadius: 6,
                                                border: isFirstClass
                                                  ? "2px solid var(--mantine-color-yellow-5)"
                                                  : "1px solid var(--alepha-border)",
                                                opacity: seat.blocked ? 0.5 : 1,
                                                color:
                                                  seat.seatClass === "first"
                                                    ? "var(--mantine-color-dark-7)"
                                                    : undefined,
                                              }}
                                            >
                                              <IconArmchair size={18} />
                                            </Flex>
                                          </UnstyledButton>
                                        </Tooltip>
                                      ))}
                                  </Group>
                                  <Group gap="xs" ml="md">
                                    <Tooltip label="Toggle class">
                                      <ActionIcon
                                        variant="subtle"
                                        size="sm"
                                        onClick={() =>
                                          toggleRowClass(wagonIndex, rowIndex)
                                        }
                                      >
                                        <Badge
                                          size="xs"
                                          variant="light"
                                          color={
                                            isFirstClass ? "yellow" : "gray"
                                          }
                                        >
                                          {isFirstClass ? "1st" : "2nd"}
                                        </Badge>
                                      </ActionIcon>
                                    </Tooltip>
                                    <Tooltip label="Remove row">
                                      <ActionIcon
                                        variant="subtle"
                                        color="red"
                                        size="sm"
                                        onClick={() =>
                                          removeRow(wagonIndex, rowIndex)
                                        }
                                      >
                                        <IconTrash size={14} />
                                      </ActionIcon>
                                    </Tooltip>
                                  </Group>
                                </Flex>
                              );
                            })
                          )}

                          <Badge variant="light" color="dark" mt="sm">
                            Rear of Wagon {wagon.wagonNumber}
                          </Badge>
                        </Flex>

                        {/* Wagon Amenities */}
                        {(wagon.hasWifi ||
                          wagon.hasPowerOutlets ||
                          wagon.hasToilet ||
                          wagon.hasBikeStorage ||
                          wagon.hasLuggageRack) && (
                          <>
                            <Divider />
                            <Group gap="xs">
                              {wagon.hasWifi && (
                                <Badge size="xs" variant="light">
                                  WiFi
                                </Badge>
                              )}
                              {wagon.hasPowerOutlets && (
                                <Badge size="xs" variant="light">
                                  Power
                                </Badge>
                              )}
                              {wagon.hasToilet && (
                                <Badge size="xs" variant="light">
                                  Toilet
                                </Badge>
                              )}
                              {wagon.hasBikeStorage && (
                                <Badge size="xs" variant="light">
                                  Bikes
                                </Badge>
                              )}
                              {wagon.hasLuggageRack && (
                                <Badge size="xs" variant="light">
                                  Luggage
                                </Badge>
                              )}
                            </Group>
                          </>
                        )}
                      </Stack>
                    </Tabs.Panel>
                  ))}
                </Tabs>
              )}

              <Divider />

              {/* Totals */}
              <Group justify="center" gap="xl">
                <Stack gap={0} align="center">
                  <Text size="xl" fw={700}>
                    {totals.wagons}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Wagons
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xl" fw={700}>
                    {totals.total}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Total Seats
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xl" fw={700} c="yellow">
                    {totals.first}
                  </Text>
                  <Text size="xs" c="dimmed">
                    1st Class
                  </Text>
                </Stack>
                <Stack gap={0} align="center">
                  <Text size="xl" fw={700}>
                    {totals.second}
                  </Text>
                  <Text size="xs" c="dimmed">
                    2nd Class
                  </Text>
                </Stack>
              </Group>
            </Stack>
          </Card>
        </Stack>

        {/* Right: Metadata Form */}
        <Stack gap="md">
          <Card withBorder radius="md" p="lg" bg="var(--alepha-elevated)">
            <form {...form.props}>
              <Stack gap="md">
                <Text fw={600}>Layout Details</Text>

                <Control
                  title="Name"
                  input={form.input.name}
                  text={{ placeholder: "e.g., Eurostar Standard" }}
                />

                <Control
                  title="Description"
                  input={form.input.description}
                  text={{ placeholder: "Optional description" }}
                />

                <Control
                  title="Train Type"
                  input={form.input.trainType}
                  text={{ placeholder: "e.g., Eurostar, TGV, ICE" }}
                />

                <Divider />

                <Group justify="space-between">
                  <Text size="sm">Default for train type</Text>
                  <Switch
                    checked={formValues.isDefault}
                    onChange={(e) => {
                      setFormValues({
                        ...formValues,
                        isDefault: e.currentTarget.checked,
                      });
                      form.input.isDefault.set(e.currentTarget.checked);
                    }}
                  />
                </Group>

                {!isNew && (
                  <Group justify="space-between">
                    <Text size="sm">Active</Text>
                    <Switch
                      checked={formValues.active}
                      onChange={(e) => {
                        setFormValues({
                          ...formValues,
                          active: e.currentTarget.checked,
                        });
                        form.input.active.set(e.currentTarget.checked);
                      }}
                    />
                  </Group>
                )}
              </Stack>
            </form>
          </Card>

          <Card withBorder radius="md" p="lg" bg="var(--alepha-elevated)">
            <Stack gap="md">
              <Text fw={600}>Quick Tips</Text>
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  • Use "Generate Train" for quick multi-wagon setup
                </Text>
                <Text size="sm" c="dimmed">
                  • Click any seat to edit its properties
                </Text>
                <Text size="sm" c="dimmed">
                  • Use "Generate" to create rows for a wagon
                </Text>
                <Text size="sm" c="dimmed">
                  • Click the class badge to toggle entire row
                </Text>
                <Text size="sm" c="dimmed">
                  • Block seats for crew areas or storage
                </Text>
              </Stack>
            </Stack>
          </Card>
        </Stack>
      </SimpleGrid>

      {/* Generate Wagon Rows Modal */}
      <Modal
        opened={generateOpened}
        onClose={closeGenerate}
        title={`Generate Rows for Wagon ${activeWagon?.wagonNumber ?? 1}`}
      >
        <Stack gap="md">
          <NumberInput
            label="Total Rows"
            min={1}
            max={30}
            value={generateValues.totalRows}
            onChange={(v) =>
              setGenerateValues({ ...generateValues, totalRows: Number(v) })
            }
          />
          <NumberInput
            label="Seats Per Row"
            min={2}
            max={10}
            value={generateValues.seatsPerRow}
            onChange={(v) =>
              setGenerateValues({ ...generateValues, seatsPerRow: Number(v) })
            }
          />
          <NumberInput
            label="First Class Rows"
            min={0}
            max={generateValues.totalRows}
            value={generateValues.firstClassRows}
            onChange={(v) =>
              setGenerateValues({
                ...generateValues,
                firstClassRows: Number(v),
              })
            }
          />
          <Select
            label="Aisle After Position"
            data={["A", "B", "C", "D", "E"].slice(
              0,
              generateValues.seatsPerRow - 1,
            )}
            value={generateValues.aisleAfterPosition}
            onChange={(v) =>
              setGenerateValues({
                ...generateValues,
                aisleAfterPosition: v ?? "B",
              })
            }
          />
          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeGenerate}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="pink"
              onClick={generateWagonAction.run}
              loading={generateWagonAction.loading}
            >
              Generate
            </ActionButton>
          </Group>
        </Stack>
      </Modal>

      {/* Generate Train Modal */}
      <Modal
        opened={generateTrainOpened}
        onClose={closeGenerateTrain}
        title="Generate Train Configuration"
        size="lg"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Configure wagon types and quantities for the train.
          </Text>

          {trainConfig.map((config, index) => (
            <Card key={index} withBorder p="sm">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text size="sm" fw={500}>
                    Wagon Type {index + 1}
                  </Text>
                  {trainConfig.length > 1 && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() =>
                        setTrainConfig(
                          trainConfig.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                </Group>
                <SimpleGrid cols={2}>
                  <Select
                    label="Type"
                    size="xs"
                    data={Object.entries(wagonTypeLabels).map(
                      ([value, label]) => ({ value, label }),
                    )}
                    value={config.wagonType}
                    onChange={(v) => {
                      const newConfig = [...trainConfig];
                      newConfig[index] = {
                        ...config,
                        wagonType: v as WagonType,
                      };
                      setTrainConfig(newConfig);
                    }}
                  />
                  <NumberInput
                    label="Count"
                    size="xs"
                    min={1}
                    max={10}
                    value={config.count}
                    onChange={(v) => {
                      const newConfig = [...trainConfig];
                      newConfig[index] = { ...config, count: Number(v) };
                      setTrainConfig(newConfig);
                    }}
                  />
                  <NumberInput
                    label="Rows per Wagon"
                    size="xs"
                    min={1}
                    max={30}
                    value={config.rowsPerWagon}
                    onChange={(v) => {
                      const newConfig = [...trainConfig];
                      newConfig[index] = { ...config, rowsPerWagon: Number(v) };
                      setTrainConfig(newConfig);
                    }}
                  />
                  <NumberInput
                    label="Seats per Row"
                    size="xs"
                    min={2}
                    max={10}
                    value={config.seatsPerRow}
                    onChange={(v) => {
                      const newConfig = [...trainConfig];
                      newConfig[index] = { ...config, seatsPerRow: Number(v) };
                      setTrainConfig(newConfig);
                    }}
                  />
                </SimpleGrid>
              </Stack>
            </Card>
          ))}

          <ActionButton
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() =>
              setTrainConfig([
                ...trainConfig,
                {
                  wagonType: "second_class",
                  count: 1,
                  rowsPerWagon: 12,
                  seatsPerRow: 4,
                  aisleAfterPosition: "B",
                },
              ])
            }
          >
            Add Wagon Type
          </ActionButton>

          <Divider />

          <Group gap="lg">
            <Text size="sm" c="dimmed">
              Total Wagons: {trainConfig.reduce((sum, c) => sum + c.count, 0)}
            </Text>
            <Text size="sm" c="dimmed">
              Estimated Seats:{" "}
              {trainConfig.reduce(
                (sum, c) => sum + c.count * c.rowsPerWagon * c.seatsPerRow,
                0,
              )}
            </Text>
          </Group>

          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeGenerateTrain}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="pink"
              onClick={generateTrainAction.run}
              loading={generateTrainAction.loading}
            >
              Generate Train
            </ActionButton>
          </Group>
        </Stack>
      </Modal>

      {/* Edit Wagon Modal */}
      <Modal
        opened={editWagonOpened}
        onClose={closeEditWagon}
        title={`Wagon ${activeWagon?.wagonNumber ?? 1} Settings`}
      >
        {activeWagon && (
          <Stack gap="md">
            <Select
              label="Wagon Type"
              data={Object.entries(wagonTypeLabels).map(([value, label]) => ({
                value,
                label,
              }))}
              value={activeWagon.wagonType}
              onChange={(v) =>
                updateWagon(activeWagonIndex, { wagonType: v as WagonType })
              }
            />

            <NumberInput
              label="Seats Per Row"
              min={2}
              max={10}
              value={activeWagon.seatsPerRow}
              onChange={(v) =>
                updateWagon(activeWagonIndex, { seatsPerRow: Number(v) })
              }
            />

            <Select
              label="Aisle After Position"
              data={["A", "B", "C", "D", "E"].slice(
                0,
                activeWagon.seatsPerRow - 1,
              )}
              value={activeWagon.aisleAfterPosition ?? "B"}
              onChange={(v) =>
                updateWagon(activeWagonIndex, {
                  aisleAfterPosition: v ?? "B",
                })
              }
            />

            <Divider />
            <Text size="sm" fw={500}>
              Amenities
            </Text>

            <Group justify="space-between">
              <Text size="sm">WiFi</Text>
              <Switch
                checked={activeWagon.hasWifi ?? false}
                onChange={(e) =>
                  updateWagon(activeWagonIndex, {
                    hasWifi: e.currentTarget.checked,
                  })
                }
              />
            </Group>

            <Group justify="space-between">
              <Text size="sm">Power Outlets</Text>
              <Switch
                checked={activeWagon.hasPowerOutlets ?? false}
                onChange={(e) =>
                  updateWagon(activeWagonIndex, {
                    hasPowerOutlets: e.currentTarget.checked,
                  })
                }
              />
            </Group>

            <Group justify="space-between">
              <Text size="sm">Toilet</Text>
              <Switch
                checked={activeWagon.hasToilet ?? false}
                onChange={(e) =>
                  updateWagon(activeWagonIndex, {
                    hasToilet: e.currentTarget.checked,
                  })
                }
              />
            </Group>

            <Group justify="space-between">
              <Text size="sm">Bike Storage</Text>
              <Switch
                checked={activeWagon.hasBikeStorage ?? false}
                onChange={(e) =>
                  updateWagon(activeWagonIndex, {
                    hasBikeStorage: e.currentTarget.checked,
                  })
                }
              />
            </Group>

            <Group justify="space-between">
              <Text size="sm">Luggage Rack</Text>
              <Switch
                checked={activeWagon.hasLuggageRack ?? false}
                onChange={(e) =>
                  updateWagon(activeWagonIndex, {
                    hasLuggageRack: e.currentTarget.checked,
                  })
                }
              />
            </Group>

            <Group justify="flex-end" mt="md">
              <ActionButton
                variant="filled"
                color="pink"
                onClick={closeEditWagon}
              >
                Done
              </ActionButton>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Edit Seat Modal */}
      <Modal opened={editSeatOpened} onClose={closeEditSeat} title="Edit Seat">
        {selectedSeatData && selectedSeat && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Wagon {wagons[selectedSeat.wagonIndex]?.wagonNumber}, Seat{" "}
              {
                wagons[selectedSeat.wagonIndex]?.rows[selectedSeat.rowIndex]
                  ?.rowNumber
              }
              {selectedSeatData.position}
            </Text>

            <Select
              label="Seat Class"
              data={[
                { value: "first", label: "First Class" },
                { value: "second", label: "Second Class" },
              ]}
              value={selectedSeatData.seatClass}
              onChange={(v) =>
                updateSeat(
                  selectedSeat.wagonIndex,
                  selectedSeat.rowIndex,
                  selectedSeat.seatIndex,
                  {
                    seatClass: v as "first" | "second",
                    premium: v === "first" ? 35 : 0,
                  },
                )
              }
            />

            <Select
              label="Seat Type"
              data={[
                { value: "window", label: "Window" },
                { value: "aisle", label: "Aisle" },
                { value: "middle", label: "Middle" },
              ]}
              value={selectedSeatData.seatType}
              onChange={(v) =>
                updateSeat(
                  selectedSeat.wagonIndex,
                  selectedSeat.rowIndex,
                  selectedSeat.seatIndex,
                  { seatType: v as "window" | "aisle" | "middle" },
                )
              }
            />

            <NumberInput
              label="Premium ($)"
              min={0}
              max={500}
              value={selectedSeatData.premium}
              onChange={(v) =>
                updateSeat(
                  selectedSeat.wagonIndex,
                  selectedSeat.rowIndex,
                  selectedSeat.seatIndex,
                  { premium: Number(v) },
                )
              }
            />

            <Group justify="space-between">
              <Text size="sm">Blocked</Text>
              <Switch
                checked={selectedSeatData.blocked ?? false}
                onChange={(e) =>
                  updateSeat(
                    selectedSeat.wagonIndex,
                    selectedSeat.rowIndex,
                    selectedSeat.seatIndex,
                    { blocked: e.currentTarget.checked },
                  )
                }
              />
            </Group>

            <Group justify="flex-end" mt="md">
              <ActionButton
                variant="filled"
                color="pink"
                onClick={closeEditSeat}
              >
                Done
              </ActionButton>
            </Group>
          </Stack>
        )}
      </Modal>
    </Flex>
  );
};

export default AdminSeatLayoutEditor;
