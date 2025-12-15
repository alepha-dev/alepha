import { useClient, useRouter } from "@alepha/react";
import { Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconChartBar,
  IconClock,
  IconCreditCard,
  IconCurrencyEuro,
  IconFileDownload,
  IconHeartbeat,
  IconReceiptRefund,
  IconRoute,
  IconShoppingCart,
  IconTicket,
  IconUserCircle,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ReportController } from "../../../api/reporting/controllers/ReportController.ts";
import type {
  ReportCategory,
  ReportDefinition,
} from "../../../api/reporting/types/reports.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const categoryLabels: Record<ReportCategory, string> = {
  financial: "Financial",
  operations: "Operations",
  customers: "Customers",
  inventory: "Inventory",
  system: "System",
};

const categoryColors: Record<ReportCategory, string> = {
  financial: "green",
  operations: "blue",
  customers: "violet",
  inventory: "orange",
  system: "gray",
};

const categoryDescriptions: Record<ReportCategory, string> = {
  financial: "Revenue, payments, refunds, and financial analytics",
  operations: "Booking trends, route performance, and agent metrics",
  customers: "Customer segments, loyalty, and purchasing patterns",
  inventory: "Seat utilization, fare class distribution, and capacity",
  system: "Device health, API performance, and system metrics",
};

const iconMap: Record<string, typeof IconCurrencyEuro> = {
  IconCurrencyEuro,
  IconCreditCard,
  IconReceiptRefund,
  IconTicket,
  IconRoute,
  IconUsers,
  IconUserCircle,
  IconShoppingCart,
  IconChartBar,
  IconHeartbeat,
};

const getIcon = (iconName: string) => {
  return iconMap[iconName] || IconChartBar;
};

const formatLabels: Record<string, string> = {
  json: "JSON",
  csv: "CSV",
  pdf: "PDF",
};

const AdminReports = () => {
  const client = useClient<ReportController>();
  const router = useRouter<AdmRouter>();

  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadReports = async () => {
      try {
        const data = await client.getReports({});
        setReports(data);
      } finally {
        setLoading(false);
      }
    };

    loadReports();
  }, []);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  // Group reports by category
  const reportsByCategory = reports.reduce(
    (acc, report) => {
      if (!acc[report.category]) {
        acc[report.category] = [];
      }
      acc[report.category].push(report);
      return acc;
    },
    {} as Record<ReportCategory, ReportDefinition[]>,
  );

  const categories: ReportCategory[] = [
    "financial",
    "operations",
    "customers",
    "inventory",
    "system",
  ];

  return (
    <Flex flex={1} direction="column" gap="xl" p="md">
      {/* Header */}
      <Stack gap="xs">
        <Text size="xl" fw={700}>
          Reports
        </Text>
        <Text size="sm" c="dimmed">
          Generate and export business intelligence reports across different
          categories.
        </Text>
      </Stack>

      {/* Category Overview */}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="md">
        {categories.map((category) => {
          const count = reportsByCategory[category]?.length || 0;
          return (
            <Card key={category} withBorder p="sm">
              <Group gap="xs">
                <ThemeIcon
                  size="md"
                  variant="light"
                  color={categoryColors[category]}
                >
                  <IconChartBar size={16} />
                </ThemeIcon>
                <Stack gap={0}>
                  <Text size="sm" fw={600}>
                    {categoryLabels[category]}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {count} report{count !== 1 ? "s" : ""}
                  </Text>
                </Stack>
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>

      {/* Reports by Category */}
      {categories.map((category) => {
        const categoryReports = reportsByCategory[category];
        if (!categoryReports || categoryReports.length === 0) return null;

        return (
          <Stack key={category} gap="md">
            <Group gap="sm">
              <ThemeIcon
                size="lg"
                variant="light"
                color={categoryColors[category]}
              >
                <IconChartBar size={20} />
              </ThemeIcon>
              <Stack gap={0}>
                <Text size="lg" fw={600}>
                  {categoryLabels[category]} Reports
                </Text>
                <Text size="xs" c="dimmed">
                  {categoryDescriptions[category]}
                </Text>
              </Stack>
            </Group>

            <Grid>
              {categoryReports.map((report) => {
                const Icon = getIcon(report.icon);
                return (
                  <Grid.Col key={report.id} span={{ base: 12, sm: 6, md: 4 }}>
                    <Card
                      withBorder
                      h="100%"
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        router.go("adminReportViewer", {
                          params: { reportId: report.id },
                        })
                      }
                    >
                      <Stack gap="sm">
                        <Group justify="space-between" align="flex-start">
                          <ThemeIcon
                            size="lg"
                            variant="light"
                            color={categoryColors[category]}
                          >
                            <Icon size={20} />
                          </ThemeIcon>
                          <Group gap={4}>
                            {report.scheduleEnabled && (
                              <Tooltip label="Can be scheduled">
                                <ThemeIcon
                                  size="sm"
                                  variant="subtle"
                                  c="dimmed"
                                >
                                  <IconClock size={14} />
                                </ThemeIcon>
                              </Tooltip>
                            )}
                            <Tooltip label="Export formats">
                              <ThemeIcon size="sm" variant="subtle" c="dimmed">
                                <IconFileDownload size={14} />
                              </ThemeIcon>
                            </Tooltip>
                          </Group>
                        </Group>

                        <Stack gap={4}>
                          <Text size="sm" fw={600}>
                            {report.name}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {report.description}
                          </Text>
                        </Stack>

                        <Group gap={4} mt="auto">
                          {report.availableFormats.map((format) => (
                            <Badge
                              key={format}
                              size="xs"
                              variant="light"
                              color="gray"
                            >
                              {formatLabels[format]}
                            </Badge>
                          ))}
                          <Badge size="xs" variant="light" color="blue">
                            {report.parameters.length} param
                            {report.parameters.length !== 1 ? "s" : ""}
                          </Badge>
                        </Group>
                      </Stack>
                    </Card>
                  </Grid.Col>
                );
              })}
            </Grid>
          </Stack>
        );
      })}
    </Flex>
  );
};

export default AdminReports;
