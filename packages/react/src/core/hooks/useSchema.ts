import type { Alepha } from "alepha";
import {
  type FetchOptions,
  HttpClient,
  type RequestConfigSchema,
} from "alepha/server";
import { LinkProvider, type VirtualAction } from "alepha/server/links";
import { useEffect, useState } from "react";
import { useAlepha } from "./useAlepha.ts";
import { useInject } from "./useInject.ts";

export const useSchema = <TConfig extends RequestConfigSchema>(
  action: VirtualAction<TConfig>,
): UseSchemaReturn<TConfig> => {
  const name = action.name;
  const alepha = useAlepha();
  const httpClient = useInject(HttpClient);
  const [schema, setSchema] = useState<UseSchemaReturn<TConfig>>(
    ssrSchemaLoading(alepha, name) as UseSchemaReturn<TConfig>,
  );

  useEffect(() => {
    if (!schema.loading) {
      return;
    }

    const opts: FetchOptions = {
      localCache: true,
    };

    httpClient
      .fetch(`${LinkProvider.path.apiLinks}/${name}/schema`, opts)
      .then((it) => setSchema(it.data as UseSchemaReturn<TConfig>));
  }, [name]);

  return schema;
};

export type UseSchemaReturn<TConfig extends RequestConfigSchema> = TConfig & {
  loading: boolean;
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Get an action schema during server-side rendering (SSR) or client-side rendering (CSR).
 */
export const ssrSchemaLoading = (alepha: Alepha, name: string) => {
  // server-side rendering (SSR) context
  if (!alepha.isBrowser()) {
    // get user links
    const linkProvider = alepha.inject(LinkProvider);

    // check if user can access the link
    const can = linkProvider
      .getServerLinks()
      .find((link) => link.name === name);

    // yes!
    if (can) {
      // user-links have no schema, so we need to get it from the provider
      const schema = linkProvider.links.find((it) => it.name === name)?.schema;

      // oh, we have a schema!
      if (schema) {
        // attach to user link, it will be used in the client during hydration
        can.schema = schema;
        return schema;
      }
    }

    return { loading: true };
  }

  // browser side rendering (CSR) context
  // check if we have the schema already loaded
  const schema = alepha
    .inject(LinkProvider)
    .links.find((it) => it.name === name)?.schema;

  // yes!
  if (schema) {
    return schema;
  }

  // no, we need to load it
  return { loading: true };
};
