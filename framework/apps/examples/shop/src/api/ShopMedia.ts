import { $inject, type FileLike } from "alepha";
import { $storage } from "alepha/api/files";
import { FileSystemProvider } from "alepha/system";

/**
 * Where the catalogue's imagery lives.
 *
 * Uses `alepha/api/files` rather than serving files from a route, so the images
 * behave like a real shop's: a row in the `files` table, a blob in whatever
 * storage the deployment configured (disk locally, R2 or S3 in production), and
 * a public URL at `/public/files/{id}` — all of which the framework already
 * provides. The product only stores the id.
 */
export class ShopMedia {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * SVG only, and small: these are line drawings, not photographs. Declaring
   * both means an upload of the wrong thing fails at the boundary instead of
   * reaching the catalogue.
   */
  public readonly pieces = $storage({
    name: "pieces",
    mimeTypes: ["image/svg+xml"],
    maxSize: 1,
  });

  /**
   * What digital products deliver. `ShopFileAccess` leaves this bucket closed:
   * the only way out is a download link on a paid order.
   */
  public readonly downloads = $storage({ name: "downloads", maxSize: 10 });

  /**
   * Store a digital product's file and return the id for its config.
   */
  public async storeDownload(name: string, text: string): Promise<string> {
    const stored = await this.downloads.upload(
      this.fs.createFile({ text, name, type: "text/plain" }),
    );
    return stored.id;
  }

  /**
   * Store a drawing and return the file id to put on the product.
   */
  public async storeDrawing(name: string, svg: string): Promise<string> {
    const file: FileLike = this.fs.createFile({
      text: svg,
      name: `${name}.svg`,
      type: "image/svg+xml",
    });
    const stored = await this.pieces.upload(file);
    return stored.id;
  }
}
