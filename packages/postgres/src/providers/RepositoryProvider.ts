import { $inject, Alepha } from "@alepha/core";
import {
  $repository,
  type RepositoryDescriptor,
} from "../descriptors/$repository.ts";
import type { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

export class RepositoryProvider {
  protected readonly alepha = $inject(Alepha);

  public getRepositories(provider?: DatabaseProvider) {
    const list: RepositoryDescriptor[] = [];

    for (const descriptor of this.alepha.descriptors($repository)) {
      if (!list.find((it) => it.table === descriptor.table)) {
        list.push(descriptor);
      }
    }

    if (provider) {
      return list.filter((repository) => repository.provider === provider);
    }

    return list;
  }
}
