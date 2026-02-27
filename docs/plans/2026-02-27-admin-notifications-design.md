# Admin Notifications

## Goal

Single admin page showing all sent notifications with their rendered content.

## Backend

### 1. NotificationSenderService.send()

Modify to return rendered content. Email returns `{ to, subject, body }`, SMS returns `{ to, message }`. The job handler stores this as the execution's `result` field — immutable record of what was actually sent.

### 2. AdminNotificationController

New controller at `api/notifications/controllers/` with two endpoints:

- `findNotifications` — GET `/notifications` — paginated list of sent notifications (job executions filtered to `sendNotification`), extracting notification-specific fields from `payload`
- `getNotification` — GET `/notifications/:id` — single notification detail with rendered content from `result`

Permission: `admin:notification:read`

### 3. Schemas

- `notificationQuerySchema` — extends `pageQuerySchema` with filters: template, type (email/sms), category, status
- `notificationResourceSchema` — list item: status, template, type, contact, category, critical, sensitive, timestamps, duration
- `notificationDetailResourceSchema` — extends resource with rendered content (email subject/body or SMS message), variables, error

## Frontend

### 4. AdminNotifications.tsx

DataTable with columns: Status, Template, Type (email/sms), Contact, Category, Critical/Sensitive badges, Created, Duration.

Filters: template name, type, category, status.

Drawer on row click showing rendered content (email subject+body or SMS message), payload variables, and error if failed.

### 5. AdminRouter.tsx

Add `adminNotifications` page under System section in sidebar, alongside Jobs/Files/Parameters.

## Data Flow

1. `$notification.push()` → queues `NotificationJobs.sendNotification`
2. Job handler calls `NotificationSenderService.send()` → renders + sends + returns rendered content
3. Rendered content stored as job execution `result`
4. Admin UI queries job executions filtered to notification job, extracts fields from `payload` + `result`
