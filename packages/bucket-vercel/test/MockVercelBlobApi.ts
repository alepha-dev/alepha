import { vi } from "vitest";

export class MockVercelBlobApi {
  mockStorage = new Map<string, any>();

  put = vi.fn(async (pathname: string, body: any, options: any = {}) => {
    // Handle ReadableStream from file.stream()
    let data: Buffer;

    if (body && typeof body.getReader === "function") {
      // It's a Web ReadableStream
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine all chunks into a single buffer
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      data = Buffer.from(combined);
    } else if (body && body.constructor?.name === "Readable") {
      // It's a Node.js Readable stream
      const chunks: Buffer[] = [];

      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk));
      }

      data = Buffer.concat(chunks);
    } else if (Buffer.isBuffer(body)) {
      data = body;
    } else if (body instanceof ArrayBuffer) {
      data = Buffer.from(body);
    } else {
      data = Buffer.from(String(body));
    }

    const blob = {
      pathname,
      data,
      contentType: options.contentType || "application/octet-stream",
      size: data.length,
      uploadedAt: new Date(),
      url: `https://mock-blob.vercel-storage.com${pathname}`,
    };

    this.mockStorage.set(pathname, blob);

    return {
      url: blob.url,
      pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      contentType: blob.contentType,
    } as any;
  });

  head = vi.fn(async (pathname: string, options: any = {}) => {
    const blob = this.mockStorage.get(pathname);

    if (!blob) {
      return null;
    }

    return {
      url: blob.url,
      pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      contentType: blob.contentType,
    } as any;
  });

  del = vi.fn(async (pathname: string | string[], options: any = {}) => {
    const existed = this.mockStorage.delete(String(pathname));
    return { success: existed } as any;
  });
}
