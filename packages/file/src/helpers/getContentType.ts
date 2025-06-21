/**
 * Returns the content type based on the file extension.
 * Supports a wide range of common file types used in web applications.
 */
export const getContentType = (filename: string): string => {
	// Document types
	if (filename.endsWith(".json")) return "application/json";
	if (filename.endsWith(".txt")) return "text/plain";
	if (filename.endsWith(".html") || filename.endsWith(".htm"))
		return "text/html";
	if (filename.endsWith(".xml")) return "application/xml";
	if (filename.endsWith(".csv")) return "text/csv";
	if (filename.endsWith(".pdf")) return "application/pdf";
	if (filename.endsWith(".md") || filename.endsWith(".markdown"))
		return "text/markdown";
	if (filename.endsWith(".rtf")) return "application/rtf";

	// Stylesheet and scripts
	if (filename.endsWith(".css")) return "text/css";
	if (filename.endsWith(".js") || filename.endsWith(".mjs"))
		return "application/javascript";
	if (filename.endsWith(".ts")) return "application/typescript";
	if (filename.endsWith(".jsx")) return "text/jsx";
	if (filename.endsWith(".tsx")) return "text/tsx";

	// Archive formats
	if (filename.endsWith(".zip")) return "application/zip";
	if (filename.endsWith(".rar")) return "application/vnd.rar";
	if (filename.endsWith(".7z")) return "application/x-7z-compressed";
	if (filename.endsWith(".tar")) return "application/x-tar";
	if (
		filename.endsWith(".gz") ||
		filename.endsWith(".tar.gz") ||
		filename.endsWith(".tgz")
	)
		return "application/gzip";

	// Image formats
	if (filename.endsWith(".png")) return "image/png";
	if (filename.endsWith(".jpg") || filename.endsWith(".jpeg"))
		return "image/jpeg";
	if (filename.endsWith(".gif")) return "image/gif";
	if (filename.endsWith(".webp")) return "image/webp";
	if (filename.endsWith(".svg")) return "image/svg+xml";
	if (filename.endsWith(".bmp")) return "image/bmp";
	if (filename.endsWith(".ico")) return "image/x-icon";
	if (filename.endsWith(".tiff") || filename.endsWith(".tif"))
		return "image/tiff";

	// Audio formats
	if (filename.endsWith(".mp3")) return "audio/mpeg";
	if (filename.endsWith(".wav")) return "audio/wav";
	if (filename.endsWith(".ogg")) return "audio/ogg";
	if (filename.endsWith(".m4a")) return "audio/mp4";
	if (filename.endsWith(".aac")) return "audio/aac";
	if (filename.endsWith(".flac")) return "audio/flac";

	// Video formats
	if (filename.endsWith(".mp4")) return "video/mp4";
	if (filename.endsWith(".webm")) return "video/webm";
	if (filename.endsWith(".avi")) return "video/x-msvideo";
	if (filename.endsWith(".mov")) return "video/quicktime";
	if (filename.endsWith(".wmv")) return "video/x-ms-wmv";
	if (filename.endsWith(".flv")) return "video/x-flv";
	if (filename.endsWith(".mkv")) return "video/x-matroska";

	// Office documents
	if (filename.endsWith(".doc")) return "application/msword";
	if (filename.endsWith(".docx"))
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	if (filename.endsWith(".xls")) return "application/vnd.ms-excel";
	if (filename.endsWith(".xlsx"))
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
	if (filename.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
	if (filename.endsWith(".pptx"))
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation";

	// Font formats
	if (filename.endsWith(".woff")) return "font/woff";
	if (filename.endsWith(".woff2")) return "font/woff2";
	if (filename.endsWith(".ttf")) return "font/ttf";
	if (filename.endsWith(".otf")) return "font/otf";
	if (filename.endsWith(".eot")) return "application/vnd.ms-fontobject";

	return "application/octet-stream";
};
