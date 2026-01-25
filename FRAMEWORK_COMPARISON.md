# Alepha Framework - Complete Feature List

Last updated: 2026-01-24

Total features: **482+**

---

## Core Primitives (18)

- `$inject`: Dependency injection for services
- `$module`: Module definition and composition
- `$hook`: Lifecycle and event hooks
- `$env`: Environment variable validation with schema
- `$atom`: Global reactive state atoms
- `$context`: Async-local context storage
- `$use`: Service substitution helper
- `$logger`: Logger instance access
- `$interval`: Time interval definition
- `$permission`: Permission definition for RBAC
- `$role`: Role definition for RBAC
- `$issuer`: JWT token issuer definition
- `$retry`: Retry logic with backoff
- `$email`: Email sending primitive
- `$sms`: SMS sending primitive
- `$websocket`: WebSocket connection definition
- `$channel`: WebSocket channel definition
- `$batch`: Batch processing definition

## HTTP & Server Primitives (11)

- `$action`: Type-safe API endpoint with input/output schemas
- `$route`: HTTP route with method and path
- `$client`: Virtual HTTP client for type-safe calls
- `$cookie`: Type-safe, encrypted, signed cookies
- `$auth`: Authentication endpoint primitive
- `$cors`: CORS configuration
- `$rateLimit`: Rate limiting configuration
- `$swagger`: OpenAPI documentation generation
- `$serve`: Static file serving
- `$proxy`: Reverse proxy configuration
- `$basicAuth`: HTTP Basic Authentication

## Database Primitives (5)

- `$entity`: Database entity schema definition
- `$repository`: Type-safe database repository
- `$sequence`: Database sequence definition
- `$transaction`: Database transaction management
- `$job`: Job entity for queue management

## React Primitives (5)

- `$page`: React route page definition
- `$head`: HTML head tag management
- `$dictionary`: i18n translation dictionary
- `$realm`: Authentication realm (multi-tenant)
- `$notification`: Notification management

## Background Processing Primitives (6)

- `$queue`: Background job queue definition
- `$consumer`: Message consumer for queues
- `$scheduler`: Scheduled task (cron) definition
- `$topic`: Pub/sub topic definition
- `$subscriber`: Message subscriber for topics
- `$lock`: Distributed locking primitive

## Storage Primitives (2)

- `$bucket`: File storage bucket definition
- `$cache`: Data caching with TTL

## MCP Primitives (3)

- `$tool`: MCP tool definition for AI integration
- `$resource`: MCP resource definition
- `$prompt`: MCP prompt template definition

## CLI Primitives (2)

- `$command`: CLI command definition
- `$config`: Versioned configuration storage

---

## React Hooks (17)

- `useAction`: Async action with loading/error/cancel states
- `useClient`: HTTP client access
- `useForm`: Form state and validation
- `useFormState`: Individual form field state
- `useRouter`: Router navigation methods
- `useRouterState`: Current route state
- `useAlepha`: Alepha instance access
- `useInject`: Dependency injection in components
- `useStore`: Global state access
- `useEvents`: Event subscription
- `useActive`: Check if path is active
- `useQueryParams`: URL query parameters access
- `useSchema`: Route schema access
- `useHead`: HTML head management
- `useI18n`: Internationalization utilities (tr, l, setLang)
- `useAuth`: Authentication state and methods
- `useWebSocket`: WebSocket connection management

---

## State Management Features (18)

### Core Atom Features
- `$atom`: Define reactive state with schema
- Schema validation on state changes
- Default values for initial state
- Type-safe state access
- Read-only atom support
- Custom validation rules

### SSR & Hydration
- Server state serialized to client
- Automatic hydration on browser
- No hydration mismatch issues
- State preserved across navigation

### React Integration
- `useStore`: Subscribe to atom changes
- Automatic component re-renders
- Event-based updates (`state:mutate`)
- Works with atom or plain keys

### Persistence Adapters (Auto-Persist on Change)
- Cookie persistence (secure, signed)
- localStorage persistence
- File system persistence
- Redis persistence
- Database persistence
- Custom adapter support
- Automatic sync on state change

### Enterprise Features
- State migrations (schema version upgrades)
- Auto-generated admin page for editing
- History versioning (track changes)
- Access control (who can edit)
- Audit logging (who changed what)
- DevTools integration

---

## SSR Streaming Features (15)

### Early Head Streaming
- Send DOCTYPE, `<html>`, `<head>` immediately
- Entry JS/CSS sent before page loaders run
- Browser starts downloading assets during server work
- Vite SSR manifest integration for chunk discovery

### Template Optimization
- Parse template once at startup
- Pre-encode static parts as Uint8Array
- Zero-copy streaming of static content
- Template slots for efficient merging

### Streaming Flow
- Stream React content as it renders
- Hydration data injection (`window.__ssr`)
- Safe JSON serialization (XSS protection)
- Graceful error recovery during streaming

### Error Handling
- Inject error HTML instead of white screen
- Error boundary fallback during streaming
- Stack traces in development only
- Custom error handler support

### Performance
- Works on Cloudflare Workers (edge)
- No buffering - true streaming
- Early asset preloading
- Client hydration with cached data

---

## i18n Features (12)

### Dictionary System
- `$dictionary`: Lazy-loaded translation files
- Per-language dictionary registration
- Automatic language detection from cookie
- Fallback language support

### Translation Methods
- `tr(key, args)`: Translate with variable substitution
- `l(value)`: Localize numbers, dates, errors
- `setLang(lang)`: Switch language at runtime
- Automatic TypeBox error translation

### Date/Time Localization
- Intl.DateTimeFormat integration
- dayjs format string support
- Relative time ("2 hours ago")
- Timezone support (IANA names)

### Number Localization
- Intl.NumberFormat integration
- Currency formatting
- Percentage formatting
- Custom format options

### Lazy Loading
- Load only current language on browser
- Load fallback language on demand
- Preload all languages on server
- Dynamic import for translations

---

## Server Modules (15)

- `AlephaServer`: Core HTTP server with routing
- `AlephaServerCache`: Response caching with ETag
- `AlephaServerCors`: CORS middleware
- `AlephaServerHelmet`: Security headers
- `AlephaServerCompress`: Compression (gzip, brotli, zstd)
- `AlephaServerRateLimit`: Rate limiting
- `AlephaServerSwagger`: OpenAPI/Swagger UI
- `AlephaServerMultipart`: File upload handling
- `AlephaServerStatic`: Static file serving
- `AlephaServerProxy`: Reverse proxy
- `AlephaServerHealth`: Health check endpoints
- `AlephaServerAuth`: Auth endpoint handling
- `AlephaServerLinks`: Virtual HTTP client
- `AlephaServerCookies`: Cookie management
- `AlephaServerSecurity`: Security middleware

---

## ORM Features (35)

### Entity Definition
- Column types: string, number, integer, boolean, date, json, jsonb, uuid
- Special columns: createdAt, updatedAt, deletedAt, version
- Primary key generation
- Auto-increment columns
- Default values
- Nullable columns
- Unique constraints
- Index definitions
- Foreign key constraints

### Repository Methods
- `find()`: Query multiple records
- `findOne()`: Query single record
- `findOneOrFail()`: Query or throw
- `create()`: Insert record
- `createMany()`: Bulk insert
- `update()`: Update records
- `updateOne()`: Update single record
- `delete()`: Delete records
- `deleteOne()`: Delete single record
- `softDelete()`: Soft delete with deletedAt
- `restore()`: Restore soft-deleted
- `count()`: Count records
- `exists()`: Check existence

### Query Operators
- `eq`: Equals
- `ne`: Not equals
- `lt`: Less than
- `lte`: Less than or equal
- `gt`: Greater than
- `gte`: Greater than or equal
- `like`: Pattern match
- `ilike`: Case-insensitive pattern
- `in`: In array
- `notIn`: Not in array
- `isNull`: Is null
- `isNotNull`: Is not null
- `between`: Between range

### Advanced Features
- Relations: one-to-one, one-to-many, many-to-many
- Eager loading with `include`
- Transaction support
- Raw SQL fallback
- Migration generation
- Schema synchronization

---

## Database Drivers (7)

- PostgreSQL (pg)
- SQLite (better-sqlite3)
- Bun SQLite (bun:sqlite)
- PGLite (embedded Postgres)
- Cloudflare D1
- Turso (libSQL)
- Neon (serverless Postgres)

---

## Storage Backends (6)

- Local file system
- Memory (testing)
- AWS S3
- Cloudflare R2
- Azure Blob Storage
- Vercel Blob Storage

---

## Queue Features (18)

### Core Queue
- `$queue`: Define message queue with schema
- `$consumer`: Message consumer definition
- Schema validation on messages
- Background worker threads
- Non-blocking processing

### Reliability
- Automatic retry with exponential backoff
- Dead letter queue for failed messages
- Message persistence across restarts
- Graceful shutdown (process pending)
- Idempotent handler support

### Performance
- Batch push (multiple messages)
- Configurable concurrency
- Horizontal scaling (distributed)
- Connection pooling
- Worker wakeup optimization

### Providers
- Memory queue (development/testing)
- Redis queue (production, BullMQ-compatible)
- Custom provider support

---

## Cache Backends (2)

- Memory cache
- Redis cache

---

## Lock Backends (2)

- Memory lock
- Redis lock (Redlock)

---

## Topic Backends (2)

- Memory pub/sub
- Redis pub/sub

---

## Type System (t.*) (30)

### Primitives
- `t.string()`: String validation
- `t.number()`: Number validation
- `t.integer()`: Integer validation
- `t.boolean()`: Boolean validation
- `t.null()`: Null type
- `t.undefined()`: Undefined type
- `t.bigint()`: BigInt validation
- `t.symbol()`: Symbol type
- `t.any()`: Any type
- `t.unknown()`: Unknown type
- `t.never()`: Never type
- `t.void()`: Void type

### Compound Types
- `t.object()`: Object schema
- `t.array()`: Array schema
- `t.tuple()`: Tuple schema
- `t.record()`: Record/map schema
- `t.union()`: Union types
- `t.intersect()`: Intersection types
- `t.enum()`: Enum validation
- `t.literal()`: Literal values

### Modifiers
- `t.optional()`: Optional wrapper
- `t.readonly()`: Read-only wrapper
- `t.nullable()`: Nullable wrapper
- `t.partial()`: Partial object
- `t.required()`: Required object
- `t.pick()`: Pick properties
- `t.omit()`: Omit properties

### Format Validators
- `t.text()`: Text with constraints
- `t.email()`: Email format
- `t.uuid()`: UUID format
- `t.date()`: Date/datetime
- `t.password()`: Password rules
- `t.phone()`: Phone number
- `t.url()`: URL format
- `t.file()`: File upload
- `t.json()`: JSON content

---

## Codec System (8)

- JSON codec (standard)
- Keyless JSON codec (50% smaller, 2x faster)
- Protobuf codec (@alepha/protobuf)
- Binary encoding support (Uint8Array)
- Custom codec registration
- Schema-based validation
- Encoder switching at runtime
- Zero-copy streaming encoding

---

## Logger Features (15)

### Log Levels
- `SILENT`: No output
- `ERROR`: Errors only
- `WARN`: Warnings and above
- `INFO`: Info and above
- `DEBUG`: Debug and above
- `TRACE`: All messages

### Formatters
- JSON formatter (structured logs)
- Pretty formatter (colored console)
- Raw formatter (plain text)

### Destinations
- Console output
- File output
- Memory capture (testing/devtools)

### Features
- Module-aware logging
- Request ID tracking (via ALS)
- Per-module log levels: `LOG_LEVEL=db:trace,auth:warn`
- Wildcard patterns: `LOG_LEVEL=alepha.*:debug`
- Event emission on log

---

## Security Features (35)

### JWT & Token Management
- `$issuer`: JWT token issuer/verifier
- Internal mode (secret key signing)
- External mode (JWKS for OAuth2/OIDC)
- Access token with configurable expiration
- Refresh token with configurable expiration
- Token refresh flow
- Session ID tracking (sid claim)
- Custom session hooks (onCreate, onRefresh, onDelete)
- Profile mapping from JWT claims

### Role-Based Access Control
- `$role`: Role definition primitive
- Roles with permissions list
- Wildcard permissions (`users:*`)
- Permission exclusions from wildcards
- Ownership flag (access own resources only)
- Default role assignment
- Roles scoped to issuer
- `role.can(permission)` checking

### Permission System
- `$permission`: Permission primitive
- Group-based organization (auto from class name)
- Format: `group:name` (e.g., `users:read`)
- Multi-layer permission checking
- `permission.can(user)` checking
- Route-level `secure` option
- Action-level permission requirements

### Service Accounts
- `$serviceAccount`: Machine-to-machine tokens
- System user for internal actions
- Context-aware user forwarding

### HTTP Authentication
- `$basicAuth`: HTTP Basic Authentication
- Bearer token extraction
- Authorization header parsing
- Secure cookie handling

### Password Security
- Password hashing (bcrypt)
- Password validation rules
- Password reset flow
- Password history tracking

### Multi-Tenant
- Multi-realm authentication
- Realm-scoped roles
- Realm-scoped users
- Cross-realm token validation

### Session Management
- Session creation hooks
- Session refresh hooks
- Session deletion hooks
- Session ID in tokens

---

## Durable Workflow Features (10) [Beta]

### Workflow Execution
- `$workflow`: Define durable workflows
- Step-based execution (pause/resume)
- Queue-based step processing
- State persistence between steps
- Automatic retry on failure

### Workflow Control
- Manual workflow triggering
- Step completion callbacks
- Workflow cancellation
- Error recovery
- Timeout handling

---

## API Modules (8)

- `AlephaApiUsers`: User CRUD, auth, password reset, roles
- `AlephaApiFiles`: File upload, download, metadata
- `AlephaApiJobs`: Job queue monitoring, retry, cancel
- `AlephaApiNotifications`: Push, email, SMS notifications
- `AlephaApiParameters`: Versioned app configuration
- `AlephaApiVerifications`: Email/SMS verification flows
- `AlephaApiAudits`: Activity logging, audit trail
- `AlephaApiWorkflows`: Durable workflow execution

---

## MCP Features (12)

### Transports
- Stdio transport (CLI tools)
- SSE transport (HTTP streaming)

### Protocol
- JSON-RPC 2.0 support
- Tool execution with schema validation
- Resource content serving
- Prompt template rendering

### Integration
- Auth integration with `$issuer`
- Error handling with MCP error types
- Capability negotiation
- Tool parameter validation

---

## DevTools Features (10)

- `/devtools`: Interactive UI
- `/devtools/metadata`: App metadata JSON
- `/devtools/logs`: Last 10,000 logs
- Action inspector
- Queue inspector
- Scheduler inspector
- Topic inspector
- Bucket inspector
- Cache inspector
- Provider dependency graph

---

## Batch Processing Features (15)

### Core Batch Features
- `$batch`: Define batch processing with schema
- Schema validation on each item
- Max size (auto-flush when batch is full)
- Max duration (auto-flush after timeout)
- Partition by key (group items separately)
- Concurrency control (parallel handlers)
- Retry with backoff on failure

### Item Management
- `push()`: Add item, get ID immediately
- `wait()`: Wait for item result
- `status()`: Check pending/processing/completed/failed
- `flush()`: Manual flush (all or by partition)
- `clearCompleted()`: Free memory from done items

### Lifecycle Integration
- Startup buffering (items queued until app ready)
- Graceful shutdown (flush all on stop)
- Ready hook triggers initial processing

---

## CLI Run/Ask Features (14)

### Task Runner (Pretty Output)
- `run()`: Execute tasks with animated spinners
- Parallel task execution (arrays)
- Task timing (shows duration for each)
- Command header/footer with total time
- CI detection (disables dynamic output)
- `run.rm()`: Remove files with glob support
- `run.cp()`: Copy files/directories

### Interactive Prompts
- `ask()`: Prompt user with schema validation
- `ask.permission()`: Yes/no permission prompts
- Default value support (press Enter)
- Custom validation function
- Error retry loop (re-prompt on invalid)
- Schema types: text, number, boolean, enum

### Pretty Print
- Animated spinners (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
- Success tick (✓) with duration
- Error cross (✗)
- ANSI color support

---

## AI-First Development (10)

### CLI Integration
- `alepha init --agent`: Generate perfect CLAUDE.md
- `alepha init --react --agent`: Full React app + AI setup
- Standard skills agent for Claude Code [Beta]
- One prompt → full WordPress-like blog

### AI-Ready Documentation
- 20+ doc pages at alepha.dev
- All pages have .md files for AI consumption
- llms.txt for AI context
- Perfect context sizing for Claude

### AI Workflow
- MCP tools exposure for Claude/Cursor
- Type-safe actions = AI makes fewer mistakes
- Convention-driven = consistent AI output
- Primitives pattern = easy for AI to understand

---

## Docker & Kubernetes (12)

### Container Optimization
- Tiny Docker images (~100MB with Bun)
- Multi-stage builds
- Zero node_modules in production
- Fast cold starts

### Kubernetes Ready
- Graceful shutdown (properly tested)
- Health check endpoints
- Readiness/liveness probes
- Auto-scaling support

### Distributed Systems
- `$remote` for service discovery
- `$client` for inter-service calls
- Distributed `$lock` (Redis)
- Database migrations in containers

---

## OPS Admin System [Coming Soon] (8)

### Production Monitoring
- Real-time log viewer
- Queue monitoring dashboard
- Cache hit/miss metrics
- Job failure tracking

### Alerting
- Email alerts on errors
- Configurable thresholds
- Alert aggregation
- Webhook notifications

---

## CLI Commands (14)

- `alepha init`: Scaffold new project
- `alepha init --agent`: With AI integration (CLAUDE.md)
- `alepha build`: Production build
- `alepha dev`: Development server
- `alepha test`: Run tests
- `alepha lint`: Format and lint
- `alepha typecheck`: Type checking
- `alepha verify`: Full validation pipeline
- `alepha clean`: Remove build artifacts
- `alepha db`: Database migrations
- `alepha gen openapi`: Generate OpenAPI spec
- `alepha gen env`: Generate .env.example
- `alepha gen changelog`: Generate CHANGELOG
- `alepha gen resource`: Scaffold entity/repo/action

---

## Environment Detection (8)

- `isBrowser()`: Running in browser
- `isServerless()`: Running on Vercel/Cloudflare
- `isTest()`: Running in test environment
- `isProduction()`: NODE_ENV=production
- `isBun()`: Running on Bun runtime
- `isViteDev()`: Running in Vite dev server
- `isCI()`: Running in CI environment
- `isConfigured()`: App is configured

---

## Lifecycle Hooks (4)

- `configure`: Before start, process primitives
- `start`: Application startup
- `ready`: Application ready to serve
- `stop`: Graceful shutdown

---

## Event System (25)

### Core Events
- `configure`: Configuration phase
- `start`: Startup phase
- `ready`: Ready phase
- `stop`: Shutdown phase
- `state:mutate`: State changed
- `log`: Log emitted

### React Events
- `react:action:begin`: Action started
- `react:action:success`: Action succeeded
- `react:action:error`: Action failed
- `react:action:end`: Action completed
- `react:transition:begin`: Route transition started
- `react:transition:success`: Route transition succeeded
- `react:transition:error`: Route transition failed
- `react:transition:end`: Route transition completed

### Form Events
- `form:submit:begin`: Form submission started
- `form:submit:success`: Form submission succeeded
- `form:submit:error`: Form submission failed
- `form:submit:end`: Form submission completed
- `form:change`: Form field changed
- `form:reset`: Form reset

### HTTP Events
- `client:beforeFetch`: Before HTTP request
- `client:onError`: HTTP error occurred

### Entity Events
- `entity:create`: Record created
- `entity:update`: Record updated
- `entity:delete`: Record deleted

---

## WebSocket Features (8)

- Connection management
- Room/channel support
- Broadcast to all clients
- Broadcast to room
- Send to specific client
- Event-based messaging
- Binary message support
- Heartbeat/ping-pong

---

## Email Features (12)

### Core
- `$email`: Email primitive definition
- Template rendering with variables
- HTML email support
- Queue integration (async send)
- Event hooks (sending, sent, abort)

### Built-in Providers (One-Line Setup)
- `NodemailerEmailProvider`: SMTP (any provider)
- `TwilioEmailProvider`: Twilio SendGrid
- `BrevoEmailProvider`: Brevo (ex-Sendinblue)
- `ResendEmailProvider`: Resend API
- `MemoryEmailProvider`: Testing
- `LocalEmailProvider`: File output (dev)

---

## SMS Features (10)

### Core
- `$sms`: SMS primitive definition
- Template rendering with variables
- Queue integration (async send)
- Event hooks (sending, sent, abort)

### Built-in Providers (One-Line Setup)
- `TwilioSmsProvider`: Twilio
- `BrevoSmsProvider`: Brevo
- `MessageBirdProvider`: MessageBird
- `MemorySmsProvider`: Testing
- `LocalSmsProvider`: File output (dev)

---

## Testing Utilities (18)

- Automatic lifecycle management
- Service substitution for mocking
- Fake data generation from schema
- Memory storage backend
- Memory queue backend
- Memory cache backend
- Memory lock backend
- In-memory log capture
- Test database setup
- Browser test environment (jsdom)
- Vitest globals integration
- Automatic cleanup on test finish

### Time Control (No Flaky Tests)
- `pause()`: Stop time for deterministic tests
- `travel(duration)`: Jump forward in time
- `reset()`: Resume real time
- All timers/intervals respect time travel
- `wait()` with AbortSignal support
- `deadline()`: Run with timeout

---

## Error Types (25)

### Core Errors
- `AlephaError`: Base error class
- `AppNotStartedError`: App not started
- `CircularDependencyError`: DI circular reference
- `ContainerLockedError`: Container is locked
- `TooLateSubstitutionError`: Late substitution attempt
- `TypeBoxError`: Schema validation error

### HTTP Errors
- `BadRequestError`: 400
- `UnauthorizedError`: 401
- `ForbiddenError`: 403
- `NotFoundError`: 404
- `ConflictError`: 409
- `ValidationError`: 422
- `HttpError`: Generic HTTP error

### Domain Errors
- `FileNotFoundError`: File not in bucket
- `TopicTimeoutError`: Topic timeout
- `EmailError`: Email send failure
- `SmsError`: SMS send failure
- `RetryCancelError`: Retry cancelled
- `RetryTimeoutError`: Retry timeout
- `FormValidationError`: Form validation
- `CommandError`: CLI command error
- `SecurityError`: Security violation
- `InvalidCredentialsError`: Bad credentials
- `InvalidPermissionError`: Permission denied

### MCP Errors
- `McpError`: Base MCP error
- `McpInvalidRequestError`: Invalid request
- `McpMethodNotFoundError`: Method not found
- `McpInvalidParamsError`: Invalid parameters

---

## Microservices Features (20)

### Remote Service Discovery
- `$remote`: Define remote service connection
- Automatic action discovery from remote
- Service account authentication (M2M)
- Dynamic URL configuration via `$env`

### Communication
- Type-safe remote calls
- Proxy mode (expose remote actions locally)
- Internal-only mode (no client exposure)
- Request forwarding with headers

### Circuit Breaking [Beta]
- Automatic circuit breaker for remote calls
- Configurable failure threshold
- Half-open state for recovery
- Fallback handlers

### Modulith Architecture
- Build one app with N modules
- Run as monolith (single process)
- Run as microservices (N separate processes)
- Include/Exclude modules via `ALEPHA_MODULES` env
- Same codebase, flexible deployment
- Gradual migration path (mono → micro)

### Production Ready
- Used in production systems
- Service mesh compatible
- Health check propagation
- Error forwarding

---

## Integrations (6)

- Discord webhook integration
- Slack webhook integration
- Generic webhook support
- Topic-based notifications
- Event-driven webhooks
- Retry on webhook failure

---

## Static Site Generation (6)

- `alepha build --static`: Generate static HTML
- 100% static index.html per page
- Pre-rendered React components
- No runtime server required
- CDN-ready output
- Works with docs sites (like /apps/docs)

---

## Runtime Support (5)

- Node.js (>=22.0.0)
- Bun (native support)
- Cloudflare Workers
- Vercel Edge Functions
- Browser (client-side)

---

## Build Features (8)

- Zero node_modules in output
- Single-file bundle option
- Code splitting
- Tree shaking
- Source maps
- Declaration files (.d.ts)
- Asset compression
- Edge-compatible output

---

## Deployment Targets (12)

### Vercel
- `alepha build --vercel`: Generate Vercel output
- Serverless function entry point
- Static assets to CDN
- Vercel Blob storage integration
- Vercel Postgres integration
- Vercel Cron Jobs support

### Cloudflare
- `alepha build --cloudflare`: Generate Workers output
- Cloudflare D1 database (SQLite at edge)
- Cloudflare R2 storage (S3-compatible)
- Cloudflare KV caching
- Wrangler configuration generation
- Near-instant cold starts

### Docker
- Dockerfile generation
- Multi-stage builds
- Minimal image size

---

## Fake Data Generation (6)

- `FakeProvider`: Generate fake data from schema
- Context-aware generation (email → email, name → name)
- TypeBox schema integration
- Faker.js powered
- Database seeding support
- Test data generation

---

## Unique Features (32)

- **Keyless JSON Codec**: 50-56% smaller, 1.7-2x faster decode
- **Protobuf Codec**: Binary serialization with TypeBox schemas
- **Service Substitution**: Replace ANY class at runtime (enterprise pattern)
- **Multi-runtime drivers**: Same code on Node/Bun/Cloudflare
- **Per-module log levels**: `LOG_LEVEL=db:trace,auth:warn,core.*:info`
- **MCP Integration**: Native AI tool exposure for Claude/Cursor
- **CLI Generators**: OpenAPI, env, changelog from code
- **Edge-ready builds**: No cold start, no node_modules
- **Pluggable codecs**: JSON, Keyless, Protobuf - switch at runtime
- **ALS-based context**: Request ID everywhere automatically
- **DevTools UI**: Inspect running app metadata
- **SSR Early Streaming**: Send JS before loaders run (Cloudflare fast)
- **Vite SSR Manifest**: Automatic chunk discovery for hydration
- **TypeForm**: Generate full form from schema in one line
- **DataTable**: Full admin table with filters, sort, pagination
- **i18n Lazy Loading**: Load only current language on browser
- **Fake Data from Schema**: Generate realistic test data from TypeBox
- **Multi-cloud Deploy**: Vercel, Cloudflare, Docker from same codebase
- **Time Travel Testing**: Pause, travel, reset clock - no flaky tests
- **$remote Auto-Discovery**: Discover all actions from remote services
- **Static Site Generation**: 100% static HTML output, CDN-ready
- **$atom Persistence**: Auto-persist state to cookie/localStorage/file
- **One-Line Providers**: SMS/Email setup in one line (Twilio, Brevo, etc.)
- **Durable Workflows**: Queue-based step execution with persistence
- **Batch Processing**: Group operations for efficiency with partitions
- **AI-First Init**: `alepha init --agent` generates perfect CLAUDE.md
- **One-Prompt Apps**: `alepha init --react --agent` + 1 prompt = full blog
- **Tiny Docker**: ~100MB with Bun, production-ready

---

## UI Component Kit (@alepha/ui) (38)

### Form Components
- `TypeForm`: Auto-generate form from schema (all field types)
- `Control`: Smart form control (auto-detects type)
- `ControlArray`: Array field with add/remove
- `ControlObject`: Nested object fields
- `ControlSelect`: Dropdown select
- `ControlDate`: Date/datetime picker
- `ControlNumber`: Number input with stepper
- `ControlQueryBuilder`: Visual query builder

### Table Components
- `DataTable`: Full-featured data table
- `DataTablePagination`: Pagination controls
- `DataTableToolbar`: Search, export, actions
- `DataTableFilters`: Column filters
- `ColumnPicker`: Show/hide columns
- `FilterPicker`: Filter configuration

### Layout Components
- `AdminShell`: Full admin layout (sidebar, header, content)
- `AppBar`: Top navigation bar
- `Sidebar`: Collapsible sidebar navigation
- `Omnibar`: Command palette (Cmd+K)
- `AlephaMantineProvider`: Mantine + Alepha integration

### Button Components
- `ActionButton`: Submit with loading state
- `ClipboardButton`: Copy to clipboard
- `DarkModeButton`: Toggle dark mode
- `ThemeButton`: Theme selector
- `LanguageButton`: Language switcher
- `ToggleSidebarButton`: Sidebar toggle
- `OmnibarButton`: Open command palette
- `BurgerButton`: Mobile menu toggle

### Auth Components
- `UserButton`: User avatar with dropdown menu
- `LoginForm`: Ready-to-use login form
- `RegisterForm`: Ready-to-use registration form
- `ResetPasswordForm`: Password reset form
- `VerifyEmailForm`: Email verification form

### Dialog Components
- `AlertDialog`: Alert messages
- `ConfirmDialog`: Confirmation prompts
- `PromptDialog`: Input prompts

### Data Components
- `ErrorViewer`: Error display with stack trace

---

## Total Count by Category

| Category | Count |
|----------|-------|
| Core Primitives | 18 |
| HTTP Primitives | 11 |
| Database Primitives | 5 |
| React Primitives | 5 |
| Background Primitives | 6 |
| Storage Primitives | 2 |
| MCP Primitives | 3 |
| CLI Primitives | 2 |
| React Hooks | 17 |
| State Management Features | 19 |
| SSR Streaming Features | 15 |
| i18n Features | 12 |
| Server Modules | 15 |
| ORM Features | 35 |
| Database Drivers | 7 |
| Storage Backends | 6 |
| Queue Features | 18 |
| Cache/Lock/Topic Backends | 6 |
| Type System | 30 |
| Codec System | 8 |
| Logger Features | 15 |
| Security Features | 35 |
| Durable Workflow Features | 10 |
| API Modules | 8 |
| MCP Features | 12 |
| Microservices Features | 20 |
| Integrations | 6 |
| Static Site Generation | 6 |
| DevTools Features | 10 |
| Batch Processing Features | 15 |
| CLI Run/Ask Features | 14 |
| AI-First Development | 10 |
| Docker & Kubernetes | 12 |
| OPS Admin System | 8 |
| CLI Commands | 14 |
| Environment Detection | 8 |
| Lifecycle Hooks | 4 |
| Event System | 25 |
| WebSocket Features | 8 |
| Email Features | 12 |
| SMS Features | 10 |
| Testing Utilities | 18 |
| Error Types | 25 |
| Runtime Support | 5 |
| Build Features | 8 |
| Deployment Targets | 12 |
| Fake Data Generation | 6 |
| UI Component Kit | 38 |
| Unique Features | 32 |
| **TOTAL** | **~482** |
