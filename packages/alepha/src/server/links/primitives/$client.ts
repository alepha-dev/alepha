import { $inject, KIND } from "alepha";

import {
  type ClientScope,
  type HttpVirtualClient,
  LinkProvider,
} from "../providers/LinkProvider.ts";

/**
 * Create a new client.
 */
export const $client = <T extends object>(
  scope?: ClientScope,
): HttpVirtualClient<T> => {
  return $inject(LinkProvider).client<T>(scope);
};

$client[KIND] = "$client";
