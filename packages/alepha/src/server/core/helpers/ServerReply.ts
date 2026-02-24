/**
 * Helper for building server replies.
 */
export class ServerReply {
  // TODO: make it private
  public headers: Record<string, string> & {
    "set-cookie"?: string[];
  } = {};

  public status?: number; // default 200, or 204 (no content)

  public body?: any;

  /**
   * Redirect to a given URL with optional status code (default 302).
   */
  public redirect(url: string, status: number = 302): void {
    this.status = status;
    this.headers.location = url;
  }

  // TODO: check if status / header is already set and throw an error if so (for allow to override with force flag)

  /**
   * Set the response status code.
   */
  public setStatus(status: number): this {
    this.status = status;
    return this;
  }

  /**
   * Set a response header.
   */
  public setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  /**
   * Set the response body.
   */
  public setBody(body: any): this {
    this.body = body;
    return this;
  }
}
