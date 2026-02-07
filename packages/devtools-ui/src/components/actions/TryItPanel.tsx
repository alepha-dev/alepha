import {
  ActionIcon,
  Box,
  Button,
  Code,
  CopyButton,
  Group,
  JsonInput,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { IconCheck, IconCopy, IconPlayerPlay } from "@tabler/icons-react";
import type { DevActionMetadata } from "alepha/devtools";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useState } from "react";

interface TryItPanelProps {
  action: DevActionMetadata;
}

export const TryItPanel = ({ action }: TryItPanelProps) => {
  const http = useInject(HttpClient);
  const [body, setBody] = useState("{}");
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timing, setTiming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    const start = performance.now();

    try {
      let parsedBody: unknown;
      if (action.body && body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          setError("Invalid JSON body");
          setLoading(false);
          return;
        }
      }

      const res = await http.fetch(action.fullPath, {
        method: action.method.toUpperCase() as
          | "GET"
          | "POST"
          | "PUT"
          | "DELETE"
          | "PATCH",
        body: parsedBody ? JSON.stringify(parsedBody) : undefined,
        headers: parsedBody
          ? { "Content-Type": "application/json" }
          : undefined,
      });

      setTiming(Math.round(performance.now() - start));
      setResponse(JSON.stringify(res.data, null, 2));
    } catch (err) {
      setTiming(Math.round(performance.now() - start));
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [http, action, body]);

  return (
    <Stack gap="md">
      {action.body && (
        <JsonInput
          label="Request Body"
          placeholder='{"key": "value"}'
          value={body}
          onChange={setBody}
          minRows={4}
          maxRows={10}
          autosize
          formatOnBlur
          validationError="Invalid JSON"
        />
      )}

      <Group>
        <Button
          leftSection={
            loading ? <Loader size={14} /> : <IconPlayerPlay size={14} />
          }
          onClick={execute}
          disabled={loading}
          size="sm"
        >
          Execute
        </Button>
        {timing !== null && (
          <Text size="xs" c="dimmed">
            {timing}ms
          </Text>
        )}
      </Group>

      {error && (
        <Paper p="sm" bg="var(--mantine-color-red-light)">
          <Text size="sm" c="red">
            {error}
          </Text>
        </Paper>
      )}

      {response && (
        <Box>
          <Group justify="space-between" mb={4}>
            <Text size="xs" fw={500} c="dimmed">
              Response
            </Text>
            <CopyButton value={response}>
              {({ copied, copy }) => (
                <ActionIcon size="xs" variant="subtle" onClick={copy}>
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                </ActionIcon>
              )}
            </CopyButton>
          </Group>
          <ScrollArea h={200}>
            <Code block style={{ fontSize: 11 }}>
              {response}
            </Code>
          </ScrollArea>
        </Box>
      )}
    </Stack>
  );
};
