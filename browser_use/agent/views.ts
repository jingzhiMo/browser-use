/**
 * TypeScript implementation of agent views
 * Converted from browser_use/agent/views.py
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BaseModel, BaseModelConstructor } from '../llm/base';
import type { BaseChatModel } from '../llm/base';
import type { UsageSummary } from '../tokens/views';
import type { ActionModel } from '../tools/registry/views';
import type { BrowserStateHistory } from '../browser/views';
import type { DOMInteractedElement, DOMSelectorMap } from '../dom/views';
import type { MessageManagerState } from './message_manager/views';
import type { FileSystemState } from '../filesystem/file_system';

// Constants
export const DEFAULT_INCLUDE_ATTRIBUTES: string[] = [
	'id',
	'class',
	'name',
	'type',
	'value',
	'placeholder',
	'aria-label',
	'aria-labelledby',
	'role',
	'href',
	'src',
	'alt',
	'title',
];

// ============================================================================
// AgentSettings
// ============================================================================

export interface AgentSettings extends BaseModel {
	/**Configuration options for the Agent*/
	use_vision: boolean | 'auto';
	vision_detail_level: 'auto' | 'low' | 'high';
	save_conversation_path: string | null;
	save_conversation_path_encoding: string | null;
	max_failures: number;
	generate_gif: boolean | string;
	override_system_message: string | null;
	extend_system_message: string | null;
	include_attributes: string[] | null;
	max_actions_per_step: number;
	use_thinking: boolean;
	flash_mode: boolean; // If enabled, disables evaluation_previous_goal and next_goal, and sets use_thinking = False
	use_judge: boolean;
	ground_truth: string | null; // Ground truth answer or criteria for judge validation
	max_history_items: number | null;
	page_extraction_llm: BaseChatModel | null;
	calculate_cost: boolean;
	include_tool_call_examples: boolean;
	llm_timeout: number; // Timeout in seconds for LLM calls (auto-detected: 30s for gemini, 90s for o3, 60s default)
	step_timeout: number; // Timeout in seconds for each step
	final_response_after_failure: boolean; // If True, attempt one final recovery call after max_failures
}

// ============================================================================
// AgentState
// ============================================================================

export interface AgentState extends BaseModel {
	/**Holds all state information for an Agent*/
	agent_id: string;
	n_steps: number;
	consecutive_failures: number;
	last_result: ActionResult[] | null;
	last_plan: string | null;
	last_model_output: AgentOutput | null;
	// Pause/resume state (kept serialisable for checkpointing)
	paused: boolean;
	stopped: boolean;
	session_initialized: boolean; // Track if session events have been dispatched
	follow_up_task: boolean; // Track if the agent is a follow-up task
	message_manager_state: MessageManagerState;
	file_system_state: FileSystemState | null;
}

// ============================================================================
// AgentStepInfo
// ============================================================================

export class AgentStepInfo {
	step_number: number;
	max_steps: number;

	constructor(step_number: number, max_steps: number) {
		this.step_number = step_number;
		this.max_steps = max_steps;
	}

	/**Check if this is the last step*/
	is_last_step(): boolean {
		return this.step_number >= this.max_steps - 1;
	}
}

// ============================================================================
// JudgementResult
// ============================================================================

export interface JudgementResult extends BaseModel {
	/**LLM judgement of agent trace*/
	reasoning: string | null;
	verdict: boolean;
	failure_reason: string | null;
	impossible_task: boolean;
	reached_captcha: boolean;
}

// ============================================================================
// ActionResult
// ============================================================================

export interface ActionResult extends BaseModel {
	/**Result of executing an action*/
	// For done action
	is_done: boolean | null;
	success: boolean | null;
	// For trace judgement
	judgement: JudgementResult | null;
	// Error handling - always include in long term memory
	error: string | null;
	// Files
	attachments: string[] | null; // Files to display in the done message
	// Images (base64 encoded) - separate from text content for efficient handling
	images: Array<Record<string, any>> | null; // [{"name": "file.jpg", "data": "base64_string"}]
	// Always include in long term memory
	long_term_memory: string | null; // Memory of this action
	// if update_only_read_state is True we add the extracted_content to the agent context only once for the next step
	// if update_only_read_state is False we add the extracted_content to the agent long term memory if no long_term_memory is provided
	extracted_content: string | null;
	include_extracted_content_only_once: boolean; // Whether the extracted content should be used to update the read_state
	// Metadata for observability (e.g., click coordinates)
	metadata: Record<string, any> | null;
	// Deprecated
	include_in_memory: boolean; // whether to include in extracted_content inside long_term_memory
}

// ============================================================================
// RerunSummaryAction
// ============================================================================

export interface RerunSummaryAction extends BaseModel {
	/**AI-generated summary for rerun completion*/
	summary: string;
	success: boolean;
	completion_status: 'complete' | 'partial' | 'failed';
}

// ============================================================================
// StepMetadata
// ============================================================================

export interface StepMetadata extends BaseModel {
	/**Metadata for a single step including timing and token information*/
	step_start_time: number;
	step_end_time: number;
	step_number: number;
	step_interval: number | null;
}

// ============================================================================
// AgentBrain
// ============================================================================

export interface AgentBrain extends BaseModel {
	thinking: string | null;
	evaluation_previous_goal: string;
	memory: string;
	next_goal: string;
}

// ============================================================================
// AgentOutput
// ============================================================================

export interface AgentOutput extends BaseModel {
	thinking: string | null;
	evaluation_previous_goal: string | null;
	memory: string | null;
	next_goal: string | null;
	action: ActionModel[]; // Ensure at least one action is provided
}

// ============================================================================
// AgentHistory
// ============================================================================

export interface AgentHistory extends BaseModel {
	/**History item for agent actions*/
	model_output: AgentOutput | null;
	result: ActionResult[];
	state: BrowserStateHistory;
	metadata: StepMetadata | null;
	state_message: string | null;
}

// ============================================================================
// AgentHistoryList
// ============================================================================

export class AgentHistoryList<T extends BaseModel = BaseModel> implements BaseModel {
	/**List of AgentHistory messages, i.e. the history of the agent's actions and thoughts.*/
	history: AgentHistory[];
	usage: UsageSummary | null;
	_output_model_schema: BaseModelConstructor<T> | null;

	constructor(
		history: AgentHistory[] = [],
		usage: UsageSummary | null = null,
		_output_model_schema: BaseModelConstructor<T> | null = null
	) {
		this.history = history;
		this.usage = usage;
		this._output_model_schema = _output_model_schema;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				history: {
					type: 'array',
					items: { type: 'object' },
				},
				usage: { type: 'object' },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return this.model_validate(data);
	}

	model_validate(data: any): this {
		return new AgentHistoryList(
			data.history || [],
			data.usage || null,
			this._output_model_schema
		) as this;
	}

	/**Get total duration of all steps in seconds*/
	total_duration_seconds(): number {
		let total = 0.0;
		for (const h of this.history) {
			if (h.metadata) {
				total += h.metadata.step_end_time - h.metadata.step_start_time;
			}
		}
		return total;
	}

	/**Return the number of history items*/
	length(): number {
		return this.history.length;
	}

	/**Representation of the AgentHistoryList object*/
	toString(): string {
		return `AgentHistoryList(all_results=${this.action_results()}, all_model_outputs=${this.model_actions()})`;
	}

	/**Add a history item to the list*/
	add_item(history_item: AgentHistory): void {
		this.history.push(history_item);
	}

	/**Save history to JSON file with proper serialization and optional sensitive data filtering*/
	save_to_file(filepath: string, sensitive_data: Record<string, string | Record<string, string>> | null = null): void {
		try {
			const filePathObj = path.resolve(filepath);
			const dir = path.dirname(filePathObj);
			fs.mkdirSync(dir, { recursive: true });
			const data = this.model_dump(sensitive_data);
			fs.writeFileSync(filePathObj, JSON.stringify(data, null, 2), 'utf-8');
		} catch (error) {
			throw error;
		}
	}

	/**Custom serialization that properly uses AgentHistory's model_dump*/
	model_dump(sensitive_data?: Record<string, string | Record<string, string>> | null): Record<string, any> {
		return {
			history: this.history.map((h) => {
				// In TypeScript, we'd need to implement model_dump for AgentHistory
				// For now, return a simplified version
				return {
					model_output: h.model_output,
					result: h.result,
					state: h.state,
					metadata: h.metadata,
					state_message: h.state_message,
				};
			}),
		};
	}

	/**Load history from dictionary*/
	static load_from_dict<T extends BaseModel>(
		data: Record<string, any>,
		output_model: BaseModelConstructor<AgentOutput>
	): AgentHistoryList<T> {
		// loop through history and validate output_model actions to enrich with custom actions
		for (const h of data.history || []) {
			if (h.model_output) {
				if (typeof h.model_output === 'object') {
					h.model_output = output_model.prototype.model_validate_json(JSON.stringify(h.model_output));
				} else {
					h.model_output = null;
				}
			}
			if (!h.state.interacted_element) {
				h.state.interacted_element = null;
			}
		}

		return new AgentHistoryList(data.history || [], data.usage || null, null);
	}

	/**Load history from JSON file*/
	static load_from_file<T extends BaseModel>(
		filepath: string,
		output_model: BaseModelConstructor<AgentOutput>
	): AgentHistoryList<T> {
		const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
		return AgentHistoryList.load_from_dict(data, output_model);
	}

	/**Last action in history*/
	last_action(): Record<string, any> | null {
		if (this.history.length > 0 && this.history[this.history.length - 1].model_output) {
			const lastOutput = this.history[this.history.length - 1].model_output!;
			if (lastOutput.action.length > 0) {
				// Return simplified action dump
				return lastOutput.action[lastOutput.action.length - 1] as any;
			}
		}
		return null;
	}

	/**Get all errors from history, with None for steps without errors*/
	errors(): (string | null)[] {
		const errors: (string | null)[] = [];
		for (const h of this.history) {
			const step_errors = h.result.filter((r) => r.error).map((r) => r.error);
			// each step can have only one error
			errors.push(step_errors[0] || null);
		}
		return errors;
	}

	/**Final result from history*/
	final_result(): string | null {
		if (this.history.length > 0 && this.history[this.history.length - 1].result.length > 0) {
			const lastResult = this.history[this.history.length - 1].result[this.history[this.history.length - 1].result.length - 1];
			return lastResult.extracted_content || null;
		}
		return null;
	}

	/**Check if the agent is done*/
	is_done(): boolean {
		if (this.history.length > 0 && this.history[this.history.length - 1].result.length > 0) {
			const lastResult = this.history[this.history.length - 1].result[this.history[this.history.length - 1].result.length - 1];
			return lastResult.is_done === true;
		}
		return false;
	}

	/**Check if the agent completed successfully - the agent decides in the last step if it was successful or not. None if not done yet.*/
	is_successful(): boolean | null {
		if (this.history.length > 0 && this.history[this.history.length - 1].result.length > 0) {
			const lastResult = this.history[this.history.length - 1].result[this.history[this.history.length - 1].result.length - 1];
			if (lastResult.is_done === true) {
				return lastResult.success;
			}
		}
		return null;
	}

	/**Check if the agent has any non-None errors*/
	has_errors(): boolean {
		return this.errors().some((error) => error !== null);
	}

	/**Get the judgement result as a dictionary if it exists*/
	judgement(): Record<string, any> | null {
		if (this.history.length > 0 && this.history[this.history.length - 1].result.length > 0) {
			const lastResult = this.history[this.history.length - 1].result[this.history[this.history.length - 1].result.length - 1];
			if (lastResult.judgement) {
				return lastResult.judgement as any;
			}
		}
		return null;
	}

	/**Check if the agent trace has been judged*/
	is_judged(): boolean {
		if (this.history.length > 0 && this.history[this.history.length - 1].result.length > 0) {
			const lastResult = this.history[this.history.length - 1].result[this.history[this.history.length - 1].result.length - 1];
			return lastResult.judgement !== null;
		}
		return false;
	}

	/**Check if the judge validated the agent execution (verdict is True). Returns None if not judged yet.*/
	is_validated(): boolean | null {
		if (this.history.length > 0 && this.history[this.history.length - 1].result.length > 0) {
			const lastResult = this.history[this.history.length - 1].result[this.history[this.history.length - 1].result.length - 1];
			if (lastResult.judgement) {
				return lastResult.judgement.verdict;
			}
		}
		return null;
	}

	/**Get all unique URLs from history*/
	urls(): (string | null)[] {
		return this.history.map((h) => h.state.url || null);
	}

	/**Get all screenshot paths from history*/
	screenshot_paths(n_last: number | null = null, return_none_if_not_screenshot: boolean = true): (string | null)[] {
		if (n_last === 0) {
			return [];
		}
		const items = n_last === null ? this.history : this.history.slice(-n_last);
		if (return_none_if_not_screenshot) {
			return items.map((h) => h.state.screenshot_path || null);
		} else {
			return items.filter((h) => h.state.screenshot_path !== null).map((h) => h.state.screenshot_path!);
		}
	}

	/**Get all screenshots from history as base64 strings*/
	screenshots(n_last: number | null = null, return_none_if_not_screenshot: boolean = true): (string | null)[] {
		if (n_last === 0) {
			return [];
		}

		const history_items = n_last === null ? this.history : this.history.slice(-n_last);
		const screenshots: (string | null)[] = [];

		for (const item of history_items) {
			const screenshot_b64 = item.state.get_screenshot();
			if (screenshot_b64) {
				screenshots.push(screenshot_b64);
			} else {
				if (return_none_if_not_screenshot) {
					screenshots.push(null);
				}
			}
		}

		return screenshots;
	}

	/**Get all action names from history*/
	action_names(): string[] {
		const action_names: string[] = [];
		for (const action of this.model_actions()) {
			const actions = Object.keys(action);
			if (actions.length > 0) {
				action_names.push(actions[0]);
			}
		}
		return action_names;
	}

	/**Get all thoughts from history*/
	model_thoughts(): AgentBrain[] {
		return this.history
			.filter((h) => h.model_output)
			.map((h) => {
				const output = h.model_output!;
				return {
					thinking: output.thinking,
					evaluation_previous_goal: output.evaluation_previous_goal || '',
					memory: output.memory || '',
					next_goal: output.next_goal || '',
				} as AgentBrain;
			});
	}

	/**Get all model outputs from history*/
	model_outputs(): AgentOutput[] {
		return this.history.filter((h) => h.model_output).map((h) => h.model_output!);
	}

	/**Get all actions from history*/
	model_actions(): Record<string, any>[] {
		const outputs: Record<string, any>[] = [];

		for (const h of this.history) {
			if (h.model_output) {
				// Guard against None interacted_element before zipping
				const interacted_elements = h.state.interacted_element || new Array(h.model_output.action.length).fill(null);
				for (let i = 0; i < h.model_output.action.length; i++) {
					const action = h.model_output.action[i];
					const interacted_element = interacted_elements[i];
					const output: Record<string, any> = action as any; // Simplified - would need proper model_dump
					output['interacted_element'] = interacted_element;
					outputs.push(output);
				}
			}
		}
		return outputs;
	}

	/**Get truncated action history with only essential fields*/
	action_history(): Record<string, any>[][] {
		const step_outputs: Record<string, any>[][] = [];

		for (const h of this.history) {
			const step_actions: Record<string, any>[] = [];
			if (h.model_output) {
				// Guard against None interacted_element before zipping
				const interacted_elements = h.state.interacted_element || new Array(h.model_output.action.length).fill(null);
				// Zip actions with interacted elements and results
				for (let i = 0; i < h.model_output.action.length; i++) {
					const action = h.model_output.action[i];
					const interacted_element = interacted_elements[i];
					const result = h.result[i];
					const action_output: Record<string, any> = action as any; // Simplified - would need proper model_dump
					action_output['interacted_element'] = interacted_element;
					// Only keep long_term_memory from result
					action_output['result'] = result && result.long_term_memory ? result.long_term_memory : null;
					step_actions.push(action_output);
				}
			}
			step_outputs.push(step_actions);
		}

		return step_outputs;
	}

	/**Get all results from history*/
	action_results(): ActionResult[] {
		const results: ActionResult[] = [];
		for (const h of this.history) {
			results.push(...h.result.filter((r) => r));
		}
		return results;
	}

	/**Get all extracted content from history*/
	extracted_content(): string[] {
		const content: string[] = [];
		for (const h of this.history) {
			content.push(...h.result.filter((r) => r.extracted_content).map((r) => r.extracted_content!));
		}
		return content;
	}

	/**Get all model actions from history as JSON*/
	model_actions_filtered(include: string[] | null = null): Record<string, any>[] {
		if (include === null) {
			include = [];
		}
		const outputs = this.model_actions();
		const result: Record<string, any>[] = [];
		for (const o of outputs) {
			for (const i of include) {
				if (i === Object.keys(o)[0]) {
					result.push(o);
				}
			}
		}
		return result;
	}

	/**Get the number of steps in the history*/
	number_of_steps(): number {
		return this.history.length;
	}

	/**Format agent history as readable step descriptions for judge evaluation.*/
	agent_steps(): string[] {
		const steps: string[] = [];

		// Iterate through history items (each is an AgentHistory)
		for (let i = 0; i < this.history.length; i++) {
			const h = this.history[i];
			let step_text = `Step ${i + 1}:\n`;

			// Get actions from model_output
			if (h.model_output && h.model_output.action) {
				// Use model_dump with mode='json' to serialize enums properly
				const actions_list = h.model_output.action.map((action) => action as any); // Simplified
				const action_json = JSON.stringify(actions_list, null, 1);
				step_text += `Actions: ${action_json}\n`;
			}

			// Get results (already a list[ActionResult] in h.result)
			if (h.result) {
				for (let j = 0; j < h.result.length; j++) {
					const result = h.result[j];
					if (result.extracted_content) {
						const content = String(result.extracted_content);
						step_text += `Result ${j + 1}: ${content}\n`;
					}

					if (result.error) {
						const error = String(result.error);
						step_text += `Error ${j + 1}: ${error}\n`;
					}
				}
			}

			steps.push(step_text);
		}

		return steps;
	}

	/**Get the structured output from the history*/
	get structured_output(): T | null {
		const final_result = this.final_result();
		if (final_result !== null && this._output_model_schema !== null) {
			return this._output_model_schema.prototype.model_validate_json(final_result);
		}
		return null;
	}

	/**Get the structured output from history, parsing with the provided schema.*/
	get_structured_output(output_model: BaseModelConstructor<T>): T | null {
		const final_result = this.final_result();
		if (final_result !== null) {
			return output_model.prototype.model_validate_json(final_result);
		}
		return null;
	}
}

// ============================================================================
// AgentError
// ============================================================================

export class AgentError {
	/**Container for agent error handling*/
	static readonly VALIDATION_ERROR = 'Invalid model output format. Please follow the correct schema.';
	static readonly RATE_LIMIT_ERROR = 'Rate limit reached. Waiting before retry.';
	static readonly NO_VALID_ACTION = 'No valid action found';

	/**Format error message based on error type and optionally include trace*/
	static format_error(error: Error, include_trace: boolean = false): string {
		const error_str = error.toString();
		
		// Handle validation errors
		if (error_str.includes('ValidationError') || error_str.includes('validation')) {
			return `${AgentError.VALIDATION_ERROR}\nDetails: ${error_str}`;
		}

		// Handle rate limit errors
		if (error_str.includes('RateLimitError') || error_str.includes('rate limit')) {
			return AgentError.RATE_LIMIT_ERROR;
		}

		// Handle LLM response validation errors
		if (
			error_str.includes('LLM response missing required fields') ||
			error_str.includes('Expected format: AgentOutput')
		) {
			const lines = error_str.split('\n');
			const main_error = lines[0] || error_str;
			let helpful_msg = `${main_error}\n\nThe previous response had an invalid output structure. Please stick to the required output format. \n\n`;

			if (include_trace) {
				helpful_msg += `\n\nFull stacktrace:\n${error.stack || error_str}`;
			}

			return helpful_msg;
		}

		if (include_trace) {
			return `${error_str}\nStacktrace:\n${error.stack || error_str}`;
		}
		return error_str;
	}
}

// ============================================================================
// DetectedVariable
// ============================================================================

export interface DetectedVariable extends BaseModel {
	/**A detected variable in agent history*/
	name: string;
	original_value: string;
	type: string;
	format: string | null;
}

// ============================================================================
// VariableMetadata
// ============================================================================

export interface VariableMetadata extends BaseModel {
	/**Metadata about detected variables in history*/
	detected_variables: Record<string, DetectedVariable>;
}
