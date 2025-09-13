#!/usr/bin/env tsx

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Script to concatenate all markdown files from node_modules/.docs/
 * into a single llm.txt file for AI training/context
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOCS_DIR = join(__dirname, "../node_modules/.docs");
const OUTPUT_DIR = join(__dirname, "../dist/public");
const OUTPUT_FILE = join(OUTPUT_DIR, "llms.txt");

function getAllMarkdownFiles(dir: string): string[] {
	try {
		const files = readdirSync(dir);
		return files
			.filter((file) => extname(file) === ".md")
			.map((file) => join(dir, file))
			.sort(); // Sort for consistent order
	} catch (error) {
		console.error(`Error reading directory ${dir}:`, error);
		return [];
	}
}

function readMarkdownContent(filePath: string): string {
	try {
		const content = readFileSync(filePath, "utf-8");
		const relativePath = filePath.replace(`${DOCS_DIR}/`, "");

		// Add file header for context
		return `\n# ${relativePath}\n\n${content}\n\n---\n`;
	} catch (error) {
		console.error(`Error reading file ${filePath}:`, error);
		return "";
	}
}

function main() {
	console.log("🔍 Scanning for markdown files...");

	// Check if docs directory exists
	if (!existsSync(DOCS_DIR)) {
		console.error(`❌ Docs directory not found: ${DOCS_DIR}`);
		process.exit(1);
	}

	// Get all markdown files
	const markdownFiles = getAllMarkdownFiles(DOCS_DIR);

	if (markdownFiles.length === 0) {
		console.warn("⚠️  No markdown files found");
		return;
	}

	console.log(`📄 Found ${markdownFiles.length} markdown files`);

	// Create output directory if it doesn't exist
	if (!existsSync(OUTPUT_DIR)) {
		mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// Concatenate all markdown content
	let concatenatedContent = `# Alepha Framework Documentation\n\nThis file contains all documentation for the Alepha framework, concatenated for LLM context.\n\nGenerated on: ${new Date().toISOString()}\n\n---\n`;

	for (const filePath of markdownFiles) {
		console.log(`📖 Reading: ${filePath.replace(`${DOCS_DIR}/`, "")}`);
		concatenatedContent += readMarkdownContent(filePath);
	}

	// Write the concatenated content
	try {
		writeFileSync(OUTPUT_FILE, concatenatedContent, "utf-8");
		console.log(`✅ Successfully created: ${OUTPUT_FILE}`);
		console.log(
			`📊 Total content length: ${concatenatedContent.length} characters`,
		);
		console.log(`📁 Files processed: ${markdownFiles.length}`);
	} catch (error) {
		console.error("❌ Error writing output file:", error);
		process.exit(1);
	}
}

main();
