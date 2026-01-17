/**
 * TypeScript implementation of cloud events
 * Converted from browser_use/agent/cloud_events.py
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Constants
export const MAX_STRING_LENGTH = 100000; // 100K chars ~ 25k tokens should be enough
export const MAX_URL_LENGTH = 100000;
export const MAX_TASK_LENGTH = 100000;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_FILE_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB

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
// BaseEvent (from bubus)
// ============================================================================

export interface BaseEvent {
	// Base event interface - would be defined in bubus package
}

// ============================================================================
// UpdateAgentTaskEvent
// ============================================================================

export class UpdateAgentTaskEvent implements BaseEvent {
	// Required fields for identification
	id: string; // The task ID to update
	user_id: string; // For authorization
	device_id: string | null; // Device ID for auth lookup

	// Optional fields that can be updated
	stopped: boolean | null;
	paused: boolean | null;
	done_output: string | null;
	finished_at: Date | null;
	agent_state: Record<string, any> | null;
	user_feedback_type: string | null; // UserFeedbackType enum value as string
	user_comment: string | null;
	gif_url: string | null;

	constructor(
		id: string,
		user_id: string,
		device_id: string | null = null,
		stopped: boolean | null = null,
		paused: boolean | null = null,
		done_output: string | null = null,
		finished_at: Date | null = null,
		agent_state: Record<string, any> | null = null,
		user_feedback_type: string | null = null,
		user_comment: string | null = null,
		gif_url: string | null = null
	) {
		this.id = id;
		this.user_id = user_id;
		this.device_id = device_id;
		this.stopped = stopped;
		this.paused = paused;
		this.done_output = done_output;
		this.finished_at = finished_at;
		this.agent_state = agent_state;
		this.user_feedback_type = user_feedback_type;
		this.user_comment = user_comment;
		this.gif_url = gif_url;
	}

	/**Create an UpdateAgentTaskEvent from an Agent instance*/
	static from_agent(agent: any): UpdateAgentTaskEvent {
		if (!agent._task_start_time) {
			throw new Error('Agent must have _task_start_time attribute');
		}

		const done_output = agent.history?.final_result() || null;
		return new UpdateAgentTaskEvent(
			String(agent.task_id),
			'', // To be filled by cloud handler
			agent.cloud_sync?.auth_client?.device_id || null,
			agent.state?.stopped || false,
			agent.state?.paused || false,
			done_output,
			agent.history && agent.history.is_done() ? new Date() : null,
			agent.state?.model_dump ? agent.state.model_dump() : {},
			null,
			null,
			null
		);
	}
}

// ============================================================================
// CreateAgentOutputFileEvent
// ============================================================================

export class CreateAgentOutputFileEvent implements BaseEvent {
	// Model fields
	id: string;
	user_id: string;
	device_id: string | null; // Device ID for auth lookup
	task_id: string;
	file_name: string;
	file_content: string | null; // Base64 encoded file content
	content_type: string | null; // MIME type for file uploads
	created_at: Date;

	constructor(
		id: string,
		user_id: string,
		task_id: string,
		file_name: string,
		device_id: string | null = null,
		file_content: string | null = null,
		content_type: string | null = null,
		created_at: Date = new Date()
	) {
		this.id = id;
		this.user_id = user_id;
		this.device_id = device_id;
		this.task_id = task_id;
		this.file_name = file_name;
		this.file_content = this.validate_file_size(file_content);
		this.content_type = content_type;
		this.created_at = created_at;
	}

	/**Validate base64 file content size.*/
	private validate_file_size(v: string | null): string | null {
		if (v === null) {
			return v;
		}
		// Remove data URL prefix if present
		let content = v;
		if (content.includes(',')) {
			content = content.split(',')[1];
		}
		// Estimate decoded size (base64 is ~33% larger)
		const estimated_size = (content.length * 3) / 4;
		if (estimated_size > MAX_FILE_CONTENT_SIZE) {
			throw new Error(
				`File content exceeds maximum size of ${MAX_FILE_CONTENT_SIZE / 1024 / 1024}MB`
			);
		}
		return v;
	}

	/**Create a CreateAgentOutputFileEvent from a file path*/
	static async from_agent_and_file(agent: any, output_path: string): Promise<CreateAgentOutputFileEvent> {
		const gif_path = path.resolve(output_path);
		
		// Check if file exists
		try {
			await fs.access(gif_path);
		} catch (error) {
			throw new Error(`File not found: ${output_path}`);
		}
		
		const stats = await fs.stat(gif_path);
		const gif_size = stats.size;
		
		let gif_content: string | null = null;
		if (gif_size < 50 * 1024 * 1024) {
			// Only read if < 50MB
			const gif_bytes = await fs.readFile(gif_path);
			gif_content = Buffer.from(gif_bytes).toString('base64');
		}
		
		return new CreateAgentOutputFileEvent(
			uuid7str(),
			'',
			String(agent.task_id),
			path.basename(gif_path),
			agent.cloud_sync?.auth_client?.device_id || null,
			gif_content,
			'image/gif'
		);
	}
}

// ============================================================================
// CreateAgentStepEvent
// ============================================================================

export class CreateAgentStepEvent implements BaseEvent {
	// Model fields
	id: string;
	user_id: string; // Added for authorization checks
	device_id: string | null; // Device ID for auth lookup
	created_at: Date;
	agent_task_id: string;
	step: number;
	evaluation_previous_goal: string;
	memory: string;
	next_goal: string;
	actions: Record<string, any>[];
	screenshot_url: string | null; // ~50MB for base64 images
	url: string;

	constructor(
		id: string,
		user_id: string,
		agent_task_id: string,
		step: number,
		evaluation_previous_goal: string,
		memory: string,
		next_goal: string,
		actions: Record<string, any>[],
		url: string = '',
		device_id: string | null = null,
		screenshot_url: string | null = null,
		created_at: Date = new Date()
	) {
		this.id = id;
		this.user_id = user_id;
		this.device_id = device_id;
		this.created_at = created_at;
		this.agent_task_id = agent_task_id;
		this.step = step;
		this.evaluation_previous_goal = evaluation_previous_goal;
		this.memory = memory;
		this.next_goal = next_goal;
		this.actions = actions;
		this.screenshot_url = this.validate_screenshot_size(screenshot_url);
		this.url = url;
	}

	/**Validate screenshot URL or base64 content size.*/
	private validate_screenshot_size(v: string | null): string | null {
		if (v === null || !v.startsWith('data:')) {
			return v;
		}
		// It's base64 data, check size
		if (v.includes(',')) {
			const base64_part = v.split(',')[1];
			const estimated_size = (base64_part.length * 3) / 4;
			if (estimated_size > MAX_FILE_CONTENT_SIZE) {
				throw new Error(
					`Screenshot content exceeds maximum size of ${MAX_FILE_CONTENT_SIZE / 1024 / 1024}MB`
				);
			}
		}
		return v;
	}

	/**Create a CreateAgentStepEvent from agent step data*/
	static from_agent_step(
		agent: any,
		model_output: any,
		result: any[],
		actions_data: Record<string, any>[],
		browser_state_summary: any
	): CreateAgentStepEvent {
		// Get first action details if available
		const first_action = model_output.action && model_output.action.length > 0 ? model_output.action[0] : null;

		// Extract current state from model output
		const current_state = model_output.current_state || null;

		// Capture screenshot as base64 data URL if available
		let screenshot_url: string | null = null;
		if (browser_state_summary.screenshot) {
			screenshot_url = `data:image/png;base64,${browser_state_summary.screenshot}`;
		}

		return new CreateAgentStepEvent(
			'', // id would be generated by uuid7str
			'', // To be filled by cloud handler
			String(agent.task_id),
			agent.state.n_steps,
			current_state?.evaluation_previous_goal || '',
			current_state?.memory || '',
			current_state?.next_goal || '',
			actions_data,
			browser_state_summary.url,
			agent.cloud_sync?.auth_client?.device_id || null,
			screenshot_url
		);
	}
}

// ============================================================================
// CreateAgentTaskEvent
// ============================================================================

export class CreateAgentTaskEvent implements BaseEvent {
	// Model fields
	id: string;
	user_id: string; // Added for authorization checks
	device_id: string | null; // Device ID for auth lookup
	agent_session_id: string;
	llm_model: string; // LLMModel enum value as string
	stopped: boolean;
	paused: boolean;
	task: string;
	done_output: string | null;
	scheduled_task_id: string | null;
	started_at: Date;
	finished_at: Date | null;
	agent_state: Record<string, any>;
	user_feedback_type: string | null; // UserFeedbackType enum value as string
	user_comment: string | null;
	gif_url: string | null;

	constructor(
		id: string,
		user_id: string,
		agent_session_id: string,
		task: string,
		llm_model: string,
		device_id: string | null = null,
		stopped: boolean = false,
		paused: boolean = false,
		done_output: string | null = null,
		scheduled_task_id: string | null = null,
		started_at: Date = new Date(),
		finished_at: Date | null = null,
		agent_state: Record<string, any> = {},
		user_feedback_type: string | null = null,
		user_comment: string | null = null,
		gif_url: string | null = null
	) {
		this.id = id;
		this.user_id = user_id;
		this.device_id = device_id;
		this.agent_session_id = agent_session_id;
		this.llm_model = llm_model;
		this.stopped = stopped;
		this.paused = paused;
		this.task = task;
		this.done_output = done_output;
		this.scheduled_task_id = scheduled_task_id;
		this.started_at = started_at;
		this.finished_at = finished_at;
		this.agent_state = agent_state;
		this.user_feedback_type = user_feedback_type;
		this.user_comment = user_comment;
		this.gif_url = gif_url;
	}

	/**Create a CreateAgentTaskEvent from an Agent instance*/
	static from_agent(agent: any): CreateAgentTaskEvent {
		return new CreateAgentTaskEvent(
			String(agent.task_id),
			'', // To be filled by cloud handler
			String(agent.session_id),
			agent.task,
			agent.llm.model_name,
			agent.cloud_sync?.auth_client?.device_id || null,
			false,
			false,
			null,
			null,
			new Date(agent._task_start_time * 1000), // Convert timestamp to Date
			null,
			agent.state?.model_dump ? agent.state.model_dump() : {},
			null,
			null,
			null
		);
	}
}

// ============================================================================
// CreateAgentSessionEvent
// ============================================================================

export class CreateAgentSessionEvent implements BaseEvent {
	// Model fields
	id: string;
	user_id: string;
	device_id: string | null; // Device ID for auth lookup
	browser_session_id: string;
	browser_session_live_url: string;
	browser_session_cdp_url: string;
	browser_session_stopped: boolean;
	browser_session_stopped_at: Date | null;
	is_source_api: boolean | null;
	browser_state: Record<string, any>;
	browser_session_data: Record<string, any> | null;

	constructor(
		id: string,
		user_id: string,
		browser_session_id: string,
		browser_session_live_url: string,
		browser_session_cdp_url: string,
		device_id: string | null = null,
		browser_session_stopped: boolean = false,
		browser_session_stopped_at: Date | null = null,
		is_source_api: boolean | null = null,
		browser_state: Record<string, any> = {},
		browser_session_data: Record<string, any> | null = null
	) {
		this.id = id;
		this.user_id = user_id;
		this.device_id = device_id;
		this.browser_session_id = browser_session_id;
		this.browser_session_live_url = browser_session_live_url;
		this.browser_session_cdp_url = browser_session_cdp_url;
		this.browser_session_stopped = browser_session_stopped;
		this.browser_session_stopped_at = browser_session_stopped_at;
		this.is_source_api = is_source_api;
		this.browser_state = browser_state;
		this.browser_session_data = browser_session_data;
	}

	/**Create a CreateAgentSessionEvent from an Agent instance*/
	static from_agent(agent: any): CreateAgentSessionEvent {
		return new CreateAgentSessionEvent(
			String(agent.session_id),
			'', // To be filled by cloud handler
			agent.browser_session.id,
			'', // To be filled by cloud handler
			'', // To be filled by cloud handler
			agent.cloud_sync?.auth_client?.device_id || null,
			false,
			null,
			null,
			{
				viewport: agent.browser_profile?.viewport || { width: 1280, height: 720 },
				user_agent: agent.browser_profile?.user_agent || null,
				headless: agent.browser_profile?.headless || true,
				initial_url: null,
				final_url: null,
				total_pages_visited: 0,
				session_duration_seconds: 0,
			},
			{
				cookies: [],
				secrets: {},
				allowed_domains: agent.browser_profile?.allowed_domains || [],
			}
		);
	}
}

// ============================================================================
// UpdateAgentSessionEvent
// ============================================================================

export class UpdateAgentSessionEvent implements BaseEvent {
	/**Event to update an existing agent session*/

	// Model fields
	id: string; // Session ID to update
	user_id: string;
	device_id: string | null;
	browser_session_stopped: boolean | null;
	browser_session_stopped_at: Date | null;
	end_reason: string | null; // Why the session ended

	constructor(
		id: string,
		user_id: string,
		device_id: string | null = null,
		browser_session_stopped: boolean | null = null,
		browser_session_stopped_at: Date | null = null,
		end_reason: string | null = null
	) {
		this.id = id;
		this.user_id = user_id;
		this.device_id = device_id;
		this.browser_session_stopped = browser_session_stopped;
		this.browser_session_stopped_at = browser_session_stopped_at;
		this.end_reason = end_reason;
	}
}
