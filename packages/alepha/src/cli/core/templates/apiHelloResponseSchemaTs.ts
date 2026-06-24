export const apiHelloResponseSchemaTs = () => {
  return `import { type Static, z } from "alepha";

export const helloResponseSchema = z.object({
  appName: z.text(),
  serverTime: z.datetime(),
});

export type HelloResponse = Static<typeof helloResponseSchema>;
`.trim();
};
