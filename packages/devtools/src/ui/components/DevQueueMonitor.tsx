/**
 * Queue Monitor
 *
 * Real-time view of background job queues.
 *
 * Features to implement:
 * - List all queues with their provider (redis, memory)
 * - For each queue show:
 *   - Pending count
 *   - Active count (currently processing)
 *   - Completed count (last hour/day)
 *   - Failed count with error preview
 * - Click queue to see recent jobs:
 *   - Job ID, status, created, started, completed, duration
 *   - Payload (JSON viewer)
 *   - Error message and stack trace for failed jobs
 * - Actions:
 *   - Retry single failed job
 *   - Retry all failed jobs
 *   - Purge completed jobs
 *   - Pause/resume queue
 * - Auto-refresh toggle (poll every 5s)
 * - Filter by status (pending, active, completed, failed)
 *
 * Data source: Need new endpoints in DevToolsProvider
 *   - GET /devtools/api/queues -> queue stats
 *   - GET /devtools/api/queues/:name/jobs -> job list
 *   - POST /devtools/api/queues/:name/jobs/:id/retry
 */

import { Flex, Text, ThemeIcon } from "@mantine/core";
import { IconStack2 } from "@tabler/icons-react";

export const DevQueueMonitor = () => {
  return (
    <Flex direction="column" gap="xl" w="100%" p={"xl"}>
      <Flex align="center" gap="sm">
        <ThemeIcon size={32} variant="light" color="orange">
          <IconStack2 size={20} />
        </ThemeIcon>
        <Text size="xl" fw={600}>
          Queue Monitor
        </Text>
      </Flex>

      <Text c="dimmed">Background job queues - coming soon</Text>
    </Flex>
  );
};

export default DevQueueMonitor;
