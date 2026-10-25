export const apiHelloResponseSchemaTs = () => {
  return (
    `import { type Infer, z } from "alepha";

export const helloResponseSchema = z.object({
  appName: z.text(),
  serverTime: z.datetime(),
});

export type HelloResponse = Infer<typeof helloResponseSchema>;
`.trim() + "\n"
  );
};
