/**
 * TypeScript implementation of prompts
 * Converted from browser_use/agent/prompts.py
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
	ContentPartImageParam,
	ContentPartTextParam,
	ImageURL,
	SystemMessage,
	UserMessage,
} from '../llm/messages';
import type { AgentStepInfo } from './views';
import type { BrowserStateSummary } from '../browser/views';
import type { FileSystem } from '../filesystem/file_system';

// Helper functions
function is_new_tab_page(url: string): boolean {
	/**Check if URL is a new tab page"""
	const new_tab_urls = [
		'about:blank',
		'chrome://newtab/',
		'edge://newtab/',
		'about:newtab',
	];
	return new_tab_urls.includes(url.toLowerCase());
}

function sanitize_surrogates(text: string): string {
	/**Remove surrogate pairs that can cause issues with some LLMs"""
	// Remove surrogate pairs (high and low surrogates)
	return text.replace(/[\uD800-\uDFFF]/g, '');
}

export class SystemPrompt {
	max_actions_per_step: number;
	use_thinking: boolean;
	flash_mode: boolean;
	is_anthropic: boolean;
	is_browser_use_model: boolean;
	prompt_template: string;
	system_message: SystemMessage;

	constructor(
		max_actions_per_step: number = 3,
		override_system_message: string | null = null,
		extend_system_message: string | null = null,
		use_thinking: boolean = true,
		flash_mode: boolean = false,
		is_anthropic: boolean = false,
		is_browser_use_model: boolean = false
	) {
		this.max_actions_per_step = max_actions_per_step;
		this.use_thinking = use_thinking;
		this.flash_mode = flash_mode;
		this.is_anthropic = is_anthropic;
		this.is_browser_use_model = is_browser_use_model;
		let prompt = '';
		if (override_system_message !== null) {
			prompt = override_system_message;
		} else {
			this._load_prompt_template();
			prompt = this.prompt_template.replace(
				'{max_actions}',
				String(this.max_actions_per_step)
			);
		}

		if (extend_system_message) {
			prompt += `\n${extend_system_message}`;
		}

		this.system_message = {
			role: 'system',
			content: prompt,
			cache: true,
		};
	}

	_load_prompt_template(): void {
		/**Load the prompt template from the markdown file.*/
		try {
			// Choose the appropriate template based on model type and mode
			// Browser-use models use simplified prompts optimized for fine-tuned models
			let template_filename: string;
			if (this.is_browser_use_model) {
				if (this.flash_mode) {
					template_filename = 'system_prompt_browser_use_flash.md';
				} else if (this.use_thinking) {
					template_filename = 'system_prompt_browser_use.md';
				} else {
					template_filename = 'system_prompt_browser_use_no_thinking.md';
				}
			} else if (this.flash_mode && this.is_anthropic) {
				template_filename = 'system_prompt_flash_anthropic.md';
			} else if (this.flash_mode) {
				template_filename = 'system_prompt_flash.md';
			} else if (this.use_thinking) {
				template_filename = 'system_prompt.md';
			} else {
				template_filename = 'system_prompt_no_thinking.md';
			}

			// Try to load from the system_prompts directory
			// This works both in development and when installed as a package
			const system_prompts_dir = path.join(
				__dirname,
				'system_prompts'
			);
			const template_path = path.join(system_prompts_dir, template_filename);

			if (fs.existsSync(template_path)) {
				this.prompt_template = fs.readFileSync(template_path, 'utf-8');
			} else {
				// Fallback: try to find it relative to the project root
				const project_root = path.resolve(__dirname, '../../..');
				const fallback_path = path.join(
					project_root,
					'browser_use',
					'agent',
					'system_prompts',
					template_filename
				);
				if (fs.existsSync(fallback_path)) {
					this.prompt_template = fs.readFileSync(fallback_path, 'utf-8');
				} else {
					throw new Error(
						`Failed to find system prompt template: ${template_filename}`
					);
				}
			}
		} catch (error) {
			throw new Error(
				`Failed to load system prompt template: ${error}`
			);
		}
	}

	get_system_message(): SystemMessage {
		/**
		 * Get the system prompt for the agent.
		 *
		 * Returns:
		 *     SystemMessage: Formatted system prompt
		 */
		return this.system_message;
	}
}

export class AgentMessagePrompt {
	vision_detail_level: 'auto' | 'low' | 'high';
	browser_state: BrowserStateSummary;
	file_system: FileSystem | null;
	agent_history_description: string | null;
	read_state_description: string | null;
	task: string | null;
	include_attributes: string[] | null;
	step_info: AgentStepInfo | null;
	page_filtered_actions: string | null;
	max_clickable_elements_length: number;
	sensitive_data: string | null;
	available_file_paths: string[] | null;
	screenshots: string[];
	include_recent_events: boolean;
	sample_images: (ContentPartTextParam | ContentPartImageParam)[];
	read_state_images: Array<Record<string, any>>;
	unavailable_skills_info: string | null;
	llm_screenshot_size: [number, number] | null;

	constructor(
		browser_state_summary: BrowserStateSummary,
		file_system: FileSystem,
		agent_history_description: string | null = null,
		read_state_description: string | null = null,
		task: string | null = null,
		include_attributes: string[] | null = null,
		step_info: AgentStepInfo | null = null,
		page_filtered_actions: string | null = null,
		max_clickable_elements_length: number = 40000,
		sensitive_data: string | null = null,
		available_file_paths: string[] | null = null,
		screenshots: string[] | null = null,
		vision_detail_level: 'auto' | 'low' | 'high' = 'auto',
		include_recent_events: boolean = false,
		sample_images: (ContentPartTextParam | ContentPartImageParam)[] | null = null,
		read_state_images: Array<Record<string, any>> | null = null,
		llm_screenshot_size: [number, number] | null = null,
		unavailable_skills_info: string | null = null
	) {
		this.browser_state = browser_state_summary;
		this.file_system = file_system;
		this.agent_history_description = agent_history_description;
		this.read_state_description = read_state_description;
		this.task = task;
		this.include_attributes = include_attributes;
		this.step_info = step_info;
		this.page_filtered_actions = page_filtered_actions;
		this.max_clickable_elements_length = max_clickable_elements_length;
		this.sensitive_data = sensitive_data;
		this.available_file_paths = available_file_paths;
		this.screenshots = screenshots || [];
		this.vision_detail_level = vision_detail_level;
		this.include_recent_events = include_recent_events;
		this.sample_images = sample_images || [];
		this.read_state_images = read_state_images || [];
		this.unavailable_skills_info = unavailable_skills_info;
		this.llm_screenshot_size = llm_screenshot_size;
		if (!this.browser_state) {
			throw new Error('browser_state_summary is required');
		}
	}

	_extract_page_statistics(): Record<string, number> {
		/**Extract high-level page statistics from DOM tree for LLM context*/
		const stats: Record<string, number> = {
			links: 0,
			iframes: 0,
			shadow_open: 0,
			shadow_closed: 0,
			scroll_containers: 0,
			images: 0,
			interactive_elements: 0,
			total_elements: 0,
		};

		if (
			!this.browser_state.dom_state ||
			!this.browser_state.dom_state._root
		) {
			return stats;
		}

		const traverse_node = (node: any): void => {
			/**Recursively traverse simplified DOM tree to count elements*/
			if (!node || !node.original_node) {
				return;
			}

			const original = node.original_node;
			stats.total_elements += 1;

			// Count by node type and tag
			// Note: NodeType enum needs to be imported or defined
			const ELEMENT_NODE = 1;
			const DOCUMENT_FRAGMENT_NODE = 11;

			if (original.node_type === ELEMENT_NODE) {
				const tag = original.tag_name
					? original.tag_name.toLowerCase()
					: '';

				if (tag === 'a') {
					stats.links += 1;
				} else if (tag === 'iframe' || tag === 'frame') {
					stats.iframes += 1;
				} else if (tag === 'img') {
					stats.images += 1;
				}

				// Check if scrollable
				if (original.is_actually_scrollable) {
					stats.scroll_containers += 1;
				}

				// Check if interactive
				if (node.is_interactive) {
					stats.interactive_elements += 1;
				}

				// Check if this element hosts shadow DOM
				if (node.is_shadow_host) {
					// Check if any shadow children are closed
					const has_closed_shadow = node.children.some(
						(child: any) =>
							child.original_node.node_type === DOCUMENT_FRAGMENT_NODE &&
							child.original_node.shadow_root_type &&
							child.original_node.shadow_root_type.toLowerCase() === 'closed'
					);
					if (has_closed_shadow) {
						stats.shadow_closed += 1;
					} else {
						stats.shadow_open += 1;
					}
				}
			} else if (original.node_type === DOCUMENT_FRAGMENT_NODE) {
				// Shadow DOM fragment - these are the actual shadow roots
				// But don't double-count since we count them at the host level above
				// pass
			}

			// Traverse children
			if (node.children) {
				for (const child of node.children) {
					traverse_node(child);
				}
			}
		};

		traverse_node(this.browser_state.dom_state._root);
		return stats;
	}

	// @observe_debug(ignore_input=True, ignore_output=True, name='_get_browser_state_description')
	_get_browser_state_description(): string {
		// Extract page statistics first
		const page_stats = this._extract_page_statistics();

		// Format statistics
		let stats_text = '<page_stats>';
		if (page_stats.total_elements < 10) {
			stats_text += 'Page appears empty (SPA not loaded?) - ';
		}
		stats_text += `${page_stats.links} links, ${page_stats.interactive_elements} interactive, `;
		stats_text += `${page_stats.iframes} iframes`;
		if (page_stats.shadow_open > 0 || page_stats.shadow_closed > 0) {
			stats_text += `, ${page_stats.shadow_open} shadow(open), ${page_stats.shadow_closed} shadow(closed)`;
		}
		if (page_stats.images > 0) {
			stats_text += `, ${page_stats.images} images`;
		}
		stats_text += `, ${page_stats.total_elements} total elements`;
		stats_text += '</page_stats>\n';

		let elements_text = this.browser_state.dom_state.llm_representation(
			this.include_attributes
		);

		let truncated_text = '';
		if (elements_text.length > this.max_clickable_elements_length) {
			elements_text = elements_text.substring(
				0,
				this.max_clickable_elements_length
			);
			truncated_text = ` (truncated to ${this.max_clickable_elements_length} characters)`;
		}

		let has_content_above = false;
		let has_content_below = false;
		// Enhanced page information for the model
		let page_info_text = '';
		if (this.browser_state.page_info) {
			const pi = this.browser_state.page_info;
			// Compute page statistics dynamically
			const pages_above =
				pi.viewport_height > 0
					? pi.pixels_above / pi.viewport_height
					: 0;
			const pages_below =
				pi.viewport_height > 0
					? pi.pixels_below / pi.viewport_height
					: 0;
			has_content_above = pages_above > 0;
			has_content_below = pages_below > 0;
			const total_pages =
				pi.viewport_height > 0 ? pi.page_height / pi.viewport_height : 0;
			const current_page_position =
				pi.scroll_y / Math.max(pi.page_height - pi.viewport_height, 1);
			page_info_text = '<page_info>';
			page_info_text += `${pages_above.toFixed(1)} above, `;
			page_info_text += `${pages_below.toFixed(1)} below `;

			page_info_text += '</page_info>\n';
			// , at ${current_page_position.toFixed(0)}% of page
		}
		if (elements_text !== '') {
			if (!has_content_above) {
				elements_text = `[Start of page]\n${elements_text}`;
			}
			if (!has_content_below) {
				elements_text = `${elements_text}\n[End of page]`;
			}
		} else {
			elements_text = 'empty page';
		}

		let tabs_text = '';
		const current_tab_candidates: string[] = [];

		// Find tabs that match both URL and title to identify current tab more reliably
		for (const tab of this.browser_state.tabs) {
			if (
				tab.url === this.browser_state.url &&
				tab.title === this.browser_state.title
			) {
				current_tab_candidates.push(tab.target_id);
			}
		}

		// If we have exactly one match, mark it as current
		// Otherwise, don't mark any tab as current to avoid confusion
		const current_target_id =
			current_tab_candidates.length === 1
				? current_tab_candidates[0]
				: null;

		for (const tab of this.browser_state.tabs) {
			tabs_text += `Tab ${tab.target_id.slice(-4)}: ${tab.url} - ${tab.title.substring(0, 30)}\n`;
		}

		const current_tab_text =
			current_target_id !== null
				? `Current tab: ${current_target_id.slice(-4)}`
				: '';

		// Check if current page is a PDF viewer and add appropriate message
		let pdf_message = '';
		if (this.browser_state.is_pdf_viewer) {
			pdf_message =
				'PDF viewer cannot be rendered. In this page, DO NOT use the extract action as PDF content cannot be rendered. ';
			pdf_message +=
				'Use the read_file action on the downloaded PDF in available_file_paths to read the full text content.\n\n';
		}

		// Add recent events if available and requested
		let recent_events_text = '';
		if (
			this.include_recent_events &&
			this.browser_state.recent_events
		) {
			recent_events_text = `Recent browser events: ${this.browser_state.recent_events}\n`;
		}

		// Add closed popup messages if any
		let closed_popups_text = '';
		if (this.browser_state.closed_popup_messages) {
			closed_popups_text = 'Auto-closed JavaScript dialogs:\n';
			for (const popup_msg of this.browser_state.closed_popup_messages) {
				closed_popups_text += `  - ${popup_msg}\n`;
			}
			closed_popups_text += '\n';
		}

		const browser_state = `${stats_text}${current_tab_text}
Available tabs:
${tabs_text}
${page_info_text}
${recent_events_text}${closed_popups_text}${pdf_message}Interactive elements${truncated_text}:
${elements_text}
`;
		return browser_state;
	}

	_get_agent_state_description(): string {
		let step_info_description = '';
		if (this.step_info) {
			step_info_description = `Step${this.step_info.step_number + 1} maximum:${this.step_info.max_steps}\n`;
		}

		const now = new Date();
		const time_str = now.toISOString().split('T')[0]; // YYYY-MM-DD format
		step_info_description += `Today:${time_str}`;

		let _todo_contents = this.file_system
			? this.file_system.get_todo_contents()
			: '';
		if (!_todo_contents || _todo_contents.length === 0) {
			_todo_contents = '[empty todo.md, fill it when applicable]';
		}

		let agent_state = `
<user_request>
${this.task}
</user_request>
<file_system>
${this.file_system ? this.file_system.describe() : 'No file system available'}
</file_system>
<todo_contents>
${_todo_contents}
</todo_contents>
`;
		if (this.sensitive_data) {
			agent_state += `<sensitive_data>${this.sensitive_data}</sensitive_data>\n`;
		}

		agent_state += `<step_info>${step_info_description}</step_info>\n`;
		if (this.available_file_paths) {
			const available_file_paths_text = this.available_file_paths.join('\n');
			agent_state += `<available_file_paths>${available_file_paths_text}\nUse with absolute paths</available_file_paths>\n`;
		}
		return agent_state;
	}

	_resize_screenshot(screenshot_b64: string): string {
		/**Resize screenshot to llm_screenshot_size if configured.*/
		if (!this.llm_screenshot_size) {
			return screenshot_b64;
		}

		try {
			// Note: In TypeScript, we would need an image processing library like 'sharp' or 'jimp'
			// For now, we'll return the original screenshot
			// TODO: Implement image resizing using a Node.js image library
			console.warn(
				'Screenshot resizing not yet implemented in TypeScript version. Using original screenshot.'
			);
			return screenshot_b64;
		} catch (error) {
			console.warn(
				`Failed to resize screenshot: ${error}, using original`
			);
			return screenshot_b64;
		}
	}

	// @observe_debug(ignore_input=True, ignore_output=True, name='get_user_message')
	get_user_message(use_vision: boolean = true): UserMessage {
		/**Get complete state as a single cached message*/
		// Don't pass screenshot to model if page is a new tab page, step is 0, and there's only one tab
		if (
			is_new_tab_page(this.browser_state.url) &&
			this.step_info !== null &&
			this.step_info.step_number === 0 &&
			this.browser_state.tabs.length === 1
		) {
			use_vision = false;
		}

		// Build complete state description
		let state_description =
			'<agent_history>\n' +
			(this.agent_history_description
				? this.agent_history_description.replace(/^\n+|\n+$/g, '')
				: '') +
			'\n</agent_history>\n\n';
		state_description +=
			'<agent_state>\n' +
			this._get_agent_state_description().replace(/^\n+|\n+$/g, '') +
			'\n</agent_state>\n';
		state_description +=
			'<browser_state>\n' +
			this._get_browser_state_description().replace(/^\n+|\n+$/g, '') +
			'\n</browser_state>\n';
		// Only add read_state if it has content
		const read_state_description = this.read_state_description
			? this.read_state_description.replace(/^\n+|\n+$/g, '').trim()
			: '';
		if (read_state_description) {
			state_description += `<read_state>\n${read_state_description}\n</read_state>\n`;
		}

		if (this.page_filtered_actions) {
			state_description += '<page_specific_actions>\n';
			state_description += this.page_filtered_actions + '\n';
			state_description += '</page_specific_actions>\n';
		}

		// Add unavailable skills information if any
		if (this.unavailable_skills_info) {
			state_description += '\n' + this.unavailable_skills_info + '\n';
		}

		// Sanitize surrogates from all text content
		state_description = sanitize_surrogates(state_description);

		// Check if we have images to include (from read_file action)
		const has_images = this.read_state_images.length > 0;

		if ((use_vision === true && this.screenshots.length > 0) || has_images) {
			// Start with text description
			const content_parts: (ContentPartTextParam | ContentPartImageParam)[] = [
				{ type: 'text', text: state_description },
			];

			// Add sample images
			content_parts.push(...this.sample_images);

			// Add screenshots with labels
			for (let i = 0; i < this.screenshots.length; i++) {
				const screenshot = this.screenshots[i];
				const label =
					i === this.screenshots.length - 1
						? 'Current screenshot:'
						: 'Previous screenshot:';

				// Add label as text content
				content_parts.push({ type: 'text', text: label });

				// Resize screenshot if llm_screenshot_size is configured
				const processed_screenshot = this._resize_screenshot(screenshot);

				// Add the screenshot
				content_parts.push({
					type: 'image_url',
					image_url: {
						url: `data:image/png;base64,${processed_screenshot}`,
						media_type: 'image/png',
						detail: this.vision_detail_level,
					},
				});
			}

			// Add read_state images (from read_file action) before screenshots
			for (const img_data of this.read_state_images) {
				const img_name = img_data['name'] || 'unknown';
				const img_base64 = img_data['data'] || '';

				if (!img_base64) {
					continue;
				}

				// Detect image format from name
				const media_type = img_name.toLowerCase().endsWith('.png')
					? 'image/png'
					: 'image/jpeg';

				// Add label
				content_parts.push({
					type: 'text',
					text: `Image from file: ${img_name}`,
				});

				// Add the image
				content_parts.push({
					type: 'image_url',
					image_url: {
						url: `data:${media_type};base64,${img_base64}`,
						media_type: media_type as 'image/png' | 'image/jpeg',
						detail: this.vision_detail_level,
					},
				});
			}

			return {
				role: 'user',
				content: content_parts,
				cache: true,
			};
		}

		return {
			role: 'user',
			content: state_description,
			cache: true,
		};
	}
}

export function get_rerun_summary_prompt(
	original_task: string,
	total_steps: number,
	success_count: number,
	error_count: number
): string {
	return `You are analyzing the completion of a rerun task. Based on the screenshot and execution info, provide a summary.

Original task: ${original_task}

Execution statistics:
- Total steps: ${total_steps}
- Successful steps: ${success_count}
- Failed steps: ${error_count}

Analyze the screenshot to determine:
1. Whether the task completed successfully
2. What the final state shows
3. Overall completion status (complete/partial/failed)

Respond with:
- summary: A clear, concise summary of what happened during the rerun
- success: Whether the task completed successfully (true/false)
- completion_status: One of "complete", "partial", or "failed"`;
}

export function get_rerun_summary_message(
	prompt: string,
	screenshot_b64: string | null = null
): UserMessage {
	/**
	 * Build a UserMessage for rerun summary generation.
	 *
	 * Args:
	 *     prompt: The prompt text
	 *     screenshot_b64: Optional base64-encoded screenshot
	 *
	 * Returns:
	 *     UserMessage with prompt and optional screenshot
	 */
	if (screenshot_b64) {
		// With screenshot: use multi-part content
		const content_parts: (ContentPartTextParam | ContentPartImageParam)[] = [
			{ type: 'text', text: prompt },
			{
				type: 'image_url',
				image_url: {
					url: `data:image/png;base64,${screenshot_b64}`,
				},
			},
		];
		return {
			role: 'user',
			content: content_parts,
		};
	} else {
		// Without screenshot: use simple string content
		return {
			role: 'user',
			content: prompt,
		};
	}
}

export function get_ai_step_system_prompt(): string {
	/**
	 * Get system prompt for AI step action used during rerun.
	 *
	 * Returns:
	 *     System prompt string for AI step
	 */
	return `You are an expert at extracting data from webpages.

<input>
You will be given:
1. A query describing what to extract
2. The markdown of the webpage (filtered to remove noise)
3. Optionally, a screenshot of the current page state
</input>

<instructions>
- Extract information from the webpage that is relevant to the query
- ONLY use the information available in the webpage - do not make up information
- If the information is not available, mention that clearly
- If the query asks for all items, list all of them
</instructions>

<output>
- Present ALL relevant information in a concise way
- Do not use conversational format - directly output the relevant information
- If information is unavailable, state that clearly
</output>`;
}

export function get_ai_step_user_prompt(
	query: string,
	stats_summary: string,
	content: string
): string {
	/**
	 * Build user prompt for AI step action.
	 *
	 * Args:
	 *     query: What to extract or analyze
	 *     stats_summary: Content statistics summary
	 *     content: Page markdown content
	 *
	 * Returns:
	 *     Formatted prompt string
	 */
	return `<query>
${query}
</query>

<content_stats>
${stats_summary}
</content_stats>

<webpage_content>
${content}
</webpage_content>`;
}
