import { useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  MultiSelect,
  Progress,
  Select,
  Stack,
  Table,
  ThemeIcon,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
  IconChartBar,
  IconDownload,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ReportController } from "../../../api/reporting/controllers/ReportController.ts";
import type {
  ReportDefinition,
  ReportFormat,
} from "../../../api/reporting/types/reports.ts";

type ReportData = Record<string, unknown>;

interface ParameterValues {
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
  groupBy?: string;
  [key: string]: unknown;
}

const AdminReportViewer = () => {
  const client = useClient<ReportController>();
  const { l } = useI18n();
  const routerState = useRouterState();
  const reportId = routerState.params.reportId as string;

  const [report, setReport] = useState<ReportDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parameter state
  const [paramValues, setParamValues] = useState<ParameterValues>({
    fromDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    toDate: new Date(),
    groupBy: "day",
  });

  useEffect(() => {
    const loadReport = async () => {
      try {
        const reportDef = await client.getReport({
          params: { id: reportId },
        });
        setReport(reportDef);
      } catch (err) {
        setError("Failed to load report definition");
      } finally {
        setLoading(false);
      }
    };

    loadReport();
  }, [reportId]);

  const generateReport = async () => {
    if (!report) return;

    setGenerating(true);
    setError(null);

    try {
      const formatDate = (d: Date | string | null | undefined): string => {
        if (!d) return "";
        if (typeof d === "string") return d.split("T")[0];
        return d.toISOString().split("T")[0];
      };
      const query = {
        fromDate: formatDate(paramValues.fromDate),
        toDate: formatDate(paramValues.toDate),
        groupBy: paramValues.groupBy as "day" | "week" | "month",
      };

      let result: ReportData;

      switch (report.id) {
        case "revenue-summary":
          result = await client.getRevenueSummary({ query });
          break;
        case "payment-reconciliation":
          result = await client.getPaymentReconciliation({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "refunds-cancellations":
          result = await client.getRefundsCancellations({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "booking-analytics":
          result = await client.getBookingAnalytics({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "route-performance":
          result = await client.getRoutePerformance({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "agent-performance":
          result = await client.getAgentPerformance({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "customer-analytics":
          result = await client.getCustomerAnalytics({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "product-sales":
          result = await client.getProductSales({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "inventory-utilization":
          result = await client.getInventoryUtilization({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        case "system-health":
          result = await client.getSystemHealth({
            query: { fromDate: query.fromDate, toDate: query.toDate },
          });
          break;
        default:
          throw new Error(`Unknown report: ${report.id}`);
      }

      setData(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate report",
      );
    } finally {
      setGenerating(false);
    }
  };

  const exportReport = (format: ReportFormat) => {
    if (!data || !report) return;

    if (format === "json") {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.id}-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "csv") {
      // Convert data to CSV - simplified for summary data
      const summary = (data as Record<string, unknown>).summary as Record<
        string,
        unknown
      >;
      if (summary) {
        const headers = Object.keys(summary).join(",");
        const values = Object.values(summary).join(",");
        const csv = `${headers}\n${values}`;
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${report.id}-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  };

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!report) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Report not found</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      {/* Header */}
      <Card withBorder>
        <Group justify="space-between" align="flex-start">
          <Group gap="md">
            <ThemeIcon size="xl" variant="light" color="blue">
              <IconChartBar size={28} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text size="lg" fw={700}>
                {report.name}
              </Text>
              <Text size="sm" c="dimmed">
                {report.description}
              </Text>
            </Stack>
          </Group>
          <Group gap="xs">
            {report.availableFormats.map((format) => (
              <ActionButton
                key={format}
                size="xs"
                variant="light"
                disabled={!data}
                leftSection={
                  format === "csv" ? (
                    <IconFileSpreadsheet size={14} />
                  ) : format === "pdf" ? (
                    <IconFileTypePdf size={14} />
                  ) : (
                    <IconDownload size={14} />
                  )
                }
                onClick={() => exportReport(format)}
              >
                {format.toUpperCase()}
              </ActionButton>
            ))}
          </Group>
        </Group>
      </Card>

      {/* Parameters */}
      <Card withBorder>
        <Stack gap="md">
          <Text size="sm" fw={600}>
            Report Parameters
          </Text>
          <Grid align="flex-end">
            {report.parameters.map((param) => {
              if (param.type === "dateRange") {
                return (
                  <Grid.Col key={param.name} span={{ base: 12, sm: 6, md: 4 }}>
                    <Stack gap="xs">
                      <Group gap="xs">
                        <DatePickerInput
                          label="From"
                          value={paramValues.fromDate}
                          onChange={(value) =>
                            setParamValues((prev) => ({
                              ...prev,
                              fromDate: value,
                            }))
                          }
                          clearable={false}
                          size="sm"
                          style={{ flex: 1 }}
                        />
                        <DatePickerInput
                          label="To"
                          value={paramValues.toDate}
                          onChange={(value) =>
                            setParamValues((prev) => ({
                              ...prev,
                              toDate: value,
                            }))
                          }
                          clearable={false}
                          size="sm"
                          style={{ flex: 1 }}
                        />
                      </Group>
                    </Stack>
                  </Grid.Col>
                );
              }

              if (param.type === "select" && param.options) {
                return (
                  <Grid.Col key={param.name} span={{ base: 12, sm: 6, md: 2 }}>
                    <Select
                      label={param.label}
                      data={param.options.map(
                        (opt: { value: string; label: string }) => ({
                          value: opt.value,
                          label: opt.label,
                        }),
                      )}
                      value={
                        (paramValues[param.name] as string) ||
                        (param.defaultValue as string)
                      }
                      onChange={(value) =>
                        setParamValues((prev) => ({
                          ...prev,
                          [param.name]: value,
                        }))
                      }
                      size="sm"
                    />
                  </Grid.Col>
                );
              }

              if (param.type === "multiSelect" && param.options) {
                return (
                  <Grid.Col key={param.name} span={{ base: 12, sm: 6, md: 3 }}>
                    <MultiSelect
                      label={param.label}
                      data={param.options.map(
                        (opt: { value: string; label: string }) => ({
                          value: opt.value,
                          label: opt.label,
                        }),
                      )}
                      value={(paramValues[param.name] as string[]) || []}
                      onChange={(value) =>
                        setParamValues((prev) => ({
                          ...prev,
                          [param.name]: value,
                        }))
                      }
                      size="sm"
                      clearable
                      placeholder="All"
                    />
                  </Grid.Col>
                );
              }

              return null;
            })}
            <Grid.Col span={{ base: 12, sm: 6, md: 2 }}>
              <ActionButton
                leftSection={
                  generating ? (
                    <Loader size={14} />
                  ) : data ? (
                    <IconRefresh size={16} />
                  ) : (
                    <IconPlayerPlay size={16} />
                  )
                }
                loading={generating}
                onClick={generateReport}
                fullWidth
              >
                {data ? "Refresh" : "Generate"}
              </ActionButton>
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      {/* Error */}
      {error && (
        <Card withBorder bg="red.0">
          <Text c="red" size="sm">
            {error}
          </Text>
        </Card>
      )}

      {/* Results */}
      {data && <ReportResults reportId={report.id} data={data} />}

      {/* Empty State */}
      {!data && !error && (
        <Card withBorder>
          <Flex
            direction="column"
            align="center"
            justify="center"
            gap="md"
            py="xl"
          >
            <ThemeIcon size={60} variant="light" color="gray">
              <IconChartBar size={32} />
            </ThemeIcon>
            <Stack gap={4} align="center">
              <Text fw={600}>Ready to Generate</Text>
              <Text size="sm" c="dimmed" ta="center">
                Configure the parameters above and click Generate to run this
                report.
              </Text>
            </Stack>
          </Flex>
        </Card>
      )}
    </Flex>
  );
};

// Report Results Component
interface ReportResultsProps {
  reportId: string;
  data: ReportData;
}

const ReportResults = ({ reportId, data }: ReportResultsProps) => {
  const summary = data.summary as Record<string, number> | undefined;

  return (
    <Stack gap="md">
      {/* Summary Cards */}
      {summary && (
        <Grid>
          {Object.entries(summary).map(([key, value]) => (
            <Grid.Col key={key} span={{ base: 6, sm: 4, md: 3, lg: 2 }}>
              <Card withBorder h="100%">
                <Stack gap={0}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                    {formatLabel(key)}
                  </Text>
                  <Text size="lg" fw={700} ff="monospace">
                    {formatValue(key, value)}
                  </Text>
                </Stack>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {/* Render arrays as tables or charts */}
      {Object.entries(data).map(([key, value]) => {
        if (key === "summary") return null;
        if (!Array.isArray(value) || value.length === 0) return null;

        return (
          <Card key={key} withBorder>
            <Stack gap="md">
              <Text fw={600}>{formatLabel(key)}</Text>
              <DataTable
                data={value as Record<string, unknown>[]}
                tableKey={key}
              />
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
};

// Data Table Component
interface DataTableProps {
  data: Record<string, unknown>[];
  tableKey: string;
}

const DataTable = ({ data, tableKey }: DataTableProps) => {
  if (data.length === 0) return null;

  const columns = Object.keys(data[0]);

  // For percentage/rate data, show progress bars
  const hasPercentage = columns.some(
    (col) =>
      col.includes("percentage") ||
      col.includes("rate") ||
      col.includes("utilization"),
  );

  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          {columns.map((col) => (
            <Table.Th
              key={col}
              style={{
                textAlign: isNumericColumn(col) ? "right" : "left",
              }}
            >
              {formatLabel(col)}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {data.slice(0, 15).map((row, index) => (
          <Table.Tr key={index}>
            {columns.map((col) => (
              <Table.Td
                key={col}
                style={{
                  textAlign: isNumericColumn(col) ? "right" : "left",
                }}
              >
                {renderCellValue(col, row[col])}
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};

// Utility functions
const formatLabel = (key: string): string => {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
};

const formatValue = (key: string, value: number): string => {
  if (
    key.includes("revenue") ||
    key.includes("amount") ||
    key.includes("price") ||
    key.includes("spend") ||
    key.includes("value")
  ) {
    return `EUR ${value.toFixed(2)}`;
  }
  if (
    key.includes("rate") ||
    key.includes("percentage") ||
    key.includes("growth") ||
    key.includes("utilization")
  ) {
    return `${value.toFixed(1)}%`;
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toFixed(2);
};

const isNumericColumn = (col: string): boolean => {
  return (
    col.includes("count") ||
    col.includes("amount") ||
    col.includes("revenue") ||
    col.includes("price") ||
    col.includes("total") ||
    col.includes("avg") ||
    col.includes("percentage") ||
    col.includes("rate") ||
    col.includes("bookings") ||
    col.includes("orders") ||
    col.includes("utilization") ||
    col.includes("score") ||
    col.includes("quota") ||
    col.includes("booked")
  );
};

const renderCellValue = (col: string, value: unknown): React.ReactNode => {
  if (value === null || value === undefined) return "-";

  if (typeof value === "number") {
    if (
      col.includes("percentage") ||
      col.includes("rate") ||
      col.includes("utilization")
    ) {
      return (
        <Group gap="xs" justify="flex-end">
          <Progress value={Math.min(value, 100)} size="sm" w={60} />
          <Text size="sm" ff="monospace" w={45}>
            {value.toFixed(1)}%
          </Text>
        </Group>
      );
    }
    if (
      col.includes("revenue") ||
      col.includes("amount") ||
      col.includes("price") ||
      col.includes("spend")
    ) {
      return (
        <Text size="sm" ff="monospace">
          EUR {value.toFixed(2)}
        </Text>
      );
    }
    if (col.includes("score") && value <= 5) {
      return (
        <Badge
          size="sm"
          variant="light"
          color={value >= 4 ? "green" : value >= 3 ? "yellow" : "red"}
        >
          {value.toFixed(1)}
        </Badge>
      );
    }
    return (
      <Text size="sm" ff="monospace">
        {Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)}
      </Text>
    );
  }

  if (typeof value === "string") {
    if (col === "status") {
      const statusColors: Record<string, string> = {
        online: "green",
        offline: "red",
        maintenance: "yellow",
        active: "green",
        inactive: "gray",
      };
      return (
        <Badge size="sm" variant="light" color={statusColors[value] || "gray"}>
          {value}
        </Badge>
      );
    }
    return <Text size="sm">{value}</Text>;
  }

  return String(value);
};

export default AdminReportViewer;
