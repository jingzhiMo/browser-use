/**
 * TypeScript implementation of code-use utils
 * Converted from browser_use/code_use/utils.py
 */

/**
 * Truncate message content to max_length characters for history.
 */
export function truncate_message_content(content: string, max_length: number = 10000): string {
	if (content.length <= max_length) {
		return content;
	}
	// Truncate and add marker
	return content.slice(0, max_length) + `\n\n[... truncated ${content.length - max_length} characters for history]`;
}

/**
 * Detect if the LLM response hit token limits or is repetitive garbage.
 *
 * @returns [is_problematic, error_message]
 */
export function detect_token_limit_issue(
	completion: string,
	completion_tokens: number | null,
	max_tokens: number | null,
	stop_reason: string | null
): [boolean, string | null] {
	// Check 1: Stop reason indicates max_tokens
	if (stop_reason === 'max_tokens') {
		return [true, `Response terminated due to max_tokens limit (stop_reason: ${stop_reason})`];
	}

	// Check 2: Used 90%+ of max_tokens (if we have both values)
	if (completion_tokens !== null && max_tokens !== null && max_tokens > 0) {
		const usage_ratio = completion_tokens / max_tokens;
		if (usage_ratio >= 0.9) {
			return [true, `Response used ${(usage_ratio * 100).toFixed(1)}% of max_tokens (${completion_tokens}/${max_tokens})`];
		}
	}

	// Check 3: Last 6 characters repeat 40+ times (repetitive garbage)
	if (completion.length >= 6) {
		const last_6 = completion.slice(-6);
		const repetition_count = (completion.match(new RegExp(last_6.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
		if (repetition_count >= 40) {
			return [true, `Repetitive output detected: last 6 chars "${last_6}" appears ${repetition_count} times`];
		}
	}

	return [false, null];
}

/**
 * Extract URL from task string using naive pattern matching.
 */
export function extract_url_from_task(task: string): string | null {
	// Remove email addresses from task before looking for URLs
	const task_without_emails = task.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '');

	// Look for common URL patterns
	const patterns = [
		/https?:\/\/[^\s<>"']+/, // Full URLs with http/https
		/(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}(?:\/[^\s<>"']*)?/, // Domain names with subdomains and optional paths
	];

	const found_urls: string[] = [];
	for (const pattern of patterns) {
		const regex = new RegExp(pattern, 'g');
		let match;
		while ((match = regex.exec(task_without_emails)) !== null) {
			let url = match[0];

			// Remove trailing punctuation that's not part of URLs
			url = url.replace(/[.,;:!?()\[\]]+$/, '');
			// Add https:// if missing
			if (!url.startsWith('http://') && !url.startsWith('https://')) {
				url = 'https://' + url;
			}
			found_urls.push(url);
		}
	}

	const unique_urls = Array.from(new Set(found_urls));
	// If multiple URLs found, skip auto-navigation to avoid ambiguity
	if (unique_urls.length > 1) {
		return null;
	}

	// If exactly one URL found, return it
	if (unique_urls.length === 1) {
		return unique_urls[0];
	}

	return null;
}

/**
 * Extract all code blocks from markdown response.
 *
 * Supports:
 * - ```python, ```js, ```javascript, ```bash, ```markdown, ```md
 * - Named blocks: ```js variable_name → saved as 'variable_name' in namespace
 * - Nested blocks: Use 4+ backticks for outer block when inner content has 3 backticks
 *
 * @returns dict mapping block_name -> content
 *
 * Note: Python blocks are NO LONGER COMBINED. Each python block executes separately
 * to allow sequential execution with JS/bash blocks in between.
 */
export function extract_code_blocks(text: string): Record<string, string> {
	// Pattern to match code blocks with language identifier and optional variable name
	// Matches: ```lang\n or ```lang varname\n or ````+lang\n (4+ backticks for nested blocks)
	// Uses non-greedy matching and backreferences to match opening/closing backticks
	const pattern = /(`{3,})(\w+)(?:\s+(\w+))?\n(.*?)\1(?:\n|$)/gs;
	const matches = Array.from(text.matchAll(pattern));

	const blocks: Record<string, string> = {};
	let python_block_counter = 0;

	for (const match of matches) {
		const backticks = match[1];
		let lang = match[2].toLowerCase();
		const var_name = match[3];
		let content = match[4];

		// Normalize language names
		let lang_normalized: string;
		if (lang === 'javascript' || lang === 'js') {
			lang_normalized = 'js';
		} else if (lang === 'markdown' || lang === 'md') {
			lang_normalized = 'markdown';
		} else if (lang === 'sh' || lang === 'shell') {
			lang_normalized = 'bash';
		} else if (lang === 'python') {
			lang_normalized = 'python';
		} else {
			// Unknown language, skip
			continue;
		}

		// Only process supported types
		if (['python', 'js', 'bash', 'markdown'].includes(lang_normalized)) {
			content = content.replace(/\s+$/, ''); // Only strip trailing whitespace, preserve leading for indentation
			if (content) {
				// Determine the key to use
				if (var_name) {
					// Named block - use the variable name
					const block_key = var_name;
					blocks[block_key] = content;
				} else if (lang_normalized === 'python') {
					// Unnamed Python blocks - give each a unique key to preserve order
					const block_key = `python_${python_block_counter}`;
					blocks[block_key] = content;
					python_block_counter++;
				} else {
					// Other unnamed blocks (js, bash, markdown) - keep last one only
					blocks[lang_normalized] = content;
				}
			}
		}
	}

	// If we have multiple python blocks, mark the first one as 'python' for backward compat
	if (python_block_counter > 0) {
		blocks['python'] = blocks['python_0'];
	}

	// Fallback: if no python block but there's generic ``` block, treat as python
	if (python_block_counter === 0 && !('python' in blocks)) {
		const generic_pattern = /```\n(.*?)```/gs;
		const generic_matches = Array.from(text.matchAll(generic_pattern));
		if (generic_matches.length > 0) {
			const combined = generic_matches
				.map((m) => m[1].trim())
				.filter((m) => m)
				.join('\n\n');
			if (combined) {
				blocks['python'] = combined;
			}
		}
	}

	return blocks;
}
