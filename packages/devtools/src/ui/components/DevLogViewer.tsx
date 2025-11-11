import { type Page, t } from "@alepha/core";
import { type LogEntry, logEntrySchema } from "@alepha/logger";
import { useInject } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { HttpClient } from "@alepha/server";
import { ActionButton, DataTable, DialogService, Flex, Text } from "@alepha/ui";
import { logs } from "../../entities/logs.ts";

const DevLogViewer = () => {
  const http = useInject(HttpClient);
  const { l } = useI18n();

  const renderLevel = (level: string) => {
    switch (level.toLowerCase()) {
      case "error":
        return (
          <Text ff={"monospace"} c="red">
            {level.slice(0, 5)}
          </Text>
        );
      case "warn":
        return (
          <Text ff={"monospace"} c="orange">
            {level.slice(0, 5)}
          </Text>
        );
      case "info":
        return (
          <Text ff={"monospace"} c="green">
            {level.slice(0, 5)}
          </Text>
        );
      case "debug":
        return (
          <Text ff={"monospace"} c="grape">
            {level.slice(0, 5)}
          </Text>
        );
      case "trace":
        return (
          <Text ff={"monospace"} c="dimmed">
            {level.slice(0, 5)}
          </Text>
        );
      default:
        return <Text>{level}</Text>;
    }
  };

  const filters = t.object({
    search: t.optional(
      t.string({
        $control: {
          query: t.omit(logs.schema, ["id"]),
        },
      }),
    ),
  });

  return (
    <Flex flex={1}>
      <DataTable<LogEntry, typeof filters>
        submitOnInit
        infinityScroll
        submitEvery={[10, "seconds"]}
        defaultSize={20}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 2,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: 0,
        }}
        onFilterChange={(key, value, form) => {
          if (key === "search") {
            return form.submit();
          }
        }}
        filters={filters}
        tableTrProps={(item) => {
          if (item.level.toLowerCase() === "error") {
            return {
              bg: "rgba(255,0,0,0.1)",
            };
          }
          if (item.level.toLowerCase() === "warn") {
            return {
              bg: "rgba(255,153,0,0.1)",
            };
          }
          return {};
        }}
        items={async (filters, ctx) => {
          if (filters.search) {
            filters.search = filters.search.replace(
              "now()",
              new Date().toISOString(),
            );
          }

          if (filters.page && filters.page > 0) {
            const next = `timestamp < ${ctx.items[0].timestamp.toISOString()}`;
            if (filters.search) {
              filters.search += `& ${next}`;
            } else {
              filters.search = next;
            }
          }

          const queryParams = new URLSearchParams(
            filters as Record<string, any>,
          ).toString();

          const response = await http.fetch(
            `/devtools/api/logs?${queryParams}`,
            {
              schema: {
                response: t.page(logEntrySchema),
              },
            },
          );

          return response.data as Page<LogEntry>;
        }}
        columns={{
          timestamp: {
            label: "timestamp",
            value: (item, { form }) => (
              <ActionButton
                h={20}
                c={"dimmed"}
                size={"xs"}
                tooltip={l(item.timestamp, {
                  date: "DD MMM YYYY HH:mm:ss.SSS",
                })}
                onClick={() => {
                  const before = item.timestamp.subtract(1, "minute");
                  const after = item.timestamp.add(1, "minute");
                  form.input.search.set(
                    `timestamp >= ${before.toISOString()} & timestamp <= ${after.toISOString()}`,
                  );
                }}
              >
                {l(item.timestamp, {
                  date: "HH:mm:ss.SSS",
                })}
              </ActionButton>
            ),
          },
          level: {
            label: "level",
            value: (item) => renderLevel(item.level),
          },
          app: {
            label: "app",
            value: (item) => item.app,
          },
          context: {
            fit: true,
            label: "context",
            value: (item, { form }) =>
              item.context && (
                <ActionButton
                  h={20}
                  size={"xs"}
                  onClick={() => {
                    form.input.search.set(`context = ${item.context}`);
                  }}
                >
                  <Text ff={"monospace"} size={"xs"} c="dimmed">
                    {item.context.replaceAll("-", "").slice(0, 10)}
                  </Text>
                </ActionButton>
              ),
          },
          service: {
            fit: true,
            label: "service",
            value: (item) => (
              <Flex align={"center"} justify={"end"}>
                {item.module && (
                  <Text c="dimmed" size={"xs"}>
                    {item.module}.
                  </Text>
                )}
                <Text size={"sm"}>{item.service}</Text>
              </Flex>
            ),
          },
          message: {
            label: "message",
            value: (item) => {
              if (item.data?.ms && item.data.status) {
                return `${item.message} - ${item.data.status} [${item.data.ms}ms]`;
              }
              if (item.data?.path && item.data.method) {
                return `${item.message} - ${item.data.method} ${item.data.path}`;
              }
              return item.message;
            },
          },
          data: {
            label: "more",
            value: (item, { alepha }) => {
              if (!item.data) {
                return;
              }

              if (Object.keys(item.data).length === 0) {
                return;
              }

              return (
                <ActionButton
                  opacity={0.5}
                  h={20}
                  px={4}
                  size={"xs"}
                  fw={"bold"}
                  onClick={() => alepha.inject(DialogService).json(item.data)}
                >
                  {"{ ... }"}
                </ActionButton>
              );
            },
          },
        }}
      />
    </Flex>
  );
};

export default DevLogViewer;
