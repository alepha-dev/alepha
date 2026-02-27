# Admin Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin page showing all sent notifications with their rendered content.

**Architecture:** Notifications are sent via the job system (`NotificationJobs.sendNotification`). We modify the sender to return rendered content, store it as the job execution's `result` field, then surface it through a new controller and UI page. The controller queries job executions filtered to the notification job, extracting notification-specific fields from `payload` and rendered content from `result`.

**Tech Stack:** Alepha primitives ($action, $repository), TypeBox schemas, React + Mantine DataTable/Drawer

---

### Task 1: Modify NotificationSenderService to return rendered content

**Files:**
- Modify: `packages/alepha/src/api/notifications/services/NotificationSenderService.ts`

**Step 1: Update `send()` to return rendered content**

The `send()` method currently returns `void`. Change it to return the rendered content so the job handler can store it.

```typescript
public async send(payload: NotificationPayload) {
  this.log.debug("Processing notification", {
    type: payload.type,
    template: payload.template,
    contact: payload.contact,
  });

  if (payload.type === "email") {
    const rendered = this.renderEmail(payload);
    await this.emailProvider.send(rendered);
    this.log.info("Email notification sent", {
      template: payload.template,
      contact: payload.contact,
    });
    return { type: "email" as const, to: rendered.to, subject: rendered.subject, body: rendered.body };
  }

  if (payload.type === "sms") {
    const rendered = this.renderSms(payload);
    await this.smsProvider.send(rendered);
    this.log.info("SMS notification sent", {
      template: payload.template,
      contact: payload.contact,
    });
    return { type: "sms" as const, to: rendered.to, message: rendered.message };
  }
}
```

**Step 2: Run typecheck**

Run: `yarn w alepha typecheck`

---

### Task 2: Modify NotificationJobs handler to store rendered content

**Files:**
- Modify: `packages/alepha/src/api/notifications/jobs/NotificationJobs.ts`

**Step 1: Add execution repository and store result**

The handler needs to store the rendered content returned by `send()` into the job execution's `result` field.

```typescript
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { jobExecutionEntity } from "alepha/api/jobs";
import { notificationPayloadSchema } from "../schemas/notificationPayloadSchema.ts";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";

export class NotificationJobs {
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );
  protected readonly executions = $repository(jobExecutionEntity);

  public readonly sendNotification = $job({
    schema: notificationPayloadSchema,
    retry: {
      retries: 3,
      backoff: {
        initial: [5, "seconds"],
        factor: 4,
        max: [10, "minutes"],
        jitter: true,
      },
    },
    timeout: [30, "seconds"],
    concurrency: 5,
    handler: async ({ items }) => {
      for (const item of items) {
        const rendered = await this.notificationSenderService.send(
          item.payload,
        );
        if (rendered) {
          await this.executions.updateById(item.id, {
            result: rendered as Record<string, unknown>,
          });
        }
      }
    },
  });
}
```

**Step 2: Run typecheck**

Run: `yarn w alepha typecheck`

---

### Task 3: Create notification admin schemas

**Files:**
- Create: `packages/alepha/src/api/notifications/schemas/notificationQuerySchema.ts`
- Create: `packages/alepha/src/api/notifications/schemas/notificationResourceSchema.ts`
- Create: `packages/alepha/src/api/notifications/schemas/notificationDetailResourceSchema.ts`

**Step 1: Create notificationQuerySchema.ts**

```typescript
import { type Static, t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const notificationQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(
    t.enum([
      "pending",
      "scheduled",
      "retrying",
      "running",
      "completed",
      "failed",
      "dead",
      "cancelled",
    ]),
  ),
});

export type NotificationQuery = Static<typeof notificationQuerySchema>;
```

**Step 2: Create notificationResourceSchema.ts**

```typescript
import { type Static, t } from "alepha";

export const notificationResourceSchema = t.object({
  id: t.uuid(),
  createdAt: t.datetime(),
  status: t.text(),
  template: t.optional(t.text()),
  type: t.optional(t.text()),
  contact: t.optional(t.text()),
  category: t.optional(t.text()),
  critical: t.optional(t.boolean()),
  sensitive: t.optional(t.boolean()),
  startedAt: t.optional(t.datetime()),
  completedAt: t.optional(t.datetime()),
  error: t.optional(t.text()),
});

export type NotificationResource = Static<typeof notificationResourceSchema>;
```

**Step 3: Create notificationDetailResourceSchema.ts**

```typescript
import { type Static, t } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { notificationResourceSchema } from "./notificationResourceSchema.ts";

export const notificationDetailResourceSchema = t.extend(
  notificationResourceSchema,
  {
    variables: t.optional(t.record(t.text(), t.any())),
    rendered: t.optional(t.record(t.text(), t.any())),
    logs: t.optional(t.array(logEntrySchema)),
  },
  {
    title: "NotificationDetailResource",
    description: "A notification resource with rendered content and logs.",
  },
);

export type NotificationDetailResource = Static<
  typeof notificationDetailResourceSchema
>;
```

**Step 4: Run typecheck**

Run: `yarn w alepha typecheck`

---

### Task 4: Create AdminNotificationController

**Files:**
- Create: `packages/alepha/src/api/notifications/controllers/AdminNotificationController.ts`

**Step 1: Create the controller**

```typescript
import { $inject, t } from "alepha";
import { JobService } from "alepha/api/jobs";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { NotificationJobs } from "../jobs/NotificationJobs.ts";
import { notificationDetailResourceSchema } from "../schemas/notificationDetailResourceSchema.ts";
import { notificationQuerySchema } from "../schemas/notificationQuerySchema.ts";
import { notificationResourceSchema } from "../schemas/notificationResourceSchema.ts";

export class AdminNotificationController {
  protected readonly url: string = "/notifications";
  protected readonly group: string = "admin:notifications";
  protected readonly jobService = $inject(JobService);
  protected readonly notificationJobs = $inject(NotificationJobs);

  protected get jobName(): string {
    return this.notificationJobs.sendNotification.name;
  }

  public readonly findNotifications = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    schema: {
      query: notificationQuerySchema,
      response: t.page(notificationResourceSchema),
    },
    handler: async ({ query }) => {
      const result = await this.jobService.findExecutions({
        ...query,
        job: this.jobName,
      });
      return {
        ...result,
        content: result.content.map((exec) => this.toResource(exec)),
      };
    },
  });

  public readonly getNotification = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: notificationDetailResourceSchema,
    },
    handler: async ({ params }) => {
      const detail = await this.jobService.getExecution(params.id);
      return this.toDetailResource(detail);
    },
  });

  protected toResource(exec: Record<string, unknown>) {
    const payload = (exec.payload ?? {}) as Record<string, unknown>;
    return {
      id: exec.id,
      createdAt: exec.createdAt,
      status: exec.status,
      template: payload.template,
      type: payload.type,
      contact: payload.contact,
      category: payload.category,
      critical: payload.critical,
      sensitive: payload.sensitive,
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      error: exec.error,
    };
  }

  protected toDetailResource(exec: Record<string, unknown>) {
    const payload = (exec.payload ?? {}) as Record<string, unknown>;
    return {
      ...this.toResource(exec),
      variables: payload.variables,
      rendered: exec.result,
      logs: exec.logs,
    };
  }
}
```

**Step 2: Run typecheck**

Run: `yarn w alepha typecheck`

---

### Task 5: Update notification module exports

**Files:**
- Modify: `packages/alepha/src/api/notifications/index.ts`
- Modify: `packages/alepha/src/api/notifications/index.browser.ts`

**Step 1: Update index.ts**

Add exports for the new controller and schemas, and register `AdminNotificationController` in the module. Since the controller depends on `JobService` (from `AlephaApiJobs`), the module registration needs to include it.

```typescript
import { $module } from "alepha";
import { AdminNotificationController } from "./controllers/AdminNotificationController.ts";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { $notification } from "./primitives/$notification.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";

// ---

export * from "./controllers/AdminNotificationController.ts";
export * from "./jobs/NotificationJobs.ts";
export * from "./primitives/$notification.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationDetailResourceSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./schemas/notificationResourceSchema.ts";
export * from "./services/NotificationSenderService.ts";

// ---

export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  primitives: [$notification],
  services: [NotificationSenderService, NotificationJobs, AdminNotificationController],
  register: (alepha) => {
    alepha.with(NotificationSenderService).with(NotificationJobs).with(AdminNotificationController);
  },
});
```

**Step 2: Update index.browser.ts**

Add browser-safe schema exports (no controller, no services).

```typescript
import { $module } from "alepha";

// ---

export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationDetailResourceSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./schemas/notificationResourceSchema.ts";

// ---

export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  services: [],
});
```

**Step 3: Run typecheck**

Run: `yarn w alepha typecheck`

---

### Task 6: Create AdminNotifications UI component

**Files:**
- Create: `packages/ui/src/admin/components/notifications/AdminNotifications.tsx`

**Step 1: Create the component**

Follow the pattern from `AdminJobExecutions.tsx`. DataTable with notification-specific columns, expandable panels for errors, and a drawer for full detail with rendered content.

```tsx
import type { DetailListItem } from "@alepha/ui";
import {
  ActionButton,
  DataTable,
  DetailList,
  Flex,
  Text,
  useToast,
} from "@alepha/ui";
import { Badge, Code, Paper } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type {
  AdminNotificationController,
  NotificationDetailResource,
  NotificationResource,
} from "alepha/api/notifications";
import type { LogEntry } from "alepha/logger";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────

const formatDuration = (
  start: Date | string,
  end?: Date | string | null,
): string => {
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const duration = endTime - startTime;

  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
  if (duration < 3600000)
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  return `${Math.floor(duration / 3600000)}h ${Math.floor((duration % 3600000) / 60000)}m`;
};

// ─────────────────────────────────────────────────────────────────────────────

const notificationFilters = t.object({
  status: t.optional(
    t.enum([
      "pending",
      "scheduled",
      "retrying",
      "running",
      "completed",
      "failed",
      "dead",
      "cancelled",
    ]),
  ),
});

// ─────────────────────────────────────────────────────────────────────────────

const AdminNotifications = () => {
  const client = useClient<AdminNotificationController>();
  const { l } = useI18n();

  return (
    <Flex p="md" flex={1} direction="column" gap="md">
      <DataTable<NotificationResource, typeof notificationFilters>
        submitOnInit
        defaultSize={20}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "sm",
          verticalSpacing: "sm",
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={notificationFilters}
        defaultFilters={["status"]}
        items={async (filters) => {
          const response = await client.findNotifications({
            query: { ...filters },
          });
          return response as Page<NotificationResource>;
        }}
        columns={{
          status: {
            label: "Status",
            value: (item) => {
              const color =
                item.status === "completed"
                  ? "green"
                  : item.status === "running"
                    ? "blue"
                    : item.status === "failed" || item.status === "dead"
                      ? "red"
                      : item.status === "cancelled"
                        ? "yellow"
                        : "gray";
              return (
                <Badge size="sm" variant="light" color={color}>
                  {item.status}
                </Badge>
              );
            },
          },
          template: {
            label: "Template",
            value: (item) => (
              <Text size="sm" fw={500} ff="monospace">
                {item.template ?? "—"}
              </Text>
            ),
          },
          type: {
            label: "Type",
            value: (item) => (
              <Badge size="sm" variant="light" color={item.type === "email" ? "blue" : "teal"}>
                {item.type ?? "—"}
              </Badge>
            ),
          },
          contact: {
            label: "Contact",
            value: (item) => (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {item.contact ?? "—"}
              </Text>
            ),
          },
          category: {
            label: "Category",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.category ?? "—"}
              </Text>
            ),
          },
          flags: {
            label: "Flags",
            defaultHidden: true,
            value: (item) => (
              <Flex gap={4}>
                {item.critical && (
                  <Badge size="xs" variant="light" color="red">
                    critical
                  </Badge>
                )}
                {item.sensitive && (
                  <Badge size="xs" variant="light" color="orange">
                    sensitive
                  </Badge>
                )}
                {!item.critical && !item.sensitive && (
                  <Text size="xs" c="dimmed">—</Text>
                )}
              </Flex>
            ),
          },
          createdAt: {
            label: "Created",
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
          duration: {
            label: "Duration",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.startedAt &&
                (item.completedAt || item.status === "running")
                  ? formatDuration(item.startedAt, item.completedAt)
                  : "—"}
              </Text>
            ),
          },
          error: {
            label: "Error",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {item.error ?? "—"}
              </Text>
            ),
          },
        }}
        panel={{
          can: (item) => Boolean(item.error),
          render: (item) => (
            <Flex direction="column" gap="sm" p="sm">
              {item.error && (
                <Flex direction="column" gap={2}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Error
                  </Text>
                  <Paper p="xs" radius="sm" withBorder>
                    <Text
                      size="sm"
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.error}
                    </Text>
                  </Paper>
                </Flex>
              )}
            </Flex>
          ),
        }}
        drawer={(item) => (
          <NotificationDetailContent item={item} />
        )}
      />
    </Flex>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const NotificationDetailContent = ({
  item,
}: {
  item: NotificationResource;
}) => {
  const client = useClient<AdminNotificationController>();
  const { l } = useI18n();
  const toast = useToast();
  const [detail, setDetail] = useState<NotificationDetailResource | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetail(null);
      setLoading(true);
      try {
        const data = await client.getNotification({ params: { id } });
        setDetail(data);
      } catch {
        toast.danger("Failed to load notification details");
      } finally {
        setLoading(false);
      }
    },
    [client, toast],
  );

  useEffect(() => {
    loadDetail(item.id);
  }, [item.id, loadDetail]);

  if (loading) {
    return (
      <Flex align="center" justify="center" py="xl">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (!detail) return null;

  const rendered = detail.rendered as Record<string, unknown> | undefined;

  const detailItems: DetailListItem[] = [
    {
      label: "ID",
      value: (
        <Text size="sm" ff="monospace">
          {detail.id}
        </Text>
      ),
      copyable: detail.id,
    },
    {
      label: "Status",
      value: (
        <Text size="sm" tt="capitalize">
          {detail.status}
        </Text>
      ),
    },
    {
      label: "Template",
      value: (
        <Text size="sm" ff="monospace">
          {detail.template}
        </Text>
      ),
    },
    {
      label: "Type",
      value: (
        <Badge size="sm" variant="light" color={detail.type === "email" ? "blue" : "teal"}>
          {detail.type}
        </Badge>
      ),
    },
    {
      label: "Contact",
      value: detail.contact,
    },
    {
      label: "Category",
      value: detail.category,
      hidden: !detail.category,
    },
    {
      label: "Critical",
      value: detail.critical ? "Yes" : "No",
      hidden: !detail.critical,
    },
    {
      label: "Sensitive",
      value: detail.sensitive ? "Yes" : "No",
      hidden: !detail.sensitive,
    },
    {
      label: "Created",
      value: String(l(detail.createdAt, { date: "lll" })),
    },
    {
      label: "Started",
      value: detail.startedAt
        ? String(l(detail.startedAt, { date: "lll" }))
        : undefined,
      hidden: !detail.startedAt,
    },
    {
      label: "Duration",
      value:
        detail.startedAt &&
        (detail.completedAt || detail.status === "running") ? (
          <Text size="sm" ff="monospace">
            {formatDuration(detail.startedAt, detail.completedAt)}
          </Text>
        ) : undefined,
      hidden: !(
        detail.startedAt &&
        (detail.completedAt || detail.status === "running")
      ),
    },
  ];

  return (
    <Flex direction="column" gap="md">
      {/* Header */}
      <Flex align="center" gap="sm">
        <Text fw={600} ff="monospace">
          {detail.template}
        </Text>
        <Badge size="sm" variant="light" color={detail.type === "email" ? "blue" : "teal"}>
          {detail.type}
        </Badge>
        <Text size="sm" tt="capitalize" c="dimmed">
          {detail.status}
        </Text>
      </Flex>

      {/* Actions */}
      <Flex gap="xs">
        <ActionButton
          tooltip="Refresh"
          variant="light"
          size="xs"
          icon={IconRefresh}
          onClick={() => loadDetail(item.id)}
        />
      </Flex>

      {/* Details */}
      <Paper p="sm" radius="md" withBorder>
        <Text size="sm" fw={600} mb="xs">
          Details
        </Text>
        <DetailList items={detailItems} columns={2} />
      </Paper>

      {/* Rendered Content */}
      {rendered && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Content
          </Text>
          {rendered.type === "email" && (
            <Flex direction="column" gap="xs">
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  To
                </Text>
                <Text size="sm">{String(rendered.to ?? "")}</Text>
              </Flex>
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Subject
                </Text>
                <Text size="sm">{String(rendered.subject ?? "")}</Text>
              </Flex>
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Body
                </Text>
                <Paper p="xs" radius="sm" withBorder>
                  <Text
                    size="sm"
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {String(rendered.body ?? "")}
                  </Text>
                </Paper>
              </Flex>
            </Flex>
          )}
          {rendered.type === "sms" && (
            <Flex direction="column" gap="xs">
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  To
                </Text>
                <Text size="sm">{String(rendered.to ?? "")}</Text>
              </Flex>
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Message
                </Text>
                <Paper p="xs" radius="sm" withBorder>
                  <Text
                    size="sm"
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {String(rendered.message ?? "")}
                  </Text>
                </Paper>
              </Flex>
            </Flex>
          )}
        </Paper>
      )}

      {/* Variables */}
      {detail.variables && Object.keys(detail.variables).length > 0 && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Variables
          </Text>
          <Code block>{JSON.stringify(detail.variables, null, 2)}</Code>
        </Paper>
      )}

      {/* Error */}
      {detail.error && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Error
          </Text>
          <Paper p="xs" radius="sm" withBorder>
            <Text
              size="sm"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {detail.error}
            </Text>
          </Paper>
        </Paper>
      )}

      {/* Logs */}
      {detail.logs && detail.logs.length > 0 && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Logs ({detail.logs.length})
          </Text>
          <Flex
            direction="column"
            style={{ maxHeight: 300, overflowY: "auto" }}
          >
            {detail.logs.map((log: LogEntry, i: number) => (
              <Flex key={i} gap="sm" py={2}>
                <Badge size="xs" variant="default">
                  {log.level}
                </Badge>
                <Text size="xs" c="dimmed" ff="monospace">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </Text>
                <Text size="xs">{log.message}</Text>
              </Flex>
            ))}
          </Flex>
        </Paper>
      )}
    </Flex>
  );
};

export default AdminNotifications;
```

**Step 2: Run typecheck**

Run: `yarn w @alepha/ui typecheck`

---

### Task 7: Update AdminRouter

**Files:**
- Modify: `packages/ui/src/admin/AdminRouter.tsx`

**Step 1: Add imports**

Add `IconBell` icon import and `AdminNotificationController` type import.

```typescript
// Add to icon imports:
import { IconBell } from "@tabler/icons-react";

// Add to type imports:
import type { AdminNotificationController } from "alepha/api/notifications";
```

**Step 2: Add notification controller client**

In the `AdminRouter` class, add the client field:

```typescript
protected readonly notificationCtrl = $client<AdminNotificationController>();
```

**Step 3: Add adminNotifications page**

Add a new page definition after the jobs section:

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

public readonly adminNotifications = $page({
  icon: IconBell,
  parent: this.adminLayout,
  path: "/notifications",
  label: "Notifications",
  description: "View sent notifications and their delivery status.",
  head: {
    title: "Notifications",
  },
  lazy: () => import("./components/notifications/AdminNotifications.tsx"),
  can: () => this.notificationCtrl.findNotifications.can(),
});
```

**Step 4: Add to sidebar**

In `getDefaultSidebarItems()`, add the notification entry in the System section alongside Jobs, Files, Parameters:

```typescript
{
  ...this.router.node(this.adminNotifications.name),
  can: () => this.notificationCtrl.findNotifications.can(),
},
```

Place it after the Jobs group and before Parameters.

**Step 5: Run typecheck**

Run: `yarn w @alepha/ui typecheck`

---

### Task 8: Verify

**Step 1: Full lint + typecheck**

Run: `yarn lint && yarn typecheck`

**Step 2: Run tests**

Run: `yarn test`

Fix any issues that arise.
