/**
 * Bounds and encoding for a browser-side downscale.
 */
export interface ResizeImageOptions {
  /**
   * Widest the result may be, in pixels.
   */
  maxWidth: number;

  /**
   * Tallest the result may be. Defaults to `maxWidth`.
   */
  maxHeight?: number;

  /**
   * Output MIME type. WebP by default: the browser's encoder is **lossy** and
   * keeps the alpha channel, which no wasm build available to the server can
   * do — a transparent logo at 128px is a few kilobytes here and roughly five
   * times that server-side.
   *
   * @default "image/webp"
   */
  type?: string;

  /**
   * Encoder quality, 0-1.
   *
   * @default 0.82
   */
  quality?: number;
}

/**
 * Downscales an image in the browser before it is uploaded.
 *
 * Worth doing even though the server enforces the same bounds: this is what
 * stops the megabytes leaving the machine at all. Production project icons
 * averaged 667 KB and reached the full 2 MB cap to fill a 32px box, so the
 * upload itself was the slow part of setting one.
 *
 * **Returns the input untouched** when it is not a raster image, when it
 * already fits, or when the browser lacks `OffscreenCanvas`/`createImageBitmap`
 * — including SVG, which has no pixels to resample and would be rasterised into
 * something worse than it started. So this is a best-effort downscale, not a
 * gate: the storage's `maxSize` is what bounds the pathological case.
 *
 * The browser is also the *better* encoder here, which is why the work belongs
 * on this side. `convertToBlob` produces lossy WebP with an alpha channel;
 * the wasm codecs available to an edge runtime offer lossless WebP (roughly
 * five times the bytes) or JPEG, which has no alpha at all and turns a
 * transparent logo's background black.
 */
export const resizeImage = async (
  file: File,
  options: ResizeImageOptions,
): Promise<File> => {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas !== "function"
  ) {
    return file;
  }

  const maxWidth = options.maxWidth;
  const maxHeight = options.maxHeight ?? options.maxWidth;
  const type = options.type ?? "image/webp";

  let bitmap: ImageBitmap | undefined;

  try {
    bitmap = await createImageBitmap(file);

    const scale = Math.min(
      1,
      maxWidth / bitmap.width,
      maxHeight / bitmap.height,
    );
    if (scale === 1) {
      return file;
    }

    // A dimension can round to 0 on an extreme aspect ratio, and a
    // zero-pixel canvas throws.
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({
      type,
      quality: options.quality ?? 0.82,
    });

    // A browser that does not support the requested encoder silently falls
    // back to PNG, which on a photo is bigger than the JPEG it came from.
    // Handing back the original is the honest outcome.
    if (blob.type !== type || blob.size >= file.size) {
      return file;
    }

    return new File([blob], renameFor(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } catch {
    // A corrupt or unsupported image must not cost the user their upload —
    // let the server have its say about the original.
    return file;
  } finally {
    bitmap?.close();
  }
};

/**
 * Swaps the extension so the name matches the bytes. A file still called
 * `.png` that is really WebP confuses everything downstream that trusts it.
 */
const renameFor = (name: string, type: string): string => {
  const extension = type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${extension}`;
};
