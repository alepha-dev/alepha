import { Readable as NodeStream } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import { $inject, Alepha, isFileLike, isTypeFile, t } from "@alepha/core";
import { RouterProvider } from "@alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { errorNameByStatus, HttpError } from "../errors/HttpError.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import type { ServerReply } from "../helpers/ServerReply.ts";
import type {
  RequestConfigSchema,
  ResponseKind,
  ServerRequest,
  ServerRequestConfig,
  ServerRoute,
  ServerRouteMatcher,
} from "../interfaces/ServerRequest.ts";
import { ServerRequestParser } from "../services/ServerRequestParser.ts";
import { ServerTimingProvider } from "./ServerTimingProvider.ts";

/**
 * Main router for all routes on the server side.
 *
 * - $route => generic route
 * - $action => action route (for API calls)
 * - $page => React route (for SSR)
 */
export class ServerRouterProvider extends RouterProvider<ServerRouteMatcher> {
  protected readonly alepha = $inject(Alepha);
  protected readonly routes: ServerRoute[] = [];
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);
  protected readonly serverRequestParser = $inject(ServerRequestParser);

  public getRoutes(): ServerRoute[] {
    return this.routes;
  }

  public createRoute<TConfig extends RequestConfigSchema = RequestConfigSchema>(
    route: ServerRoute<TConfig>,
  ): void {
    route.method ??= "GET";
    route.method = route.method.toUpperCase() as RouteMethod;

    this.routes.push(route);

    const path = `/${route.method}/${route.path}`.replace(/\/+/g, "/");
    const responseKind = this.getResponseType(route.schema);

    this.push({
      path,
      handler: (rawRequest) => {
        const request =
          this.serverRequestParser.createServerRequest(rawRequest);

        return this.alepha.context.run(
          () => this.processRequest(request, route, responseKind),
          {
            context: rawRequest.headers["x-request-id"],
          },
        );
      },
    });
  }

  protected async processRequest(
    request: ServerRequest,
    route: ServerRoute,
    responseKind: ResponseKind,
  ) {
    await this.runRouteHandler(route, request, responseKind).catch((error) => {
      return this.errorHandler(route, request, error as Error);
    });

    await this.alepha.events.emit(
      "server:onSend",
      {
        request,
        route,
      },
      {
        catch: true, // avoid unhandled rejection
      },
    );

    // create response
    const response = {
      status: request.reply.status ?? (request.reply.body ? 200 : 204),
      headers: request.reply.headers,
      body: request.reply.body as any,
    };

    await this.alepha.events.emit(
      "server:onResponse",
      {
        request,
        route,
        response,
      },
      {
        catch: true, // avoid unhandled rejection
      },
    );

    return response;
  }

  protected async runRouteHandler(
    route: ServerRoute,
    request: ServerRequest,
    responseKind: ResponseKind,
  ) {
    // there are some built-in hooks that are called before the request is handled
    // - ServerBodyParserProvider (parse body)
    // - ServerSecurityProvider (build user from headers)
    // - ServerLoggerProvider (log request)

    await this.alepha.events.emit(
      "server:onRequest", // this hook will fill request.user and request.cookies
      {
        request,
        route,
      },
      {
        log: false,
      },
    );

    if (
      request.reply.body ||
      (request.reply.status && request.reply.status >= 200)
    ) {
      // if the body is already set, we can skip the handler
      // this is useful for middlewares that set the body
      return;
    }

    // request is ready to be used -> inject to context
    this.alepha.context.set<ServerRequest>("request", request as ServerRequest);

    // validate request
    this.serverTimingProvider.beginTiming("validateRequest");
    try {
      this.validateRequest(route, request);
    } finally {
      this.serverTimingProvider.endTiming("validateRequest");
    }

    // call the handler only if the body is not set yet
    this.serverTimingProvider.beginTiming("runHandler");
    try {
      const result = await route.handler(request);
      if (result) {
        request.reply.body = result;
      }
    } finally {
      this.serverTimingProvider.endTiming("runHandler");
    }

    // serialize response
    this.serverTimingProvider.beginTiming("serializeResponse");
    try {
      this.serializeResponse(route, request.reply, responseKind);
    } finally {
      this.serverTimingProvider.endTiming("serializeResponse");
    }
  }

  public serializeResponse(
    route: ServerRoute,
    reply: ServerReply,
    responseKind: ResponseKind,
  ): void {
    if (responseKind === "json" && route.schema?.response) {
      reply.headers["content-type"] = "application/json";
      reply.body = this.alepha.codec.encode(route.schema.response, reply.body, {
        as: "string",
      });
      return;
    }

    if (responseKind === "file") {
      if (!isFileLike(reply.body)) {
        throw new HttpError({
          status: 500,
          message: "Invalid response body - not a file",
        });
      }
      reply.headers["content-type"] = reply.body.type;
      reply.headers["content-disposition"] =
        `attachment; filename="${reply.body.name.replaceAll('"', "")}"`;
      reply.body = reply.body.stream();
      return;
    }

    if (responseKind === "text") {
      reply.body = String(reply.body);
      if (reply.body.startsWith("<!DOCTYPE html>")) {
        reply.headers["content-type"] ??= "text/html; charset=UTF-8";
      } else {
        reply.headers["content-type"] ??= "text/plain";
      }
      return;
    }

    if (reply.body == null || responseKind === "void") {
      delete reply.headers["content-type"];
      reply.body = undefined;
      return;
    }

    if (Buffer.isBuffer(reply.body)) {
      reply.headers["content-type"] ??= "application/octet-stream";
      return;
    }

    if (
      reply.body instanceof NodeWebStream ||
      reply.body instanceof NodeStream
    ) {
      // set content-type to application/octet-stream if not set
      reply.headers["content-type"] ??= "application/octet-stream";
      return;
    }

    reply.headers["content-type"] ??= "text/plain";
    reply.body = String(reply.body);
    return;
  }

  protected getResponseType(schema?: RequestConfigSchema): ResponseKind {
    if (schema?.response) {
      if (
        t.schema.isObject(schema.response) ||
        t.schema.isRecord(schema.response) ||
        t.schema.isArray(schema.response)
      ) {
        return "json";
      }

      if (
        t.schema.isString(schema.response) ||
        t.schema.isInteger(schema.response) ||
        t.schema.isNumber(schema.response) ||
        t.schema.isBoolean(schema.response)
      ) {
        return "text";
      }

      if (isTypeFile(schema.response)) {
        return "file";
      }

      if (t.schema.isVoid(schema.response)) {
        return "void";
      }
    }

    return "any";
  }

  protected async errorHandler(
    route: ServerRoute,
    request: ServerRequest,
    error: Error,
  ) {
    // reset body, which is probably invalid,
    // it can be filled by server:onError hook or by the default handler below
    request.reply.body = null;

    await this.alepha.events.emit(
      "server:onError",
      {
        request,
        route,
        error,
      },
      {
        log: false,
      },
    );

    if (!request.reply.body && !request.reply.status) {
      if (error instanceof HttpError) {
        request.reply.status = error.status;
        request.reply.headers["content-type"] = "application/json";
        request.reply.body = JSON.stringify({
          ...HttpError.toJSON(error),
          requestId: request.requestId,
        });
      } else {
        if (
          "status" in error &&
          typeof error.status === "number" &&
          !!errorNameByStatus[error.status]
        ) {
          request.reply.status = error.status;
          request.reply.headers["content-type"] = "application/json";
          request.reply.body = JSON.stringify({
            status: error.status,
            error: errorNameByStatus[error.status],
            message: (error as Error).message,
            requestId: request.requestId,
          });
          return;
        }

        request.reply.status = 500;
        request.reply.headers["content-type"] = "application/json";
        request.reply.body = JSON.stringify({
          status: 500,
          error: "InternalServerError",
          message: (error as Error).message,
          requestId: request.requestId,
        });
      }
    }
  }

  public validateRequest(
    route: { schema?: RequestConfigSchema },
    request: ServerRequestConfig,
  ) {
    if (route.schema?.params) {
      try {
        request.params = this.alepha.codec.decode(
          route.schema.params,
          request.params,
        ) as any;
      } catch (error) {
        throw new ValidationError("Invalid request params", error);
      }
    }

    if (route.schema?.query) {
      try {
        // we parse one by one to use the TypeBox coercion (e.g., number from string)
        const query: Record<string, any> = {};
        for (const key in route.schema.query.properties) {
          if (request.query[key] != null) {
            query[key] = this.alepha.codec.decode(
              route.schema.query.properties[key],
              request.query[key],
            );
          }
        }
        // then decode the full query to validate dependencies, etc.
        request.query = this.alepha.codec.decode(
          route.schema.query,
          query,
        ) as any;
      } catch (error) {
        throw new ValidationError("Invalid request query", error);
      }
    }

    if (route.schema?.headers) {
      try {
        request.headers = this.alepha.codec.decode(
          route.schema.headers,
          request.headers,
        ) as any;
      } catch (error) {
        throw new ValidationError("Invalid request header", error);
      }
    }

    if (route.schema?.body) {
      try {
        request.body = this.alepha.codec.decode(
          route.schema.body,
          request.body,
        );
      } catch (error) {
        throw new ValidationError("Invalid request body", error);
      }
    }
  }
}
