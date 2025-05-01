export const createResponseFile = (
	buffer: ReadableStream | Buffer | NodeJS.ReadableStream,
	filename = "file.bin",
	contentType = "application/octet-stream",
): Response => {
	const response = new Response(buffer as BodyInit);

	response.headers.set(
		"Content-Type",
		contentType ?? "application/octet-stream",
	);

	response.headers.set(
		"Content-Disposition",
		`attachment; filename="${filename ?? "file.bin"}"`,
	);

	return response;
};
