import { type Page, t } from "@alepha/core";
import { type LogEntry, logEntrySchema } from "@alepha/logger";
import { useInject } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { HttpClient } from "@alepha/server";
import { DataTable, Flex, Text } from "@alepha/ui";

const DevLogs = () => {
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

  return (
    <Flex flex={1}>
      <DataTable<LogEntry>
        submitOnInit
        submitEvery={[10, "seconds"]}
        defaultSize={25}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: 0,
        }}
        filters={t.object({
          search: t.optional(t.string()),
        })}
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
        items={async (filters) => {
          const response = await http.fetch(
            `/devtools/api/logs?${new URLSearchParams(filters as any).toString()}`,
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
            label: "Tme",
            value: (item) => (
              <Text c={"dimmed"} size={"xs"}>
                {l(item.timestamp, {
                  date: "HH:mm:ss.SSS",
                })}
              </Text>
            ),
          },
          level: {
            label: "Lvl",
            value: (item) => renderLevel(item.level),
          },
          context: {
            label: "Ctx",
            value: (item) =>
              item.context && (
                <Text ff={"monospace"} size={"xs"} c="dimmed">
                  {item.context.slice(0, 8)}
                </Text>
              ),
          },
          service: {
            label: "Srv",
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
            label: "Msg",
            value: (item) => item.message.slice(0, 64),
          },
          data: {
            label: "Dat",
            value: (item) =>
              item.data ? JSON.stringify(item.data, null, 2).slice(0, 32) : "",
          },
        }}
      />
    </Flex>
  );
};

export default DevLogs;
