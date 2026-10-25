/**
 * Where each inspector route lives: its method and path, by name.
 *
 * The route table spreads these into its routes, and the client reads them to
 * build a request, so a tool can call a run without instantiating the table
 * (which would start a log persister in the tool itself). Paths are relative
 * to the transport's base; `:name` segments are parameters.
 */
export const INSPECTOR_ENDPOINTS = {
  metadata: { method: "GET", path: "/metadata" },
  updateAtom: { method: "POST", path: "/atoms" },
  atomLog: { method: "GET", path: "/atoms/log" },
  logs: { method: "GET", path: "/logs" },
  emails: { method: "GET", path: "/emails" },
  sms: { method: "GET", path: "/sms" },
  jobs: { method: "GET", path: "/jobs" },
  jobExecution: { method: "GET", path: "/jobs/executions/:id" },
  jobExecutions: { method: "GET", path: "/jobs/:name/executions" },
  jobTrigger: { method: "POST", path: "/jobs/:name/trigger" },
  jobRetry: { method: "POST", path: "/jobs/executions/:id/retry" },
  dbList: { method: "GET", path: "/db/:entity/records" },
  dbCreate: { method: "POST", path: "/db/:entity/records" },
  dbUpdate: { method: "PUT", path: "/db/:entity/records/:id" },
  dbDelete: { method: "DELETE", path: "/db/:entity/records/:id" },
} as const;
