export interface AdminJobsPayloadBodyProps {
  /**
   * The execution's payload, as stored. `undefined` for a cron tick, which
   * carries none.
   */
  payload: unknown;
}

/**
 * An execution's payload, pretty-printed. The body of the payload dialog and
 * of the execution drawer, so both print it the same way.
 */
export const AdminJobsPayloadBody = (props: AdminJobsPayloadBodyProps) => (
  <pre className="bg-muted max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed">
    {JSON.stringify(props.payload ?? null, null, 2)}
  </pre>
);
