# Alepha Framework - Module Reference

A comprehensive reference of all modules in the Alepha framework.

---

## alepha/core

| type | quality | stability |
|------|---------|-----------|
| tooling | epic | stable |

Foundation of the entire framework with dependency injection and lifecycle management.

**Features:**
- Dependency injection for services
- Service substitution/mocking
- Type-safe environment variable loading with TypeBox schemas
- Lifecycle hooks (start, stop, log, etc.)
- Module definitions and composition
- Request-scoped context access via Async Local Storage (ALS)
- Reactive state management with atoms
- Cluster mode with automatic worker forking
- Full TypeScript generics and type inference

---

## alepha/orm

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

Full-featured database abstraction built on Drizzle ORM with complete type safety.

**Features:**
- Define database entities with TypeBox schemas
- Automatic timestamps, soft deletes, and versioning columns
- Type-safe CRUD operations with filtering, pagination, sorting, and relationships
- Database transaction support with automatic rollback
- Auto-incrementing sequences for IDs
- PostgreSQL support (Node.js, Bun, Cloudflare Workers via pglite)
- SQLite support (Node.js, Bun, Cloudflare D1)
- Automatic schema sync for development/testing
- Drizzle Kit migrations for production
- Type-safe filters: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `like`, `between`
- JSONB column support
- Relationship joins

---

## alepha/server

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

Convention-driven HTTP server with automatic validation and type inference.

**Features:**
- Type-safe API endpoints with schema validation
- Lower-level HTTP route definitions
- Automatic request/response validation via TypeBox
- Convention-based URL generation (`/api/{ActionName}`)
- Direct invocation (`run()`) or HTTP (`fetch()`)
- Built-in authentication integration
- Multipart file upload handling
- Content-type auto-negotiation (JSON, form-data, text)
- HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- Error handling: BadRequestError, ValidationError, ForbiddenError, UnauthorizedError, ConflictError, NotFoundError

---

## alepha/security

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

Complete authentication and authorization system with JWT, RBAC, and multi-issuer support.

**Features:**
- JWT token issuer with role definitions
- Role-based access control (RBAC)
- Fine-grained permissions
- HTTP Basic Authentication
- Service-to-service authentication
- Multi-issuer support for federated auth
- JWKS (JSON Web Key Set) for external issuers
- Token refresh logic
- User profile extraction from JWT

---

## alepha/queue

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

Asynchronous message processing with automatic worker management.

**Features:**
- Background job queues with type-safe payloads
- Queue consumer handlers
- Automatic worker threads for non-blocking processing
- Retry mechanisms with exponential backoff
- Dead letter queues for failed messages
- Batch processing support
- Configurable concurrency and worker pools
- Providers: Memory (dev), Redis (production)

---

## alepha/api/users

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

Complete user management with multi-realm support for multi-tenant applications.

**Features:**
- User registration, login, and profile management
- Password reset workflows
- Email verification
- Session management with multiple devices
- Identity management (social logins, SSO)
- Multi-realm support for tenant isolation
- Credential management
- Entities: `users`, `identities`, `sessions`

---

## alepha/topic

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Publish/subscribe messaging for event-driven architectures.

**Features:**
- Pub/sub topics with type-safe messages
- Topic subscription handlers
- Multiple subscriber support
- Message filtering and routing
- Providers: Memory (dev), Redis (production)

---

## alepha/scheduler

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Cron and interval-based task execution.

**Features:**
- Scheduled tasks with cron expressions (e.g., `0 0 * * *`)
- Interval-based scheduling
- Distributed locking to prevent duplicate execution
- Lifecycle hooks: `begin`, `success`, `error`, `end`

---

## alepha/lock

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Resource locking for distributed systems.

**Features:**
- Distributed locks with timeout
- Time-based lock expiration
- Automatic release on scope exit
- Distributed coordination via Redis
- Providers: Memory (dev), Redis (production)

---

## alepha/bucket

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Unified file storage abstraction across multiple backends.

**Features:**
- File storage buckets with constraints
- Unified API across all storage backends
- MIME type validation
- File size limits
- Upload/download/delete operations
- TTL-based file expiration
- Providers: Memory (testing), Local filesystem, AWS S3 / Cloudflare R2 / MinIO, Azure Blob Storage, Vercel Blob

---

## alepha/cache

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Type-safe caching with TTL support.

**Features:**
- Cached computations with type-safe keys and values
- Configurable TTL
- Cache invalidation
- Automatic cache population
- Providers: Memory (default), Redis

---

## alepha/websocket

| type | quality | stability |
|------|---------|-----------|
| backend | rare | experimental |

Real-time bidirectional communication.

**Features:**
- WebSocket server definition
- Named communication channels
- Type-safe message handling
- Connection lifecycle management
- Room/channel grouping
- Browser compatibility

---

## alepha/email

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Email delivery with template support.

**Features:**
- Send emails with templates
- Multiple recipients
- SMTP via Nodemailer
- Local file provider for development

---

## alepha/sms

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

SMS delivery with multiple provider support.

**Features:**
- Send SMS with templates
- Multiple recipients
- Provider abstraction

---

## alepha/server/auth

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

OAuth2/OIDC authentication with social login providers.

**Features:**
- OAuth authentication provider
- Username/password authentication
- Google OAuth integration
- GitHub OAuth integration
- Apple OAuth integration
- Cookie-based, SSR-friendly authentication
- Token management and refresh

---

## alepha/server/links

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Type-safe API client with request deduplication.

**Features:**
- Virtual HTTP client for type-safe API calls
- Remote action definitions
- Type inference from action schemas
- Request deduplication
- Automatic error handling

---

## alepha/server/cookies

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Server and browser-safe cookie handling.

**Features:**
- Cookie management on server and browser

---

## alepha/server/cors

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Cross-Origin Resource Sharing configuration.

**Features:**
- CORS policy definition

---

## alepha/server/rate-limit

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Request rate limiting on actions.

**Features:**
- Rate limit configuration per action

---

## alepha/server/cache

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

ETag-based response caching.

**Features:**
- ETag generation and validation
- Conditional request handling

---

## alepha/server/compress

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Response compression.

**Features:**
- Gzip compression
- Brotli compression

---

## alepha/server/health

| type | quality | stability |
|------|---------|-----------|
| devops | standard | stable |

Application health monitoring endpoints.

**Features:**
- `GET /health` endpoint

---

## alepha/server/helmet

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

HTTP security headers.

**Features:**
- X-Frame-Options
- X-Content-Type-Options
- Content-Security-Policy
- Other security headers

---

## alepha/server/metrics

| type | quality | stability |
|------|---------|-----------|
| devops | standard | stable |

Prometheus-style metrics collection.

**Features:**
- Prometheus-style metrics
- Custom metric registration
- Metric exposition endpoint

---

## alepha/server/static

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Static file serving.

**Features:**
- Serve static files from directory

---

## alepha/server/proxy

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Reverse proxy routing.

**Features:**
- Proxy configuration and routing

---

## alepha/server/swagger

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Automatic API documentation generation.

**Features:**
- Swagger/OpenAPI configuration
- Routes: `GET /swagger/ui`, `GET /swagger.json`

---

## alepha/server/multipart

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Multipart form data handling for file uploads.

**Features:**
- File upload parsing
- Form field extraction

---

## alepha/api/notifications

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

User notification management.

**Features:**
- Notification definitions
- Email/SMS notification sending
- Status tracking
- User preferences
- Queue integration

---

## alepha/api/files

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

File management endpoints.

**Features:**
- Upload/download endpoints
- File metadata storage
- TTL-based expiration
- Storage statistics

---

## alepha/api/jobs

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Job execution monitoring.

**Features:**
- Job definitions for tracking
- Job status tracking
- Execution history
- Retry management

---

## alepha/api/parameters

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Application configuration management.

**Features:**
- Versioned configuration definitions
- Scheduled activation (FUTURE, NEXT, CURRENT, EXPIRED)
- Schema validation with migration detection
- Cross-instance sync via pub/sub

---

## alepha/api/audits

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Audit trail for compliance.

**Features:**
- Domain-specific audit types
- Audit event logging
- Filtering and searching
- User action tracking

---

## alepha/api/verifications

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Email and phone verification workflows.

**Features:**
- Verification token generation
- Verification code sending
- Verification completion tracking
- Resend functionality

---

## alepha/batch

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Batch accumulation and processing.

**Features:**
- Batch accumulator with handler
- Configurable batch size
- Time-based triggers
- Status tracking

---

## alepha/retry

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Automatic retry with backoff.

**Features:**
- Retry configuration
- Exponential backoff
- Max retry limits
- Custom retry predicates

---

## alepha/thread

| type | quality | stability |
|------|---------|-----------|
| backend | standard | experimental |

Multi-threading support.

**Features:**
- Worker thread definitions
- Worker thread management
- Message passing
- Worker pools

---

## alepha/redis

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Redis client wrapper.

**Features:**
- Connection pooling
- Automatic reconnection
- Command pipelining
- Pub/sub support

---

## alepha/mcp

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Model Context Protocol for AI tool integration.

**Features:**
- MCP resource definitions
- MCP tool definitions
- MCP prompt definitions
- JSON-RPC protocol
- SSE and Stdio transports

---

## alepha/logger

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | stable |

Configurable logging with multiple outputs.

**Features:**
- Global logger access
- JSON format
- Pretty colored output
- Raw text format
- Console destination
- Memory destination (for devtools)
- Custom handlers
- Configuration via `LOG_LEVEL` and `LOG_FORMAT`

---

## alepha/command

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | stable |

Declarative CLI command framework.

**Features:**
- CLI command definitions
- Interactive CLI prompts
- Command execution
- Formatted colored output
- Environment variable utilities
- Schema validation for CLI arguments

---

## alepha/fake

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | stable |

Test data generation with Faker.js.

**Features:**
- TypeBox schema-based generation
- Context-aware field generation (email field → email address)
- Test data seeding

---

## alepha/testing

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | stable |

Testing support and utilities.

**Features:**
- Automatic lifecycle management in tests
- Service substitution via `Alepha.with()`
- Memory providers for isolation
- Test helpers

---

## alepha/datetime

| type | quality | stability |
|------|---------|-----------|
| tooling | standard | stable |

Date and time operations.

**Features:**
- Recurring interval definitions
- Duration parsing (ISO 8601, human-readable)
- Timezone support
- Dayjs integration

---

## alepha/file

| type | quality | stability |
|------|---------|-----------|
| tooling | standard | stable |

File operations and type detection.

**Features:**
- File type detection
- MIME type utilities
- Path operations

---

## alepha/router

| type | quality | stability |
|------|---------|-----------|
| frontend | standard | stable |

Frontend routing infrastructure.

**Features:**
- Route state management
- Navigation methods
- Route matching

---

## @alepha/react

| type | quality | stability |
|------|---------|-----------|
| frontend | epic | stable |

Full-stack React framework with server-side rendering.

**Features:**
- React page routes with type-safe params
- Async action handler with loading/error/cancel states
- Type-safe HTTP client access
- Dependency injection in components
- Global state management
- Router navigation methods
- Current route state access
- Check if path is active
- URL query parameters
- Access route schema
- Subscribe to Alepha events
- Type-safe form handling with validation
- Error handling wrapper component
- Client-side only rendering component
- Server-side rendering with hydration
- Automatic code splitting
- Event system for action tracking

---

## @alepha/react/form

| type | quality | stability |
|------|---------|-----------|
| frontend | rare | stable |

Type-safe forms with validation.

**Features:**
- Form state management
- TypeBox schema validation
- Field-level error handling
- Submit handling with loading state
- Form reset

---

## @alepha/react/auth

| type | quality | stability |
|------|---------|-----------|
| frontend | rare | stable |

Auth-related React components and hooks.

**Features:**
- Login/logout components
- Protected route wrappers
- Auth state hooks

---

## @alepha/react/head

| type | quality | stability |
|------|---------|-----------|
| frontend | standard | stable |

HTML head element management.

**Features:**
- Title, meta tags, and links
- SEO optimization
- Social media tags

---

## @alepha/react/i18n

| type | quality | stability |
|------|---------|-----------|
| frontend | standard | stable |

Multi-language support.

**Features:**
- Translation loading
- Locale detection
- Pluralization

---

## @alepha/ui

| type | quality | stability |
|------|---------|-----------|
| frontend | rare | experimental |

Core UI components based on Mantine UI v8.

**Features:**
- Mantine integration with theme support
- ActionButton, BurgerButton, ClipboardButton, DarkModeButton, LanguageButton, ThemeButton
- AlertDialog, ConfirmDialog, PromptDialog
- Form controls: Control, ControlArray, ControlDate, ControlNumber, ControlObject, ControlSelect, ControlQueryBuilder
- TypeForm for automatic form generation from TypeBox schemas
- AdminShell layout component
- AppBar with configurable elements
- Sidebar navigation with sections and menu items
- Omnibar for command palette / search
- DataTable with filtering, sorting, pagination
- Toast notifications
- Theme system with dark mode

---

## @alepha/ui/auth

| type | quality | stability |
|------|---------|-----------|
| frontend | rare | experimental |

Authentication UI components.

**Features:**
- Login page component
- Register page component
- Reset password page component
- Email verification page component
- UserButton for user menu

---

## @alepha/ui/admin

| type | quality | stability |
|------|---------|-----------|
| frontend | rare | experimental |

Admin panel UI components.

**Features:**
- AdminLayout for admin pages
- AdminUsers with user list, create, details, settings, sessions, audits
- AdminFiles for file management
- AdminJobs for job monitoring
- AdminNotifications for notification management
- AdminParameters for configuration management
- AdminSessions for session management
- AdminAudits for audit log viewing
- AdminVerifications for verification management

---

## @alepha/ui/json

| type | quality | stability |
|------|---------|-----------|
| frontend | standard | experimental |

JSON viewing components.

**Features:**
- JsonViewer component for displaying JSON data

---

## @alepha/ui/demo

| type | quality | stability |
|------|---------|-----------|
| frontend | standard | experimental |

Component showcase and documentation.

**Features:**
- DemoLayout for demo pages
- DemoHome landing page
- MacWindow component for showcases
- Showcase component for component demos

---

## @alepha/devtools

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | experimental |

Runtime inspection and debugging UI.

**Features:**
- DevTools UI at `GET /devtools`
- Application metadata at `GET /devtools/metadata`
- Last 10,000 logs at `GET /devtools/logs`
- Runtime inspection of actions, queues, schedulers, topics, buckets
- Log viewer with filtering
- React Flow visualization
- Provider and module browsing

---

## @alepha/bucket-s3

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

S3-compatible file storage provider.

**Features:**
- AWS S3 compatibility
- Cloudflare R2 compatibility
- MinIO compatibility
- DigitalOcean Spaces compatibility
- Any S3-compatible backend

---

## @alepha/bucket-vercel

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Vercel Blob Storage provider.

**Features:**
- Serverless-optimized storage
- Vercel deployment integration

---

## @alepha/protobuf

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Protocol Buffers support.

**Features:**
- Message serialization/deserialization
- TypeBox integration
- Compression support

---

## create-alepha

| type | quality | stability |
|------|---------|-----------|
| tooling | rare | stable |

Quick project setup tool.

**Features:**
- `npx create-alepha` to bootstrap projects
- Template selection
- Environment configuration
- Package manager detection
