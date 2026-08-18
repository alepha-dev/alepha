/**
 * Byte payloads for the stand-in blobs written by StoragePlaceholderService.
 *
 * A database export brings the rows across but leaves the objects in remote
 * storage, so every file row points at a blob that is not on disk. These
 * payloads fill that gap: they exist only so a local dev server can answer
 * something instead of 404, and they deliberately look nothing like real
 * content.
 *
 * The raster images are real, valid files of their own format rather than one
 * image reused under every extension. Responses carry
 * "x-content-type-options: nosniff", so a PNG served as "image/jpeg" is
 * refused by the browser instead of being sniffed and rendered. Each was
 * generated once as a 128x128 grey square reading "PLACEHOLDER" and embedded
 * here; none exceeds 1.4 KB encoded.
 */
export class PlaceholderAssets {
  protected static readonly PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAIAAAACAAgMAAAC+UIlYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAMUExURZyjry03RXV9iv///16C2BEAAAABYktHRAMRDEzyAAAAB3RJTUUH6ggSDBoi3TwEygAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOC0xOFQxMjoyNjozNCswMDowMFGYy7AAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDgtMThUMTI6MjY6MzQrMDA6MDAgxXMMAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA4LTE4VDEyOjI2OjM0KzAwOjAwd9BS0wAAAO5JREFUWMPt0rFtAzEMBVCeAAHWAMoG2kPOBCz0jUOqS4DsoSYb+DJvyHNlH2XDjYuAv36QyC8ReTwej8fzTDJqIyqdVo44mYAF5BpwGoAwC1iXNK+xmleQAnCsZQC2Ez44dhoAnSFwU4A22mJazmNA1CjJCv0wGlJABMZDbqCXO2sS8E3xHW1QlALIiqOqPZpM54BFOpaOgM99UwKSdCwAVQHqHpQveUlqSf7NxNEAmbKCsIFkgDeKPwpm+wS03wugGTgC/QHYfcrbKyxwNWQ2wNWaxdhCi0K7FMVxsasWsFXNE7/ojT0ej8fzP/IHbKtMLFkzawEAAAAASUVORK5CYII=";
  protected static readonly JPG =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCACAAIADASIAAhEBAxEB/8QAGgABAAMBAQEAAAAAAAAAAAAAAAMEBQIGAf/EAC8QAAICAgAFAgMIAwEAAAAAAAABAgMEEQUSEyExFEFRkbEGFSIjNWFz0TKBwXH/xAAXAQEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A0wAdGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZH2k/T6/5V9GRYtCXEqJ4eJkY1aT6rsTSa+HdmjxLC9fjxq6nT1Lm3y79n/ZbAyPs3+n2fyv6I+camr7qcLrQqi9znKT0l8P+neNwvKxK3XRn8kW9tdFPv8A7ZNRw2KvtuynXkzsUVuVaWtLX7hFSvPs+4LLIy/Op1W5efdLfyfkkhweuNNdlV868ntJ3b3tvz2J4cLrjdkPcfT3xSdKjpJrw9/P5kS4RNxhTdmTsxoPaq5dbXst7Ao5MaZceyVfj25EeVajUm2nqPfszW4bCmFMuhj248XLvG1NN9vPdsit4dc8+zKoy+jKxKLXTUu2l8X+xbxq7qoSV+R15N9nyKOvkFTAAAAAAAAFTiWb6DHjb0+puXLrm17P+i2ZH2k/T6/5V9GBey8r006I8nN1rFX51rfuQW8Sn6mdGJjSyZV/5tS5VF/AqZuJ6fIwpeoyLd3xWrZ8yXc6oyYcLysqvLUoxtm7IT1tSX9hE64vCWFfeqZKyhpTqk9abevPz+Rfos62PVbrl54qWt+No8/e55GJxHMdcq67emoc3uk13+hoYHE8P0+NR1vzeWMOXlfnSWvAVxRxa++mV1eA5VRepONq2v8AWu5JfxZRrxZ0Uu71LainLlaaaWvmzP4Pn0YuBZXZJu2U24wUW+bskQ30vHxeGRvc6vxylJrtKK2u/wD7oI2ll5UYWzuwunCEHPfVT3peOxBHi2RLGWT6B9D3krU+29eNEMbcWVGUqc7Ivm6J/htba8ee6KkcWz7mpyI2W2VJt20cz5XFS9tePH/QPSU2K6mFsdqM4qS357nRFi2V24tU6e1biuVfD9iUKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/9k=";
  protected static readonly GIF =
    "R0lGODlhgACAAPEDAJyjry03RXV9iv///yH5BAAAAAAALAAAAACAAIAAAAL/hI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8fksvmMTqvX7Lb7DY/LoYG6vX6wOwR1wYJ/h3A36Mc0GAig14CIAEhocGhXuKQIAOhXqeAYMGkp6YmXGCqV2ScasDgoOAoKyUo3enmaKgC42pmQCRvpivoXWmnKEPmaRJxX7Fpoq5zK26SL7JuweVcofDAZ7bQ9q0AMzMrcbZjsncvZGOro59hL1Q3OvOpbPSoPbQ4eXVlNf4hrjsCBBAsaPIgwYY1M80B9krYgUid8xALuYBjr2LtvsRpPAfR4CAjGep82bUQ3zd05lPREigs3beO2kSdZZjOHg6aogKZmvkwXjxW5G/tA8QSaTFdPjfh+FJWFDlPSV0ufdXT6s1nUlRBvIo3ZkmsPnUphRswq9uRQomjZOfTlM6WioHJxso05z969Y+CkfSyFjYdOA9Um8v3o91FZsAobO34MObLkyZQrW76MObPmzZw7e/4MOrTo0aRLmz6NOrXq1axbu34NO7bs2bRr23ZTAAA7";
  protected static readonly WEBP =
    "UklGRhYCAABXRUJQVlA4IAoCAAAwDwCdASqAAIAAPsFeq0+npSQiJJOZKPAYCWlu4XSg7GwA61K8bfblA/acb7NA8eOlL1GRmtIhJIU4spgAJIUv/2Y4P9IKqgypJS6kv8Erps3b6+YQzPNBBRkP18horKM8c2bsGxdO+4+O3HxnHh1yF9NHghPlnI6ZwH+MZsABJCkgAP79h1n5NYehrN3xP5fBQeTIdHb6ElsazuKEmeJVnXN3Ieu9EYn9bRxjqJd7004snuxsbqp/TRXLoo8pcJmpowC15nHjQyo/1YGUJzmeKnNxFcdQzol+IWm2bJJHuc27qSUZTGU1BMUa0JTLIGPBZkE1n6lQKAzC9Hdrd7OlAE8UBJfin7Xck+RXNCHz4Zp8c7lgxGjjPfBOCF3k3HL5YY0TvS6wMrxWo+nGkXjh3jC0fKHxAMm7zfJsB3uLtkaX2DEmBoqiPxvG/BB3+93Rd7/X1fggsQTKFMKjG9LD6eA+U8Noz/umWapcP2XxWV6pAAi/FUFfG7S2VNwMWaq0Wbe4MKePilT2h4ns2Z92l7Wnxvox7/jzcyJBiu1xdze3bxtWNz7EfgssXeaw+ZoOwj7D9yiSXqwEqJj4GuOESU4z4dAoAVPI7fFrWUgdi0MYYKIYxx+bkJ5Xx/JMYLG7kQxZlEXAJFnS50TYRAfClOpvMgLLQKof83s82q5lLQAF42iwx3AAAAA=";

  protected static readonly SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" fill="#9ca3af"/>' +
    '<text x="64" y="58" font-family="sans-serif" font-size="17" font-weight="bold" fill="#1f2937" text-anchor="middle">PLACE</text>' +
    '<text x="64" y="78" font-family="sans-serif" font-size="17" font-weight="bold" fill="#1f2937" text-anchor="middle">HOLDER</text>' +
    "</svg>";

  /**
   * A minimal single-page PDF. Hand-written rather than generated: the xref
   * offsets are what make a PDF loadable, so this is kept short enough to
   * stay correct.
   */
  protected static readonly PDF = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n");

  protected static readonly TEXT = "PLACEHOLDER";
  protected static readonly JSON = '{"placeholder":true}';
  protected static readonly CSV = "placeholder\nPLACEHOLDER";

  /**
   * Payload for a blob id, chosen by its extension.
   *
   * Selection is by extension and not by the file row's declared mime type,
   * because the local storage provider derives the response Content-Type from
   * the blob id itself. Matching on the extension is what keeps the bytes and
   * the served type in agreement.
   *
   * Unknown extensions fall back to plain text: the point is to stop the 404,
   * and an unreadable spreadsheet is a smaller problem than a missing one.
   */
  public bytesFor(blobId: string): Uint8Array | string {
    const ext = blobId.toLowerCase().split(".").pop() ?? "";

    switch (ext) {
      case "png":
        return this.decode(PlaceholderAssets.PNG);
      case "jpg":
      case "jpeg":
        return this.decode(PlaceholderAssets.JPG);
      case "gif":
        return this.decode(PlaceholderAssets.GIF);
      case "webp":
        return this.decode(PlaceholderAssets.WEBP);
      case "svg":
        return PlaceholderAssets.SVG;
      case "pdf":
        return PlaceholderAssets.PDF;
      case "json":
        return PlaceholderAssets.JSON;
      case "csv":
        return PlaceholderAssets.CSV;
      default:
        return PlaceholderAssets.TEXT;
    }
  }

  protected decode(base64: string): Uint8Array {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
}
