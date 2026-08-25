/**
 * Helper for building server replies.
 */
export class ServerReply {
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
   * Drop a response header a previous pass had set.
   *
   * Needed by anything that decides a header rather than merely contributing
   * one: a later, stricter resolution must be able to take back what an
   * earlier, more permissive one wrote, and `setHeader` alone can only
   * overwrite with a value.
   */
  public removeHeader(name: string): this {
    delete this.headers[name.toLowerCase() as keyof typeof this.headers];
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
