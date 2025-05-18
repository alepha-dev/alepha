export class HttpError extends Error {
	static toJSON(error: HttpError) {
		if (error.reason) {
			return {
				status: error.status,
				error: error.error,
				message: error.message,
				cause: error.reason,
			};
		}
		return {
			status: error.status,
			error: error.error,
			message: error.message,
		};
	}

	public readonly status: number;
	public readonly error?: string;
	public readonly reason?: {
		name: string;
		message: string;
	};

	constructor(
		options: {
			error?: string;
			message: string;
			status: number;
			cause?:
				| {
						name: string;
						message: string;
				  }
				| unknown;
		},
		cause?: unknown,
	) {
		super(options.message, {
			cause:
				cause ?? (options.cause instanceof Error ? options.cause : undefined),
		});

		this.status = options.status;

		if (options.cause instanceof Error) {
			this.reason = {
				name: options.cause.name,
				message: options.cause.message,
			};
		} else if (typeof options.cause === "object") {
			this.reason = {
				name: (options.cause as { name: string }).name,
				message: (options.cause as { message: string }).message,
			};
		}

		if (this.constructor.name === "HttpError") {
			this.error =
				options.error ?? errorNameByStatus[this.status] ?? "HttpError";
		} else {
			this.error = this.constructor.name;
		}
	}
}

export const errorNameByStatus: Record<number, string> = {
	400: "BadRequestError",
	401: "UnauthorizedError",
	403: "ForbiddenError",
	404: "NotFoundError",
	405: "MethodNotAllowedError",
	409: "ConflictError",
	410: "GoneError",
	413: "PayloadTooLargeError",
	415: "UnsupportedMediaTypeError",
	429: "TooManyRequestsError",
	500: "InternalServerError",
	501: "NotImplementedError",
	502: "BadGatewayError",
	503: "ServiceUnavailableError",
	504: "GatewayTimeoutError",
};
