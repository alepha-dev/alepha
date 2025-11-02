import { $inject, Alepha } from "@alepha/core";
import type { Route } from "@alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type { ServerRawRequest } from "../interfaces/ServerRequest.ts";

export abstract class ServerProvider {
  protected readonly alepha = $inject(Alepha);

  public abstract get hostname(): string;

  protected isViteNotFound(
    url?: string,
    route?: Route,
    params?: Record<string, string>,
  ): boolean {
    if (this.alepha.isViteDev()) {
      if (!route) return true;
      url = url?.split("?")[0];
      if (!!params?.["*"] && `/${params?.["*"]}` === url) return true;
      if (url?.includes(".")) return true;
    }
    return false;
  }

  protected createRouterRequest(
    req: {
      method?: string;
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
    },
    params: Record<string, string> = {},
  ): ServerRawRequest {
    const headers = (req.headers ?? {}) as Record<string, string>;
    const url = new URL(
      `${this.getProtocol(headers)}://${headers.host}${req.url}`,
    );
    const query = Object.fromEntries(url.searchParams.entries());
    const method = (req.method?.toUpperCase() ?? "GET") as RouteMethod;

    return {
      method,
      url,
      headers,
      params,
      query,
      raw: {},
    };
  }

  protected getProtocol(headers: Record<string, string>): "http" | "https" {
    if (headers["x-forwarded-proto"] === "https") {
      return "https";
    }
    return "http";
  }
}
