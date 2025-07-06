export class ServerReply {
	public headers: Record<string, string> & {
		"set-cookie"?: string[];
	} = {};
	public status?: number; // default 200, or 204 (no content)
	public body?: any;

	public redirect(url: string, status: number = 302): void {
		this.status = status;
		this.headers.location = url;
	}

	public setStatus(status: number): void {
		this.status = status;
	}

	public setHeader(name: string, value: string): void {
		this.headers[name.toLowerCase()] = value;
	}
}
