/**
 * TypeScript implementation of message manager views
 * Converted from browser_use/agent/message_manager/views.py
 */

import type { BaseModel } from '../../llm/base';
import type { BaseMessage } from '../../llm/messages';

// ============================================================================
// HistoryItem
// ============================================================================

export interface HistoryItem extends BaseModel {
	/**Represents a single agent history item with its data and string representation*/
	step_number: number | null;
	evaluation_previous_goal: string | null;
	memory: string | null;
	next_goal: string | null;
	action_results: string | null;
	error: string | null;
	system_message: string | null;
}

export class HistoryItemImpl implements HistoryItem {
	step_number: number | null;
	evaluation_previous_goal: string | null;
	memory: string | null;
	next_goal: string | null;
	action_results: string | null;
	error: string | null;
	system_message: string | null;

	constructor(
		step_number: number | null = null,
		evaluation_previous_goal: string | null = null,
		memory: string | null = null,
		next_goal: string | null = null,
		action_results: string | null = null,
		error: string | null = null,
		system_message: string | null = null
	) {
		this.step_number = step_number;
		this.evaluation_previous_goal = evaluation_previous_goal;
		this.memory = memory;
		this.next_goal = next_goal;
		this.action_results = action_results;
		this.error = error;
		this.system_message = system_message;

		// Validate that error and system_message are not both provided
		if (this.error !== null && this.system_message !== null) {
			throw new Error('Cannot have both error and system_message at the same time');
		}
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				step_number: { type: ['number', 'null'] },
				evaluation_previous_goal: { type: ['string', 'null'] },
				memory: { type: ['string', 'null'] },
				next_goal: { type: ['string', 'null'] },
				action_results: { type: ['string', 'null'] },
				error: { type: ['string', 'null'] },
				system_message: { type: ['string', 'null'] },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new HistoryItemImpl(
			data.step_number ?? null,
			data.evaluation_previous_goal ?? null,
			data.memory ?? null,
			data.next_goal ?? null,
			data.action_results ?? null,
			data.error ?? null,
			data.system_message ?? null
		) as this;
	}

	/**Get string representation of the history item*/
	to_string(): string {
		const step_str = this.step_number !== null ? 'step' : 'step_unknown';

		if (this.error) {
			return `<${step_str}>
${this.error}`;
		} else if (this.system_message) {
			return this.system_message;
		} else {
			const content_parts: string[] = [];

			// Only include evaluation_previous_goal if it's not None/empty
			if (this.evaluation_previous_goal) {
				content_parts.push(this.evaluation_previous_goal);
			}

			// Always include memory
			if (this.memory) {
				content_parts.push(this.memory);
			}

			// Only include next_goal if it's not None/empty
			if (this.next_goal) {
				content_parts.push(this.next_goal);
			}

			if (this.action_results) {
				content_parts.push(this.action_results);
			}

			const content = content_parts.join('\n');

			return `<${step_str}>
${content}`;
		}
	}
}

// ============================================================================
// MessageHistory
// ============================================================================

export interface MessageHistory extends BaseModel {
	/**History of messages*/
	system_message: BaseMessage | null;
	state_message: BaseMessage | null;
	context_messages: BaseMessage[];
}

export class MessageHistoryImpl implements MessageHistory {
	system_message: BaseMessage | null;
	state_message: BaseMessage | null;
	context_messages: BaseMessage[];

	constructor(
		system_message: BaseMessage | null = null,
		state_message: BaseMessage | null = null,
		context_messages: BaseMessage[] = []
	) {
		this.system_message = system_message;
		this.state_message = state_message;
		this.context_messages = context_messages;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				system_message: { type: ['object', 'null'] },
				state_message: { type: ['object', 'null'] },
				context_messages: { type: 'array', items: { type: 'object' } },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new MessageHistoryImpl(
			data.system_message ?? null,
			data.state_message ?? null,
			data.context_messages ?? []
		) as this;
	}

	/**Get all messages in the correct order: system -> state -> contextual*/
	get_messages(): BaseMessage[] {
		const messages: BaseMessage[] = [];
		if (this.system_message) {
			messages.push(this.system_message);
		}
		if (this.state_message) {
			messages.push(this.state_message);
		}
		messages.push(...this.context_messages);
		return messages;
	}
}

// ============================================================================
// MessageManagerState
// ============================================================================

export interface MessageManagerState extends BaseModel {
	/**Holds the state for MessageManager*/
	history: MessageHistory;
	tool_id: number;
	agent_history_items: HistoryItem[];
	read_state_description: string;
	// Images to include in the next state message (cleared after each step)
	read_state_images: Array<Record<string, any>>;
}

export class MessageManagerStateImpl implements MessageManagerState {
	history: MessageHistory;
	tool_id: number;
	agent_history_items: HistoryItem[];
	read_state_description: string;
	read_state_images: Array<Record<string, any>>;

	constructor(
		history: MessageHistory = new MessageHistoryImpl(),
		tool_id: number = 1,
		agent_history_items: HistoryItem[] = [new HistoryItemImpl(0, null, null, null, null, null, 'Agent initialized')],
		read_state_description: string = '',
		read_state_images: Array<Record<string, any>> = []
	) {
		this.history = history;
		this.tool_id = tool_id;
		this.agent_history_items = agent_history_items;
		this.read_state_description = read_state_description;
		this.read_state_images = read_state_images;
	}

	model_json_schema(): Record<string, any> {
		return {
			type: 'object',
			properties: {
				history: { type: 'object' },
				tool_id: { type: 'number' },
				agent_history_items: { type: 'array', items: { type: 'object' } },
				read_state_description: { type: 'string' },
				read_state_images: { type: 'array', items: { type: 'object' } },
			},
		};
	}

	model_validate_json(json: string): this {
		const data = JSON.parse(json);
		return new MessageManagerStateImpl(
			data.history ? new MessageHistoryImpl().model_validate_json(JSON.stringify(data.history)) : new MessageHistoryImpl(),
			data.tool_id ?? 1,
			(data.agent_history_items || []).map((item: any) =>
				new HistoryItemImpl().model_validate_json(JSON.stringify(item))
			),
			data.read_state_description ?? '',
			data.read_state_images ?? []
		) as this;
	}
}
