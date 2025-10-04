import { del, head, put } from "@vercel/blob";

export class VercelBlobApi {
	put: typeof put = put;
	head: typeof head = head;
	del: typeof del = del;
}
