/**
 * TypeScript implementation of code-use views
 * Converted from browser_use/code_use/views.py
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { BaseModel } from '../llm/base';
import type { UsageSummary } from '../tokens/views';

/**
 * Generate a UUID v7-like string (using v4 as fallback)
 * Note: For true UUID v7, you would need a library like 'uuid' with uuid7 support
 */
function uuid7str(): string {
	// Using randomUUID as fallback (generates UUID v4)
	// For production, consider using a proper UUID v7 library
	return randomUUID();
}

// ============================================================================
// Enums
// ============================================================================

/**
 * Type of notebook cell.
 */
export enum CellType {
	CODE = 'code',
	MARKDOWN = 'markdown',
}

/**
 * Execution status of a cell.
 */
export enum ExecutionStatus {
	PENDING = 'pending',
	RUNNING = 'running',
	SUCCESS = 'success',
	ERROR = 'error',
}

// ============================================================================
// CodeCell
// ============================================================================

export interface CodeCell extends BaseModel {
	/**Represents a code cell in the notebook-like execution.*/
	id: string;
	cell_type: CellType;
	source: string;
	output: string | null;
	execution_count: number | null;
	status: ExecutionStatus;
	error: string | null;
	browser_state: string | null;
}

export class CodeCellImpl implements CodeCell {
	id: string;
	cell_type: CellType;
	source: string;
	output: string | null;
	execution_count: number | null;
	status: ExecutionStatus;
	error: string | null;
	browser_state: string | null;

	constructor(
		source: string,
		id: string | null = null,
		cell_type: CellType = CellType.CODE,
		output: string | null = null,
		execution_count: number | null = null,
		status: ExecutionStatus = ExecutionStatus.PENDING,
		error: string | null = null,
		browser_state: string | null = null
	) {
		this.id = id || uuid7str();
		this.cell_type = cell_type;
		this.source = source;
		this.output = output;
		this.execution_count = execution_count;
		this.status = status;
		this.error = error;
		this.browser_state = browser_state;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				id: { type: 'string' },
				cell_type: { type: 'string', enum: Object.values(CellType) },
				source: { type: 'string' },
				output: { type: ['string', 'null'] },
				execution_count: { type: ['number', 'null'] },
				status: { type: 'string', enum: Object.values(ExecutionStatus) },
				error: { type: ['string', 'null'] },
				browser_state: { type: ['string', 'null'] },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new CodeCellImpl(
			data.source,
			data.id || null,
			data.cell_type || CellType.CODE,
			data.output || null,
			data.execution_count || null,
			data.status || ExecutionStatus.PENDING,
			data.error || null,
			data.browser_state || null
		) as this;
	}

	model_dump(): Record<string, any> {
		return {
			id: this.id,
			cell_type: this.cell_type,
			source: this.source,
			output: this.output,
			execution_count: this.execution_count,
			status: this.status,
			error: this.error,
			browser_state: this.browser_state,
		};
	}
}

// ============================================================================
// NotebookSession
// ============================================================================

export interface NotebookSession extends BaseModel {
	/**Represents a notebook-like session.*/
	id: string;
	cells: CodeCell[];
	current_execution_count: number;
	namespace: Record<string, any>;
}

export class NotebookSessionImpl implements NotebookSession {
	id: string;
	cells: CodeCell[];
	current_execution_count: number;
	namespace: Record<string, any>;
	private _complete_history: CodeAgentHistory[] = [];
	private _usage_summary: UsageSummary | null = null;

	constructor(
		id: string | null = null,
		cells: CodeCell[] = [],
		current_execution_count: number = 0,
		namespace: Record<string, any> = {}
	) {
		this.id = id || uuid7str();
		this.cells = cells;
		this.current_execution_count = current_execution_count;
		this.namespace = namespace;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				id: { type: 'string' },
				cells: { type: 'array', items: { type: 'object' } },
				current_execution_count: { type: 'number' },
				namespace: { type: 'object' },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new NotebookSessionImpl(
			data.id || null,
			(data.cells || []).map((c: any) => new CodeCellImpl().model_validate_json(JSON.stringify(c))),
			data.current_execution_count || 0,
			data.namespace || {}
		) as this;
	}

	/**Add a new code cell to the session.*/
	add_cell(source: string): CodeCell {
		const cell = new CodeCellImpl(source);
		this.cells.push(cell);
		return cell;
	}

	/**Get a cell by ID.*/
	get_cell(cell_id: string): CodeCell | null {
		for (const cell of this.cells) {
			if (cell.id === cell_id) {
				return cell;
			}
		}
		return null;
	}

	/**Get the most recently added cell.*/
	get_latest_cell(): CodeCell | null {
		if (this.cells.length > 0) {
			return this.cells[this.cells.length - 1];
		}
		return null;
	}

	/**Increment and return the execution count.*/
	increment_execution_count(): number {
		this.current_execution_count++;
		return this.current_execution_count;
	}

	/**Get the history as an AgentHistoryList-compatible object.*/
	get history(): CodeAgentHistoryList {
		return new CodeAgentHistoryList(this._complete_history, this._usage_summary);
	}

	set_complete_history(history: CodeAgentHistory[]): void {
		this._complete_history = history;
	}

	set_usage_summary(usage: UsageSummary | null): void {
		this._usage_summary = usage;
	}
}

// ============================================================================
// NotebookExport
// ============================================================================

export interface NotebookExport extends BaseModel {
	/**Export format for Jupyter notebook.*/
	nbformat: number;
	nbformat_minor: number;
	metadata: Record<string, any>;
	cells: Array<Record<string, any>>;
}

export class NotebookExportImpl implements NotebookExport {
	nbformat: number;
	nbformat_minor: number;
	metadata: Record<string, any>;
	cells: Array<Record<string, any>>;

	constructor(
		options: {
			nbformat?: number;
			nbformat_minor?: number;
			metadata?: Record<string, any>;
			cells?: Array<Record<string, any>>;
		} = {}
	) {
		this.nbformat = options.nbformat ?? 4;
		this.nbformat_minor = options.nbformat_minor ?? 5;
		this.metadata = options.metadata ?? {};
		this.cells = options.cells ?? [];
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				nbformat: { type: 'number' },
				nbformat_minor: { type: 'number' },
				metadata: { type: 'object' },
				cells: { type: 'array', items: { type: 'object' } },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new NotebookExportImpl(data) as this;
	}

	model_dump(): Record<string, any> {
		return {
			nbformat: this.nbformat,
			nbformat_minor: this.nbformat_minor,
			metadata: this.metadata,
			cells: this.cells,
		};
	}
}

// ============================================================================
// CodeAgentModelOutput
// ============================================================================

export interface CodeAgentModelOutput extends BaseModel {
	/**Model output for CodeAgent - contains the code and full LLM response.*/
	model_output: string;
	full_response: string;
}

export class CodeAgentModelOutputImpl implements CodeAgentModelOutput {
	model_output: string;
	full_response: string;

	constructor(model_output: string, full_response: string) {
		this.model_output = model_output;
		this.full_response = full_response;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				model_output: { type: 'string' },
				full_response: { type: 'string' },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new CodeAgentModelOutputImpl(data.model_output, data.full_response) as this;
	}

	model_dump(): Record<string, any> {
		return {
			model_output: this.model_output,
			full_response: this.full_response,
		};
	}
}

// ============================================================================
// CodeAgentResult
// ============================================================================

export interface CodeAgentResult extends BaseModel {
	/**Result of executing a code cell in CodeAgent.*/
	extracted_content: string | null;
	error: string | null;
	is_done: boolean;
	success: boolean | null;
}

export class CodeAgentResultImpl implements CodeAgentResult {
	extracted_content: string | null;
	error: string | null;
	is_done: boolean;
	success: boolean | null;

	constructor(
		extracted_content: string | null = null,
		error: string | null = null,
		is_done: boolean = false,
		success: boolean | null = null
	) {
		this.extracted_content = extracted_content;
		this.error = error;
		this.is_done = is_done;
		this.success = success;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				extracted_content: { type: ['string', 'null'] },
				error: { type: ['string', 'null'] },
				is_done: { type: 'boolean' },
				success: { type: ['boolean', 'null'] },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new CodeAgentResultImpl(
			data.extracted_content || null,
			data.error || null,
			data.is_done || false,
			data.success || null
		) as this;
	}

	model_dump(): Record<string, any> {
		return {
			extracted_content: this.extracted_content,
			error: this.error,
			is_done: this.is_done,
			success: this.success,
		};
	}
}

// ============================================================================
// CodeAgentState
// ============================================================================

export interface CodeAgentState extends BaseModel {
	/**State information for a CodeAgent step.*/
	url: string | null;
	title: string | null;
	screenshot_path: string | null;
}

export class CodeAgentStateImpl implements CodeAgentState {
	url: string | null;
	title: string | null;
	screenshot_path: string | null;

	constructor(url: string | null = null, title: string | null = null, screenshot_path: string | null = null) {
		this.url = url;
		this.title = title;
		this.screenshot_path = screenshot_path;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				url: { type: ['string', 'null'] },
				title: { type: ['string', 'null'] },
				screenshot_path: { type: ['string', 'null'] },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new CodeAgentStateImpl(data.url || null, data.title || null, data.screenshot_path || null) as this;
	}

	/**Load screenshot from disk and return as base64 string.*/
	get_screenshot(): string | null {
		if (!this.screenshot_path) {
			return null;
		}

		const pathObj = path.resolve(this.screenshot_path);
		if (!fs.existsSync(pathObj)) {
			return null;
		}

		try {
			const screenshotData = fs.readFileSync(pathObj);
			return Buffer.from(screenshotData).toString('base64');
		} catch (error) {
			return null;
		}
	}

	model_dump(): Record<string, any> {
		return {
			url: this.url,
			title: this.title,
			screenshot_path: this.screenshot_path,
		};
	}
}

// ============================================================================
// CodeAgentStepMetadata
// ============================================================================

export interface CodeAgentStepMetadata extends BaseModel {
	/**Metadata for a single CodeAgent step including timing and token information.*/
	input_tokens: number | null;
	output_tokens: number | null;
	step_start_time: number;
	step_end_time: number;
}

export class CodeAgentStepMetadataImpl implements CodeAgentStepMetadata {
	input_tokens: number | null;
	output_tokens: number | null;
	step_start_time: number;
	step_end_time: number;

	constructor(
		step_start_time: number,
		step_end_time: number,
		input_tokens: number | null = null,
		output_tokens: number | null = null
	) {
		this.input_tokens = input_tokens;
		this.output_tokens = output_tokens;
		this.step_start_time = step_start_time;
		this.step_end_time = step_end_time;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				input_tokens: { type: ['number', 'null'] },
				output_tokens: { type: ['number', 'null'] },
				step_start_time: { type: 'number' },
				step_end_time: { type: 'number' },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new CodeAgentStepMetadataImpl(
			data.step_start_time,
			data.step_end_time,
			data.input_tokens || null,
			data.output_tokens || null
		) as this;
	}

	/**Calculate step duration in seconds.*/
	get duration_seconds(): number {
		return this.step_end_time - this.step_start_time;
	}

	model_dump(): Record<string, any> {
		return {
			input_tokens: this.input_tokens,
			output_tokens: this.output_tokens,
			step_start_time: this.step_start_time,
			step_end_time: this.step_end_time,
		};
	}
}

// ============================================================================
// CodeAgentHistory
// ============================================================================

export interface CodeAgentHistory extends BaseModel {
	/**History item for CodeAgent actions.*/
	model_output: CodeAgentModelOutput | null;
	result: CodeAgentResult[];
	state: CodeAgentState;
	metadata: CodeAgentStepMetadata | null;
	screenshot_path: string | null;
}

export class CodeAgentHistoryImpl implements CodeAgentHistory {
	model_output: CodeAgentModelOutput | null;
	result: CodeAgentResult[];
	state: CodeAgentState;
	metadata: CodeAgentStepMetadata | null;
	screenshot_path: string | null;

	constructor(
		state: CodeAgentState,
		model_output: CodeAgentModelOutput | null = null,
		result: CodeAgentResult[] = [],
		metadata: CodeAgentStepMetadata | null = null,
		screenshot_path: string | null = null
	) {
		this.model_output = model_output;
		this.result = result;
		this.state = state;
		this.metadata = metadata;
		this.screenshot_path = screenshot_path;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				model_output: { type: ['object', 'null'] },
				result: { type: 'array', items: { type: 'object' } },
				state: { type: 'object' },
				metadata: { type: ['object', 'null'] },
				screenshot_path: { type: ['string', 'null'] },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new CodeAgentHistoryImpl(
			new CodeAgentStateImpl().model_validate_json(JSON.stringify(data.state)),
			data.model_output ? new CodeAgentModelOutputImpl().model_validate_json(JSON.stringify(data.model_output)) : null,
			(data.result || []).map((r: any) => new CodeAgentResultImpl().model_validate_json(JSON.stringify(r))),
			data.metadata ? new CodeAgentStepMetadataImpl().model_validate_json(JSON.stringify(data.metadata)) : null,
			data.screenshot_path || null
		) as this;
	}

	/**Custom serialization for CodeAgentHistory.*/
	model_dump(): Record<string, any> {
		return {
			model_output: this.model_output ? (this.model_output as CodeAgentModelOutputImpl).model_dump() : null,
			result: this.result.map((r) => (r as CodeAgentResultImpl).model_dump()),
			state: (this.state as CodeAgentStateImpl).model_dump(),
			metadata: this.metadata ? (this.metadata as CodeAgentStepMetadataImpl).model_dump() : null,
			screenshot_path: this.screenshot_path,
		};
	}
}

// ============================================================================
// CodeAgentHistoryList
// ============================================================================

/**
 * Compatibility wrapper for CodeAgentHistory that provides AgentHistoryList-like API.
 */
export class CodeAgentHistoryList {
	private _complete_history: CodeAgentHistory[];
	private _usage_summary: UsageSummary | null;

	constructor(complete_history: CodeAgentHistory[], usage_summary: UsageSummary | null) {
		this._complete_history = complete_history;
		this._usage_summary = usage_summary;
	}

	/**Get the raw history list.*/
	get history(): CodeAgentHistory[] {
		return this._complete_history;
	}

	/**Get the usage summary.*/
	get usage(): UsageSummary | null {
		return this._usage_summary;
	}

	/**Return the number of history items.*/
	length(): number {
		return this._complete_history.length;
	}

	/**Representation of the CodeAgentHistoryList object.*/
	toString(): string {
		return `CodeAgentHistoryList(steps=${this._complete_history.length}, action_results=${this.action_results().length})`;
	}

	/**Final result from history.*/
	final_result(): string | null {
		if (this._complete_history.length > 0 && this._complete_history[this._complete_history.length - 1].result.length > 0) {
			return this._complete_history[this._complete_history.length - 1].result[this._complete_history[this._complete_history.length - 1].result.length - 1]
				.extracted_content;
		}
		return null;
	}

	/**Check if the agent is done.*/
	is_done(): boolean {
		if (this._complete_history.length > 0 && this._complete_history[this._complete_history.length - 1].result.length > 0) {
			const lastResult = this._complete_history[this._complete_history.length - 1].result[
				this._complete_history[this._complete_history.length - 1].result.length - 1
			];
			return lastResult.is_done === true;
		}
		return false;
	}

	/**Check if the agent completed successfully.*/
	is_successful(): boolean | null {
		if (this._complete_history.length > 0 && this._complete_history[this._complete_history.length - 1].result.length > 0) {
			const lastResult = this._complete_history[this._complete_history.length - 1].result[
				this._complete_history[this._complete_history.length - 1].result.length - 1
			];
			if (lastResult.is_done === true) {
				return lastResult.success;
			}
		}
		return null;
	}

	/**Get all errors from history, with None for steps without errors.*/
	errors(): Array<string | null> {
		const errors: Array<string | null> = [];
		for (const h of this._complete_history) {
			const step_errors = h.result.filter((r) => r.error).map((r) => r.error);
			// each step can have only one error
			errors.push(step_errors.length > 0 ? step_errors[0] : null);
		}
		return errors;
	}

	/**Check if the agent has any non-None errors.*/
	has_errors(): boolean {
		return this.errors().some((error) => error !== null);
	}

	/**Get all URLs from history.*/
	urls(): Array<string | null> {
		return this._complete_history.map((h) => (h.state.url !== null ? h.state.url : null));
	}

	/**Get all screenshot paths from history.*/
	screenshot_paths(n_last: number | null = null, return_none_if_not_screenshot: boolean = true): Array<string | null> {
		if (n_last === 0) {
			return [];
		}
		const items = n_last === null ? this._complete_history : this._complete_history.slice(-n_last);
		if (return_none_if_not_screenshot) {
			return items.map((h) => (h.state.screenshot_path !== null ? h.state.screenshot_path : null));
		} else {
			return items.filter((h) => h.state.screenshot_path !== null).map((h) => h.state.screenshot_path!);
		}
	}

	/**Get all screenshots from history as base64 strings.*/
	screenshots(n_last: number | null = null, return_none_if_not_screenshot: boolean = true): Array<string | null> {
		if (n_last === 0) {
			return [];
		}
		const history_items = n_last === null ? this._complete_history : this._complete_history.slice(-n_last);
		const screenshots: Array<string | null> = [];
		for (const item of history_items) {
			const screenshot_b64 = (item.state as CodeAgentStateImpl).get_screenshot();
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

	/**Get all results from history.*/
	action_results(): CodeAgentResult[] {
		const results: CodeAgentResult[] = [];
		for (const h of this._complete_history) {
			results.push(...h.result.filter((r) => r));
		}
		return results;
	}

	/**Get all extracted content from history.*/
	extracted_content(): string[] {
		const content: string[] = [];
		for (const h of this._complete_history) {
			content.push(...h.result.filter((r) => r.extracted_content).map((r) => r.extracted_content!));
		}
		return content;
	}

	/**Get the number of steps in the history.*/
	number_of_steps(): number {
		return this._complete_history.length;
	}

	/**Get total duration of all steps in seconds.*/
	total_duration_seconds(): number {
		let total = 0.0;
		for (const h of this._complete_history) {
			if (h.metadata) {
				total += (h.metadata as CodeAgentStepMetadataImpl).duration_seconds;
			}
		}
		return total;
	}

	/**Last action in history - returns the last code execution.*/
	last_action(): Record<string, any> | null {
		if (this._complete_history.length > 0 && this._complete_history[this._complete_history.length - 1].model_output) {
			return {
				execute_code: {
					code: this._complete_history[this._complete_history.length - 1].model_output!.model_output,
					full_response: this._complete_history[this._complete_history.length - 1].model_output!.full_response,
				},
			};
		}
		return null;
	}

	/**Get all action names from history - returns 'execute_code' for each code execution.*/
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

	/**Get all thoughts from history - returns model_output for CodeAgent.*/
	model_thoughts(): CodeAgentModelOutput[] {
		return this._complete_history.filter((h) => h.model_output).map((h) => h.model_output!);
	}

	/**Get all model outputs from history.*/
	model_outputs(): CodeAgentModelOutput[] {
		return this._complete_history.filter((h) => h.model_output).map((h) => h.model_output!);
	}

	/**Get all actions from history - returns code execution actions with their code.*/
	model_actions(): Array<Record<string, any>> {
		const actions: Array<Record<string, any>> = [];
		for (const h of this._complete_history) {
			if (h.model_output) {
				// Create one action dict per result (code execution)
				for (const _ of h.result) {
					const action_dict = {
						execute_code: {
							code: h.model_output.model_output,
							full_response: h.model_output.full_response,
						},
					};
					actions.push(action_dict);
				}
			}
		}
		return actions;
	}

	/**Get truncated action history grouped by step.*/
	action_history(): Array<Array<Record<string, any>>> {
		const step_outputs: Array<Array<Record<string, any>>> = [];
		for (const h of this._complete_history) {
			const step_actions: Array<Record<string, any>> = [];
			if (h.model_output) {
				for (const result of h.result) {
					const action_dict = {
						execute_code: {
							code: h.model_output.model_output,
						},
						result: {
							extracted_content: result.extracted_content,
							is_done: result.is_done,
							success: result.success,
							error: result.error,
						},
					};
					step_actions.push(action_dict);
				}
			}
			step_outputs.push(step_actions);
		}
		return step_outputs;
	}

	/**Get all model actions from history filtered - returns empty for CodeAgent.*/
	model_actions_filtered(_include: string[] | null = null): Array<Record<string, any>> {
		return [];
	}

	/**Add a history item to the list.*/
	add_item(history_item: CodeAgentHistory): void {
		this._complete_history.push(history_item);
	}

	/**Custom serialization for CodeAgentHistoryList.*/
	model_dump(): Record<string, any> {
		return {
			history: this._complete_history.map((h) => (h as CodeAgentHistoryImpl).model_dump()),
			usage: this._usage_summary ? (this._usage_summary as any).model_dump() : null,
		};
	}

	/**Save history to JSON file.*/
	save_to_file(filepath: string | path.PlatformPath, _sensitive_data: Record<string, string | Record<string, string>> | null = null): void {
		try {
			const filePathObj = typeof filepath === 'string' ? path.resolve(filepath) : filepath;
			const dir = path.dirname(filePathObj);
			fs.mkdirSync(dir, { recursive: true });
			const data = this.model_dump();
			fs.writeFileSync(filePathObj, JSON.stringify(data, null, 2), 'utf-8');
		} catch (error) {
			throw error;
		}
	}
}
