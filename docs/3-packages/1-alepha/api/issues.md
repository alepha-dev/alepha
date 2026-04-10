# alepha/api/issues

Issue tracking module for bug reports, feature requests, and improvement suggestions.

## Features

- Issue submission by authenticated users
- Admin workflow: assign, complete, reopen, archive
- Status lifecycle: open → assigned → completed → archived
- Configurable limits (max open issues per user, enable/disable)
- Lifecycle hooks for all transitions

## Usage

```typescript
import { AlephaApiIssues } from "alepha/api/issues";

const alepha = Alepha.create().with(AlephaApiIssues);
```

## Entity

Table `issues` with columns: id, title, type, priority, status, description, pageUrl, assigneeId, assignedAt, resolution, completedAt, reopenReason, archivedAt, createdBy, createdAt, updatedAt, version.

## Schemas

- `createIssueSchema` — title (required), type, priority, description, pageUrl
- `updateIssueSchema` — partial update of title, type, priority, description, pageUrl
- `issueQuerySchema` — paginated query with status, type, priority, assigneeId, search filters
- `issueResourceSchema` — full entity for API responses

## Configuration

```typescript
alepha.store.set(issueConfigAtom, {
  enabled: true,        // default: true
  maxOpenPerUser: 50,   // default: 50
});
```

## Hooks

| Event | Payload | When |
|-------|---------|------|
| `issue:created` | `{ issue }` | New issue submitted |
| `issue:assigned` | `{ issue, assigneeId }` | Issue assigned to user |
| `issue:completed` | `{ issue }` | Issue marked completed |
| `issue:reopened` | `{ issue, reason }` | Completed issue reopened |
| `issue:archived` | `{ issue }` | Completed issue archived |
| `issue:deleted` | `{ issue }` | Issue deleted |

## Endpoints

### User

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/api/issues` | `issue:create` | Submit issue |
| GET | `/api/issues/mine` | `issue:read` | List own issues |

### Admin

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/issues` | `admin:issue:read` | List all issues |
| GET | `/api/issues/:id` | `admin:issue:read` | Get issue |
| PATCH | `/api/issues/:id` | `admin:issue:update` | Update fields |
| POST | `/api/issues/:id/assign` | `admin:issue:update` | Assign |
| POST | `/api/issues/:id/complete` | `admin:issue:update` | Complete |
| POST | `/api/issues/:id/reopen` | `admin:issue:update` | Reopen |
| POST | `/api/issues/:id/archive` | `admin:issue:update` | Archive |
| DELETE | `/api/issues/:id` | `admin:issue:delete` | Delete |

## Services

- `IssueService` — business logic and state transition enforcement
