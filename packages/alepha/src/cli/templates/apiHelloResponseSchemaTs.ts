export const apiHelloResponseSchemaTs = () => {
  return `import { type Static, t } from "alepha";

export const helloResponseSchema = t.object({
  appName: t.text(),
  serverTime: t.datetime(),
});

export type HelloResponse = Static<typeof helloResponseSchema>;
`.trim();
};
