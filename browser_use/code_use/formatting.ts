/**
 * TypeScript implementation of code-use formatting
 * Converted from browser_use/code_use/formatting.py
 */

import type { BrowserStateSummary } from '../browser/views';
import type { BrowserSession } from '../browser/session';

/**
 * Format browser state summary for LLM consumption in code-use mode.
 *
 * @param state - Browser state summary from browser_session.get_browser_state_summary()
 * @param namespace - The code execution namespace (for showing available variables)
 * @param browser_session - Browser session for additional checks (jQuery, etc.)
 * @returns Formatted browser state text for LLM
 */
export async function format_browser_state_for_llm(
	state: BrowserStateSummary,
	namespace: Record<string, any>,
	browser_session: BrowserSession
): Promise<string> {
	if (!state.dom_state) {
		throw new Error('DOM state is required');
	}
	const dom_state = state.dom_state;

	// Use eval_representation (compact serializer for code agents)
	let dom_html = dom_state.eval_representation();
	if (dom_html === '') {
		dom_html = 'Empty DOM tree (you might have to wait for the page to load)';
	}

	// Format with URL and title header
	const lines: string[] = ['## Browser State'];
	lines.push(`**URL:** ${state.url}`);
	lines.push(`**Title:** ${state.title}`);
	lines.push('');

	// Add tabs info if multiple tabs exist
	if (state.tabs.length > 1) {
		lines.push('**Tabs:**');
		const current_target_candidates: string[] = [];
		// Find tabs that match current URL and title
		for (const tab of state.tabs) {
			if (tab.url === state.url && tab.title === state.title) {
				current_target_candidates.push(tab.target_id);
			}
		}
		const current_target_id = current_target_candidates.length === 1 ? current_target_candidates[0] : null;

		for (const tab of state.tabs) {
			const is_current = tab.target_id === current_target_id ? ' (current)' : '';
			lines.push(`  - Tab ${tab.target_id.slice(-4)}: ${tab.url} - ${tab.title.slice(0, 30)}${is_current}`);
		}
		lines.push('');
	}

	// Add page scroll info if available
	if (state.page_info) {
		const pi = state.page_info;
		const pages_above = pi.viewport_height > 0 ? pi.pixels_above / pi.viewport_height : 0;
		const pages_below = pi.viewport_height > 0 ? pi.pixels_below / pi.viewport_height : 0;
		const total_pages = pi.viewport_height > 0 ? pi.page_height / pi.viewport_height : 0;

		let scroll_info = `**Page:** ${pages_above.toFixed(1)} pages above, ${pages_below.toFixed(1)} pages below`;
		if (total_pages > 1.2) {
			// Only mention total if significantly > 1 page
			scroll_info += `, ${total_pages.toFixed(1)} total pages`;
		}
		lines.push(scroll_info);
		lines.push('');
	}

	// Add network loading info if there are pending requests
	if (state.pending_network_requests && state.pending_network_requests.length > 0) {
		// Remove duplicates by URL (keep first occurrence with earliest duration)
		const seen_urls = new Set<string>();
		const unique_requests: typeof state.pending_network_requests = [];
		for (const req of state.pending_network_requests) {
			if (!seen_urls.has(req.url)) {
				seen_urls.add(req.url);
				unique_requests.push(req);
			}
		}

		lines.push(`**⏳ Loading:** ${unique_requests.length} network requests still loading`);
		// Show up to 20 unique requests with truncated URLs (30 chars max)
		for (const req of unique_requests.slice(0, 20)) {
			const duration_sec = req.loading_duration_ms / 1000;
			const url_display = req.url.length <= 30 ? req.url : req.url.slice(0, 27) + '...';
			lines.push(`  - [${duration_sec.toFixed(1)}s] ${url_display}`);
		}
		if (unique_requests.length > 20) {
			lines.push(`  - ... and ${unique_requests.length - 20} more`);
		}
		lines.push('**Tip:** Content may still be loading. Consider waiting with `await asyncio.sleep(1)` if data is missing.');
		lines.push('');
	}

	// Add available variables and functions BEFORE DOM structure
	// Show useful utilities (json, asyncio, etc.) and user-defined vars, but hide system objects
	const skip_vars = new Set([
		'browser',
		'file_system', // System objects
		'np',
		'pd',
		'plt',
		'numpy',
		'pandas',
		'matplotlib',
		'requests',
		'BeautifulSoup',
		'bs4',
		'pypdf',
		'PdfReader',
		'wait',
	]);

	// Highlight code block variables separately from regular variables
	const code_block_vars: string[] = [];
	const regular_vars: string[] = [];
	const tracked_code_blocks = (namespace['_code_block_vars'] as Set<string>) || new Set<string>();
	for (const name of Object.keys(namespace)) {
		// Skip private vars and system objects/actions
		if (!name.startsWith('_') && !skip_vars.has(name)) {
			if (tracked_code_blocks.has(name)) {
				code_block_vars.push(name);
			} else {
				regular_vars.push(name);
			}
		}
	}

	// Sort for consistent display
	const available_vars_sorted = regular_vars.sort();
	const code_block_vars_sorted = code_block_vars.sort();

	// Build available line with code blocks and variables
	const parts: string[] = [];
	if (code_block_vars_sorted.length > 0) {
		// Show detailed info for code block variables
		const code_block_details: string[] = [];
		for (const var_name of code_block_vars_sorted) {
			const value = namespace[var_name];
			if (value !== null && value !== undefined) {
				const type_name = typeof value === 'object' && value !== null ? value.constructor?.name || 'object' : typeof value;
				const value_str = typeof value === 'string' ? value : String(value);

				// Check if it's a function (starts with "(function" or "(async function")
				const is_function = value_str.trim().startsWith('(function') || value_str.trim().startsWith('(async function');

				if (is_function) {
					// For functions, only show name and type
					code_block_details.push(`${var_name}(${type_name})`);
				} else {
					// For non-functions, show first and last 20 chars
					const first_20 = value_str.slice(0, 20).replace(/\n/g, '\\n').replace(/\t/g, '\\t');
					const last_20 = value_str.length > 20 ? value_str.slice(-20).replace(/\n/g, '\\n').replace(/\t/g, '\\t') : '';

					if (last_20 && first_20 !== last_20) {
						code_block_details.push(`${var_name}(${type_name}): "${first_20}...${last_20}"`);
					} else {
						code_block_details.push(`${var_name}(${type_name}): "${first_20}"`);
					}
				}
			}
		}

		parts.push(`**Code block variables:** ${code_block_details.join(' | ')}`);
	}
	if (available_vars_sorted.length > 0) {
		parts.push(`**Variables:** ${available_vars_sorted.join(', ')}`);
	}

	lines.push(`**Available:** ${parts.join(' | ')}`);
	lines.push('');

	// Add DOM structure
	lines.push('**DOM Structure:**');

	// Add scroll position hints for DOM
	if (state.page_info) {
		const pi = state.page_info;
		const pages_above = pi.viewport_height > 0 ? pi.pixels_above / pi.viewport_height : 0;
		const pages_below = pi.viewport_height > 0 ? pi.pixels_below / pi.viewport_height : 0;

		if (pages_above > 0) {
			dom_html = `... ${pages_above.toFixed(1)} pages above \n${dom_html}`;
		} else {
			dom_html = '[Start of page]\n' + dom_html;
		}

		if (pages_below <= 0) {
			dom_html += '\n[End of page]';
		}
	}

	// Truncate DOM if too long and notify LLM
	const max_dom_length = 60000;
	if (dom_html.length > max_dom_length) {
		lines.push(dom_html.slice(0, max_dom_length));
		lines.push(
			`\n[DOM truncated after ${max_dom_length} characters. Full page contains ${dom_html.length} characters total. Use evaluate to explore more.]`
		);
	} else {
		lines.push(dom_html);
	}

	const browser_state_text = lines.join('\n');
	return browser_state_text;
}
