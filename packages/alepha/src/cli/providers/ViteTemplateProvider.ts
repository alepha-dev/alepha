import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/file";
import type { AppEntry } from "./AppEntryProvider.ts";

export class ViteTemplateProvider {
  protected readonly fs = $inject(FileSystemProvider);

  public generateIndexHtml(entry: AppEntry): string {
    const style = entry.style;
    const browser = entry.browser ?? entry.server;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>App</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
${style ? `<link rel="stylesheet" href="/${style}" />` : ""}
</head>
<body>
<div id="root"></div>
<script type="module" src="/${browser}"></script>
</body>
</html>
`.trim();
  }
}
