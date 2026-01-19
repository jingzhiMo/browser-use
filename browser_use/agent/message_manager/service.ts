/**
 * TypeScript implementation of message manager service
 * Converted from browser_use/agent/message_manager/service.py
 */

import type {
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	SystemMessage,
} from '../../llm/messages';
import type { HistoryItem } from './views';
import type { AgentMessagePrompt } from '../prompts';
import type {
	ActionResult,
	AgentOutput,
	AgentStepInfo,
	MessageManagerState,
} from '../views';
import type { BrowserStateSummary } from '../../browser/views';
import type { FileSystem } from '../../filesystem/file_system';

// ========== Logging Helper Functions ==========
// These functions are used ONLY for formatting debug log output.
// They do NOT affect the actual message content sent to the LLM.
// All logging functions start with _log_ for easy identification.

function _log_get_message_emoji(message: BaseMessage): string {
	/**Get emoji for a message type - used only for logging display*/
	const emojiMap: Record<string, string> = {
		UserMessage: '💬',
		SystemMessage: '🧠',
		AssistantMessage: '🔨',
	};
	const className = message.constructor.name;
	return emojiMap[className] || '🎮';
}

function _log_format_message_line(
	message: BaseMessage,
	content: string,
	is_last_message: boolean,
	terminal_width: number
): string[] {
	/**Format a single message for logging display*/
	try {
		const lines: string[] = [];

		// Get emoji and token info
		const emoji = _log_get_message_emoji(message);
		// TODO: fix the token count
		const token_str = '??? (TODO)';
		const prefix = `${emoji}[${token_str}]: `;

		// Calculate available width (emoji=2 visual cols + [token]: =8 chars)
		const content_width = terminal_width - 10;

		// Handle last message wrapping
		if (is_last_message && content.length > content_width) {
			// Find a good break point
			const break_point = content.lastIndexOf(' ', content_width);
			if (break_point > content_width * 0.7) {
				// Keep at least 70% of line
				const first_line = content.substring(0, break_point);
				const rest = content.substring(break_point + 1);
				lines.push(prefix + first_line);

				// Second line with 10-space indent
				if (rest) {
					const truncated_rest =
						rest.length > terminal_width - 10
							? rest.substring(0, terminal_width - 10)
							: rest;
					lines.push(' '.repeat(10) + truncated_rest);
				}
			} else {
				// No good break point, just truncate
				const first_line = content.substring(0, content_width);
				const rest = content.substring(content_width);
				lines.push(prefix + first_line);
				if (rest) {
					const truncated_rest =
						rest.length > terminal_width - 10
							? rest.substring(0, terminal_width - 10)
							: rest;
					lines.push(' '.repeat(10) + truncated_rest);
				}
			}
		} else {
			// Single line - truncate if needed
			const truncated_content =
				content.length > content_width
					? content.substring(0, content_width)
					: content;
			lines.push(prefix + truncated_content);
		}

		return lines;
	} catch (error) {
		console.warn(`Failed to format message line for logging: ${error}`);
		// Return a simple fallback line
		return ['❓[   ?]: [Error formatting message]'];
	}
}

// ========== End of Logging Helper Functions ==========

export class MessageManager {
	vision_detail_level: 'auto' | 'low' | 'high';
	task: string;
	state: MessageManagerState;
	system_prompt: SystemMessage;
	file_system: FileSystem;
	sensitive_data_description: string;
	use_thinking: boolean;
	max_history_items: number | null;
	include_tool_call_examples: boolean;
	include_recent_events: boolean;
	sample_images: (ContentPartTextParam | ContentPartImageParam)[] | null;
	llm_screenshot_size: [number, number] | null;
	include_attributes: string[];
	sensitive_data: Record<string, string | Record<string, string>> | null;
	last_input_messages: BaseMessage[];
	last_state_message_text: string | null;

	constructor(
		task: string,
		system_message: SystemMessage,
		file_system: FileSystem,
		state: MessageManagerState,
		use_thinking: boolean = true,
		include_attributes: string[] | null = null,
		sensitive_data: Record<string, string | Record<string, string>> | null = null,
		max_history_items: number | null = null,
		vision_detail_level: 'auto' | 'low' | 'high' = 'auto',
		include_tool_call_examples: boolean = false,
		include_recent_events: boolean = false,
		sample_images: (ContentPartTextParam | ContentPartImageParam)[] | null = null,
		llm_screenshot_size: [number, number] | null = null
	) {
		this.task = task;
		this.state = state;
		this.system_prompt = system_message;
		this.file_system = file_system;
		this.sensitive_data_description = '';
		this.use_thinking = use_thinking;
		this.max_history_items = max_history_items;
		this.vision_detail_level = vision_detail_level;
		this.include_tool_call_examples = include_tool_call_examples;
		this.include_recent_events = include_recent_events;
		this.sample_images = sample_images;
		this.llm_screenshot_size = llm_screenshot_size;

		if (max_history_items !== null && max_history_items <= 5) {
			throw new Error('max_history_items must be None or greater than 5');
		}

		// Store settings as direct attributes instead of in a settings object
		this.include_attributes = include_attributes || [];
		this.sensitive_data = sensitive_data;
		this.last_input_messages = [];
		this.last_state_message_text = null;
		// Only initialize messages if state is empty
		if (this.state.history.get_messages().length === 0) {
			this._set_message_with_type(this.system_prompt, 'system');
		}
	}

	get agent_history_description(): string {
		/**Build agent history description from list of items, respecting max_history_items limit*/
		if (this.max_history_items === null) {
			// Include all items
			return this.state.agent_history_items.map((item) => item.to_string()).join('\n');
		}

		const total_items = this.state.agent_history_items.length;

		// If we have fewer items than the limit, just return all items
		if (total_items <= this.max_history_items) {
			return this.state.agent_history_items.map((item) => item.to_string()).join('\n');
		}

		// We have more items than the limit, so we need to omit some
		const omitted_count = total_items - this.max_history_items;

		// Show first item + omitted message + most recent (max_history_items - 1) items
		// The omitted message doesn't count against the limit, only real history items do
		const recent_items_count = this.max_history_items - 1; // -1 for first item

		const items_to_include: string[] = [
			this.state.agent_history_items[0].to_string(), // Keep first item (initialization)
			`<sys>[... ${omitted_count} previous steps omitted...]</sys>`,
		];
		// Add most recent items
		items_to_include.push(
			...this.state.agent_history_items
				.slice(-recent_items_count)
				.map((item) => item.to_string())
		);

		return items_to_include.join('\n');
	}

	add_new_task(new_task: string): void {
		const formatted_new_task =
			'<follow_up_user_request> ' + new_task.trim() + ' </follow_up_user_request>';
		if (!this.task.includes('<initial_user_request>')) {
			this.task = '<initial_user_request>' + this.task + '</initial_user_request>';
		}
		this.task += '\n' + formatted_new_task;
		const task_update_item: HistoryItem = {
			step_number: null,
			evaluation_previous_goal: null,
			memory: null,
			next_goal: null,
			action_results: null,
			error: null,
			system_message: formatted_new_task,
		};
		this.state.agent_history_items.push(task_update_item);
	}

	_update_agent_history_description(
		model_output: AgentOutput | null = null,
		result: ActionResult[] | null = null,
		step_info: AgentStepInfo | null = null
	): void {
		/**Update the agent history description*/

		if (result === null) {
			result = [];
		}
		const step_number = step_info ? step_info.step_number : null;

		this.state.read_state_description = '';
		this.state.read_state_images = []; // Clear images from previous step

		let action_results = '';
		const result_len = result.length;
		let read_state_idx = 0;

		for (const action_result of result) {
			if (
				action_result.include_extracted_content_only_once &&
				action_result.extracted_content
			) {
				this.state.read_state_description += `<read_state_${read_state_idx}>\n${action_result.extracted_content}\n</read_state_${read_state_idx}>\n`;
				read_state_idx += 1;
				console.debug(
					`Added extracted_content to read_state_description: ${action_result.extracted_content}`
				);
			}

			// Store images for one-time inclusion in the next message
			if (action_result.images) {
				this.state.read_state_images.push(...action_result.images);
				console.debug(
					`Added ${action_result.images.length} image(s) to read_state_images`
				);
			}

			if (action_result.long_term_memory) {
				action_results += `${action_result.long_term_memory}\n`;
				console.debug(
					`Added long_term_memory to action_results: ${action_result.long_term_memory}`
				);
			} else if (
				action_result.extracted_content &&
				!action_result.include_extracted_content_only_once
			) {
				action_results += `${action_result.extracted_content}\n`;
				console.debug(
					`Added extracted_content to action_results: ${action_result.extracted_content}`
				);
			}

			if (action_result.error) {
				let error_text: string;
				if (action_result.error.length > 200) {
					error_text =
						action_result.error.substring(0, 100) +
						'......' +
						action_result.error.substring(action_result.error.length - 100);
				} else {
					error_text = action_result.error;
				}
				action_results += `${error_text}\n`;
				console.debug(`Added error to action_results: ${error_text}`);
			}
		}

		// Simple 60k character limit for read_state_description
		const MAX_CONTENT_SIZE = 60000;
		if (this.state.read_state_description.length > MAX_CONTENT_SIZE) {
			this.state.read_state_description =
				this.state.read_state_description.substring(0, MAX_CONTENT_SIZE) +
				'\n... [Content truncated at 60k characters]';
			console.debug(
				`Truncated read_state_description to ${MAX_CONTENT_SIZE} characters`
			);
		}

		this.state.read_state_description = this.state.read_state_description.replace(
			/^\n+|\n+$/g,
			''
		);

		if (action_results) {
			action_results = `Result\n${action_results}`;
		}
		action_results = action_results ? action_results.replace(/^\n+|\n+$/g, '') : null;

		// Simple 60k character limit for action_results
		if (action_results && action_results.length > MAX_CONTENT_SIZE) {
			action_results =
				action_results.substring(0, MAX_CONTENT_SIZE) +
				'\n... [Content truncated at 60k characters]';
			console.debug(`Truncated action_results to ${MAX_CONTENT_SIZE} characters`);
		}

		// Build the history item
		if (model_output === null) {
			// Add history item for initial actions (step 0) or errors (step > 0)
			if (step_number !== null) {
				if (step_number === 0 && action_results) {
					// Step 0 with initial action results
					const history_item: HistoryItem = {
						step_number: step_number,
						evaluation_previous_goal: null,
						memory: null,
						next_goal: null,
						action_results: action_results,
						error: null,
						system_message: null,
					};
					this.state.agent_history_items.push(history_item);
				} else if (step_number > 0) {
					// Error case for steps > 0
					const history_item: HistoryItem = {
						step_number: step_number,
						evaluation_previous_goal: null,
						memory: null,
						next_goal: null,
						action_results: null,
						error: 'Agent failed to output in the right format.',
						system_message: null,
					};
					this.state.agent_history_items.push(history_item);
				}
			}
		} else {
			const history_item: HistoryItem = {
				step_number: step_number,
				evaluation_previous_goal:
					model_output.current_state.evaluation_previous_goal,
				memory: model_output.current_state.memory,
				next_goal: model_output.current_state.next_goal,
				action_results: action_results,
				error: null,
				system_message: null,
			};
			this.state.agent_history_items.push(history_item);
		}
	}

	_get_sensitive_data_description(current_page_url: string): string {
		const sensitive_data = this.sensitive_data;
		if (!sensitive_data) {
			return '';
		}

		// Collect placeholders for sensitive data
		const placeholders: Set<string> = new Set();

		for (const [key_or_domain, content] of Object.entries(sensitive_data)) {
			if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
				// New format: {domain: {key: value}}
				// Note: match_url_with_domain_pattern needs to be implemented or imported
				// For now, we'll use a simple check
				if (current_page_url) {
					// TODO: Implement match_url_with_domain_pattern in TypeScript
					// if (match_url_with_domain_pattern(current_page_url, key_or_domain, true)) {
					// 	Object.keys(content).forEach((key) => placeholders.add(key));
					// }
					// Simplified version - check if domain matches
					try {
						const url_obj = new URL(current_page_url);
						const domain = url_obj.hostname;
						if (
							domain.includes(key_or_domain.replace('*.', '')) ||
							key_or_domain === '*'
						) {
							Object.keys(content).forEach((key) => placeholders.add(key));
						}
					} catch {
						// Invalid URL, skip
					}
				}
			} else {
				// Old format: {key: value}
				placeholders.add(key_or_domain);
			}
		}

		if (placeholders.size > 0) {
			const placeholder_list = Array.from(placeholders).sort();
			let info = `Here are placeholders for sensitive data:\n${JSON.stringify(placeholder_list)}\n`;
			info += 'To use them, write <secret>the placeholder name</secret>';
			return info;
		}

		return '';
	}

	// @observe_debug(ignore_input=True, ignore_output=True, name='create_state_messages')
	// @time_execution_sync('--create_state_messages')
	create_state_messages(
		browser_state_summary: BrowserStateSummary,
		model_output: AgentOutput | null = null,
		result: ActionResult[] | null = null,
		step_info: AgentStepInfo | null = null,
		use_vision: boolean | 'auto' = true,
		page_filtered_actions: string | null = null,
		sensitive_data: Record<string, string | Record<string, string>> | null = null,
		available_file_paths: string[] | null = null, // Always pass current available_file_paths
		unavailable_skills_info: string | null = null // Information about skills that cannot be used yet
	): void {
		/**Create single state message with all content*/

		// Clear contextual messages from previous steps to prevent accumulation
		this.state.history.context_messages = [];

		// First, update the agent history items with the latest step results
		this._update_agent_history_description(model_output, result, step_info);

		// Use the passed sensitive_data parameter, falling back to instance variable
		const effective_sensitive_data =
			sensitive_data !== null ? sensitive_data : this.sensitive_data;
		if (effective_sensitive_data !== null) {
			// Update instance variable to keep it in sync
			this.sensitive_data = effective_sensitive_data;
			this.sensitive_data_description = this._get_sensitive_data_description(
				browser_state_summary.url
			);
		}

		// Use only the current screenshot, but check if action results request screenshot inclusion
		const screenshots: string[] = [];
		let include_screenshot_requested = false;

		// Check if any action results request screenshot inclusion
		if (result) {
			for (const action_result of result) {
				if (
					action_result.metadata &&
					action_result.metadata['include_screenshot']
				) {
					include_screenshot_requested = true;
					console.debug('Screenshot inclusion requested by action result');
					break;
				}
			}
		}

		// Handle different use_vision modes:
		// - "auto": Only include screenshot if explicitly requested by action (e.g., screenshot)
		// - True: Always include screenshot
		// - False: Never include screenshot
		let include_screenshot = false;
		if (use_vision === true) {
			// Always include screenshot when use_vision=True
			include_screenshot = true;
		} else if (use_vision === 'auto') {
			// Only include screenshot if explicitly requested by action when use_vision="auto"
			include_screenshot = include_screenshot_requested;
		}
		// else: use_vision is False, never include screenshot (include_screenshot stays False)

		if (include_screenshot && browser_state_summary.screenshot) {
			screenshots.push(browser_state_summary.screenshot);
		}

		// Use vision in the user message if screenshots are included
		const effective_use_vision = screenshots.length > 0;

		// Create single state message with all content
		if (!browser_state_summary) {
			throw new Error('browser_state_summary is required');
		}

		// Note: AgentMessagePrompt needs to be imported and instantiated
		// For now, we'll create a placeholder - this will need to be properly implemented
		const state_message = new (AgentMessagePrompt as any)(
			browser_state_summary,
			this.file_system,
			this.agent_history_description,
			this.state.read_state_description,
			this.task,
			this.include_attributes,
			step_info,
			page_filtered_actions,
			this.sensitive_data_description,
			available_file_paths,
			screenshots,
			this.vision_detail_level,
			this.include_recent_events,
			this.sample_images,
			this.state.read_state_images,
			this.llm_screenshot_size,
			unavailable_skills_info
		).get_user_message(effective_use_vision);

		// Store state message text for history
		this.last_state_message_text = state_message.text || '';

		// Set the state message with caching enabled
		this._set_message_with_type(state_message, 'state');
	}

	_log_history_lines(): string {
		/**Generate a formatted log string of message history for debugging / printing to terminal*/
		// TODO: fix logging
		return '';
	}

	// @time_execution_sync('--get_messages')
	get_messages(): BaseMessage[] {
		/**Get current message list, potentially trimmed to max tokens*/

		// Log message history for debugging
		console.debug(this._log_history_lines());
		this.last_input_messages = this.state.history.get_messages();
		return this.last_input_messages;
	}

	_set_message_with_type(
		message: BaseMessage,
		message_type: 'system' | 'state'
	): void {
		/**Replace a specific state message slot with a new message*/
		// System messages don't need filtering - they only contain instructions/placeholders
		// State messages need filtering - they include agent_history_description which contains
		// action results with real sensitive values (after placeholder replacement during execution)
		if (message_type === 'system') {
			this.state.history.system_message = message;
		} else if (message_type === 'state') {
			if (this.sensitive_data) {
				message = this._filter_sensitive_data(message);
			}
			this.state.history.state_message = message;
		} else {
			throw new Error(`Invalid state message type: ${message_type}`);
		}
	}

	_add_context_message(message: BaseMessage): void {
		/**Add a contextual message specific to this step (e.g., validation errors, retry instructions, timeout warnings)*/
		// Context messages typically contain error messages and validation info, not action results
		// with sensitive data, so filtering is not needed here
		this.state.history.context_messages.push(message);
	}

	// @time_execution_sync('--filter_sensitive_data')
	_filter_sensitive_data(message: BaseMessage): BaseMessage {
		/**Filter out sensitive data from the message*/

		const replace_sensitive = (value: string): string => {
			if (!this.sensitive_data) {
				return value;
			}

			// Collect all sensitive values, immediately converting old format to new format
			const sensitive_values: Record<string, string> = {};

			// Process all sensitive data entries
			for (const [key_or_domain, content] of Object.entries(this.sensitive_data)) {
				if (
					typeof content === 'object' &&
					content !== null &&
					!Array.isArray(content)
				) {
					// Already in new format: {domain: {key: value}}
					for (const [key, val] of Object.entries(content)) {
						if (val) {
							// Skip empty values
							sensitive_values[key] = val as string;
						}
					}
				} else if (content) {
					// Old format: {key: value} - convert to new format internally
					// We treat this as if it was {'http*://*': {key_or_domain: content}}
					sensitive_values[key_or_domain] = content as string;
				}
			}

			// If there are no valid sensitive data entries, just return the original value
			if (Object.keys(sensitive_values).length === 0) {
				console.warn('No valid entries found in sensitive_data dictionary');
				return value;
			}

			// Replace all valid sensitive data values with their placeholder tags
			let result = value;
			for (const [key, val] of Object.entries(sensitive_values)) {
				result = result.replace(new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `<secret>${key}</secret>`);
			}

			return result;
		};

		if (typeof message.content === 'string') {
			message.content = replace_sensitive(message.content);
		} else if (Array.isArray(message.content)) {
			for (let i = 0; i < message.content.length; i++) {
				const item = message.content[i];
				if (
					typeof item === 'object' &&
					item !== null &&
					'type' in item &&
					item.type === 'text'
				) {
					const textItem = item as ContentPartTextParam;
					textItem.text = replace_sensitive(textItem.text);
					message.content[i] = textItem;
				}
			}
		}
		return message;
	}
}
