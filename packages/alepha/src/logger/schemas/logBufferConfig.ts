import { $atom, type Infer, z } from "alepha";

export const logBufferConfig = $atom({
  name: "alepha.logger.buffer",
  description:
    "Per-context log buffer, used to attach breadcrumbs to errors and job failures.",
  schema: z.object({
    size: z
      .integer()
      .describe(
        "Max log entries retained per execution context. Set 0 to disable the buffer entirely.",
      ),
  }),
  default: {
    size: 50,
  },
});

export type LogBufferConfig = Infer<typeof logBufferConfig.schema>;
