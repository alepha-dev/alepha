export const routeMethods = [
  // list of supported http methods
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
] as const;

export type RouteMethod = (typeof routeMethods)[number];
