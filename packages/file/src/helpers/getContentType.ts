/**
 * Can be used to get the content type of file based on its extension.
 *
 * Feel free to add more mime types in your project!
 */
export const mimeMap: Record<string, string> = {
	// Documents
	json: "application/json",
	txt: "text/plain",
	html: "text/html",
	htm: "text/html",
	xml: "application/xml",
	csv: "text/csv",
	pdf: "application/pdf",
	md: "text/markdown",
	markdown: "text/markdown",
	rtf: "application/rtf",

	// Styles and scripts
	css: "text/css",
	js: "application/javascript",
	mjs: "application/javascript",
	ts: "application/typescript",
	jsx: "text/jsx",
	tsx: "text/tsx",

	// Archives
	zip: "application/zip",
	rar: "application/vnd.rar",
	"7z": "application/x-7z-compressed",
	tar: "application/x-tar",
	gz: "application/gzip",
	tgz: "application/gzip",

	// Images
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	ico: "image/x-icon",
	tiff: "image/tiff",
	tif: "image/tiff",

	// Audio
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
	aac: "audio/aac",
	flac: "audio/flac",

	// Video
	mp4: "video/mp4",
	webm: "video/webm",
	avi: "video/x-msvideo",
	mov: "video/quicktime",
	wmv: "video/x-ms-wmv",
	flv: "video/x-flv",
	mkv: "video/x-matroska",

	// Office
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

	// Fonts
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	eot: "application/vnd.ms-fontobject",
};

/**
 * Returns the content type of file based on its filename.
 * @see {mimeMap}
 */
export const getContentType = (filename: string): string => {
	const ext = filename.toLowerCase().split(".").pop() || "";
	return mimeMap[ext] || "application/octet-stream";
};
