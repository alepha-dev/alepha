import { IconFile } from "@tabler/icons-react";
import type { FileController } from "alepha/api/files";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminFileRouter {
  protected readonly fileCtrl = $client<FileController>();

  adminFiles = $page({
    icon: IconFile,
    path: "/files",
    label: "Files",
    description: "Manage uploaded files and storage.",
    head: { title: "Files" },
    can: () => this.fileCtrl.findFiles.can(),
    lazy: () => import("./components/AdminFiles.tsx"),
  });
}
