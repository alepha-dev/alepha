import { $atom, type Infer, z } from "alepha";

export const downloadConfig = $atom({
  name: "alepha.commerce.downloads",
  description: "How digital goods are delivered.",
  schema: z.object({
    baseUrl: z
      .text()
      .describe(
        "The shop's public origin, e.g. `https://boutique.example`. Download links are sent by email, where nothing can resolve a relative one: set it wherever the confirmation email is on. Left empty, links are relative, which only a page of the shop can use.",
      ),
    linkTtlDays: z
      .integer()
      .min(1)
      .describe("Days a download link works, from when it is first issued."),
    maxDownloads: z
      .integer()
      .min(1)
      .describe("How many times one line may be downloaded."),
  }),
  default: {
    baseUrl: "",
    linkTtlDays: 30,
    maxDownloads: 5,
  },
  serverOnly: true,
});

export type DownloadConfig = Infer<typeof downloadConfig.schema>;

declare module "alepha" {
  interface State {
    [downloadConfig.key]: DownloadConfig;
  }
}
