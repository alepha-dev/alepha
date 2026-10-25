import { AlephaError } from "../errors/AlephaError.ts";

/**
 * Internal hook-name migration policy, retained through v1.
 * This is the single retired-name table used by runtime guards and checks.
 */
export class HookNamePolicy {
  public static readonly retired: Readonly<Record<string, string>> = {
    "server:onRequest": "server:request:before",
    "server:onSend": "server:response:before",
    "server:onResponse": "server:response:after",
    "server:onError": "server:request:error",
    "client:beforeFetch": "client:fetch:before",
    "client:onRequest": "client:request:before",
    "client:onError": "client:request:error",
    "action:onRequest": "action:request:before",
    "action:onResponse": "action:response:after",
    "files:beforeUpload": "files:upload:before",
    "email:sending": "email:send:before",
    "sms:sending": "sms:send:before",
    log: "log:entry",
    "cache:miss": "cache:missed",
    "cache:revalidate": "cache:revalidated",
    "cache:stale": "cache:staleServed",
    "capacitor:app:state": "capacitor:app:stateChanged",
    "capacitor:auth:signout": "capacitor:auth:signedOut",
    "cloudflare:queue": "cloudflare:queue:received",
    "commerce:capture:stray": "commerce:capture:strayDetected",
    "commerce:checkout:email": "commerce:checkout:emailCaptured",
    "commerce:checkout:paying": "commerce:checkout:paymentStarted",
    "form:change": "form:changed",
    "mcp:tool:end": "mcp:tool:call:end",
    "node:request": "node:request:before",
    "notification:delivery": "notification:delivery:reported",
    "rate-limit:consume:denied": "rateLimit:consume:denied",
    "react:browser:render": "react:browser:render:before",
    "react:recoverable:error": "react:render:recovered",
    "react:server:edge": "react:edge:configure:before",
    "react:server:shell": "react:shell:render:before",
    "serverless:cron": "serverless:cron:triggered",
    "state:mutate": "state:mutated",
    "state:register": "state:registered",
    "web:request": "web:request:before",
    "websocket:connect": "websocket:connected",
    "websocket:disconnect": "websocket:disconnected",
    "websocket:error": "websocket:error:reported",
    "websocket:message": "websocket:message:received",
  };

  protected static readonly lifecycle = new Set([
    "configure",
    "start",
    "ready",
    "stop",
  ]);
  protected static readonly phases = new Set([
    "before",
    "after",
    "begin",
    "success",
    "error",
    "end",
  ]);
  // The epic explicitly preserves this existing lifecycle/control family.
  protected static readonly jobLifecycle = new Set([
    "job:begin",
    "job:success",
    "job:error",
    "job:end",
    "job:cancel",
  ]);
  protected static readonly irregularFacts = new Set([
    "hit",
    "set",
    "sent",
    "paid",
    "reset",
  ]);

  public static assertCurrent(name: string): void {
    const replacement = Object.hasOwn(this.retired, name)
      ? this.retired[name]
      : undefined;
    if (replacement)
      throw new AlephaError(`Hook "${name}" was renamed to "${replacement}"`);
  }

  public static isValid(name: string): boolean {
    if (Object.hasOwn(this.retired, name)) return false;
    if (
      this.lifecycle.has(name) ||
      this.jobLifecycle.has(name) ||
      name === "log:entry"
    )
      return true;
    const parts = name.split(":");
    if (
      parts.length < 2 ||
      parts.length > 4 ||
      parts.some(
        (part) =>
          !/^[a-z][a-zA-Z0-9]*$/.test(part) || /^(?:on|before)[A-Z]/.test(part),
      )
    )
      return false;
    const last = parts[parts.length - 1]!;
    if (this.phases.has(last)) return parts.length >= 3;
    return (
      parts.length <= 3 &&
      (this.irregularFacts.has(last) ||
        /[a-z]ed(?:[A-Z][a-z0-9]*)*$/.test(last))
    );
  }
}
