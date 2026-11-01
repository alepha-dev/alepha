import { $module } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";

import { AlephaCommerce } from "../index.ts";
import { OrderDownloadsProvider } from "../providers/OrderDownloadsProvider.ts";
import { DownloadController } from "./controllers/DownloadController.ts";
import { downloadConfig } from "./downloadConfigAtom.ts";
import { DownloadService } from "./services/DownloadService.ts";

export * from "./controllers/DownloadController.ts";
export * from "./downloadConfigAtom.ts";
export * from "./entities/downloads.ts";
export * from "./services/DownloadService.ts";

/**
 * Delivery of digital goods: a link per paid line, expiring and counted, in the
 * confirmation email and on the thank-you page.
 *
 * A `digital` product's `config.fileId` names a file in `alepha/api/files`, in a
 * storage no public route serves. Without this module a digital product still
 * sells, and the application delivers it itself.
 *
 * @module alepha.commerce.downloads
 */
export const AlephaCommerceDownloads = $module({
  name: "alepha.commerce.downloads",
  imports: [AlephaCommerce, AlephaApiFiles],
  atoms: [downloadConfig],
  services: [DownloadService, DownloadController],
  register: (alepha) => {
    alepha
      .inject(OrderDownloadsProvider)
      .add((orderId) => alepha.inject(DownloadService).linksFor(orderId));
  },
});
