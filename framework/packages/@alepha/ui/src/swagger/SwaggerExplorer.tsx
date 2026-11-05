import { AlephaError } from "alepha";
import { useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { OpenApiDocument } from "alepha/server/swagger";
import { ChevronRight, FileJson, KeyRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../core/Alert.tsx";
import { Badge } from "../core/Badge.tsx";
import { Skeleton } from "../core/Skeleton.tsx";
import { OpenApiSpec } from "./OpenApiSpec.ts";
import { SwaggerAccessBadge } from "./SwaggerAccessBadge.tsx";
import { SwaggerCredentials } from "./SwaggerCredentials.tsx";
import { SwaggerNav } from "./SwaggerNav.tsx";
import { SwaggerOperationView } from "./SwaggerOperationView.tsx";
import type { SwaggerRequest } from "./SwaggerRequestBuilder.ts";
import { SwaggerTryIt } from "./SwaggerTryIt.tsx";
import { useSwaggerAccess } from "./useSwaggerAccess.ts";

export interface SwaggerExplorerProps {
  /**
   * Where the OpenAPI document is served, `/docs/json` for a default
   * `$swagger()`.
   */
  specUrl: string;

  /**
   * Where to sign in, linked from a gated operation when nobody is signed
   * in. `/auth/login` is `AuthRouter`'s sign-in page.
   *
   * @default "/auth/login"
   */
  signIn?: string;
}

/**
 * The API explorer: the operations of an OpenAPI document by tag on the
 * left, the selected one in full on the right.
 *
 * The document is read in the browser, not by a page loader: on a Worker a
 * server render fetching its own origin is a self-subrequest, which fails.
 * The server render paints the frame and its skeleton. The selection follows
 * the URL hash (`#operationId`), so an operation can be linked to.
 *
 * Requests go out as the viewer: same-origin, the browser sends the session
 * cookie, which the server turns into the `Authorization` it checks. A token
 * typed in the credentials panel replaces it. Each gated operation says
 * whether the signed-in user may call it (`useSwaggerAccess`).
 */
export const SwaggerExplorer = (props: SwaggerExplorerProps) => {
  const { tr } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const [token, setToken] = useState("");

  const { data, error, loading } = useQuery(
    {
      key: ["swagger-spec", props.specUrl],
      // The platform `fetch`, not `HttpClient`: the document may live on
      // another origin, and nothing here is an Alepha action. (Under React
      // StrictMode, `HttpClient`'s in-flight dedup also joined the aborted
      // first run and never settled; see #Q3111.)
      handler: async ({ signal }) => {
        const res = await fetch(props.specUrl, {
          signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          throw new AlephaError(`HTTP ${res.status} ${res.statusText}`.trim());
        }
        return (await res.json()) as OpenApiDocument;
      },
      onError: () => {},
    },
    [props.specUrl],
  );

  const spec = useMemo(
    () => (data ? new OpenApiSpec(data) : undefined),
    [data],
  );

  useEffect(() => {
    const read = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (hash) setSelected(hash);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const select = (id: string) => {
    setSelected(id);
    window.history.replaceState(null, "", `#${encodeURIComponent(id)}`);
  };

  const entry = spec?.find(selected) ?? spec?.entries[0];
  const access = useSwaggerAccess(spec);
  const prepare = useCallback(
    (request: SwaggerRequest): SwaggerRequest =>
      token
        ? {
            ...request,
            headers: { ...request.headers, authorization: `Bearer ${token}` },
          }
        : request,
    [token],
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          {spec?.title ?? tr("swagger.title", { default: "API" })}
        </h1>
        {spec?.version && <Badge variant="outline">{spec.version}</Badge>}
        <a
          href={props.specUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs"
        >
          <FileJson className="size-3.5" />
          {tr("swagger.raw", { default: "OpenAPI JSON" })}
        </a>
        {spec?.description && (
          <p className="text-muted-foreground basis-full text-sm whitespace-pre-line">
            {spec.description}
          </p>
        )}
        <details className="group/credentials basis-full">
          <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 text-xs [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open/credentials:rotate-90" />
            <KeyRound className="size-3.5" />
            {token
              ? tr("swagger.credentials.set", {
                  default: "Calling with a token",
                })
              : tr("swagger.credentials.title", { default: "Credentials" })}
          </summary>
          <div className="pt-2 pl-5">
            <SwaggerCredentials onChange={setToken} />
          </div>
        </details>
      </header>

      {error && !spec ? (
        <Alert variant="destructive">
          <AlertTitle>
            {tr("swagger.error", {
              default: "The OpenAPI document could not be read",
            })}
          </AlertTitle>
          <AlertDescription>
            {props.specUrl}: {error.message}
          </AlertDescription>
        </Alert>
      ) : !spec || loading ? (
        <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-w-0 md:sticky md:top-4 md:flex md:max-h-[calc(100vh-2rem)] md:flex-col md:overflow-hidden">
            <SwaggerNav
              spec={spec}
              query={query}
              onQueryChange={setQuery}
              selected={entry?.id}
              onSelect={select}
            />
          </aside>
          <main className="min-w-0">
            {entry ? (
              <SwaggerOperationView
                spec={spec}
                entry={entry}
                badge={
                  <SwaggerAccessBadge
                    access={token ? "open" : access(entry)}
                    signIn={props.signIn ?? "/auth/login"}
                  />
                }
              >
                <SwaggerTryIt
                  key={entry.id}
                  spec={spec}
                  entry={entry}
                  prepare={prepare}
                />
              </SwaggerOperationView>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tr("swagger.emptyDocument", {
                  default: "This document has no operations.",
                })}
              </p>
            )}
          </main>
        </div>
      )}
    </div>
  );
};

export default SwaggerExplorer;
