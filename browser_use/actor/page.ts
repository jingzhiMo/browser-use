/**
 * TypeScript implementation of page operations
 * Converted from browser_use/actor/page.py
 */

import type { BrowserSession } from '../browser/session';
import type { BaseChatModel } from '../llm/base';
import type { BaseModel } from '../llm/base';
import { SystemMessage, UserMessage } from '../llm/messages';
import { get_key_info } from './utils';
import { Mouse } from './mouse';
import type { Element } from './element';

// Type definitions for CDP commands
interface AttachToTargetParameters {
	targetId: string;
	flatten: boolean;
}

interface GetTargetInfoParameters {
	targetId: string;
}

interface NavigateParameters {
	url: string;
}

interface NavigateToHistoryEntryParameters {
	entryId: number;
}

interface CaptureScreenshotParameters {
	format: string;
	quality?: number;
}

interface DispatchKeyEventParameters {
	type: 'keyDown' | 'keyUp' | 'char';
	key?: string;
	code?: string;
	windowsVirtualKeyCode?: number;
	modifiers?: number;
}

interface EvaluateParameters {
	expression: string;
	returnByValue?: boolean;
	awaitPromise?: boolean;
}

interface SetDeviceMetricsOverrideParameters {
	width: number;
	height: number;
	deviceScaleFactor: number;
	mobile: boolean;
}

interface DescribeNodeParameters {
	nodeId: number;
}

interface QuerySelectorAllParameters {
	nodeId: number;
	selector: string;
}

interface TargetInfo {
	url?: string;
	title?: string;
	[key: string]: any;
}

/**
 * Page operations (tab or iframe).
 */
export class Page {
	private _browser_session: BrowserSession;
	private _client: any; // CDP client
	private _target_id: string;
	private _session_id: string | null;
	private _mouse: Mouse | null = null;
	private _llm: BaseChatModel | null;

	constructor(
		browser_session: BrowserSession,
		target_id: string,
		session_id: string | null = null,
		llm: BaseChatModel | null = null
	) {
		this._browser_session = browser_session;
		this._client = browser_session.cdp_client;
		this._target_id = target_id;
		this._session_id = session_id;
		this._llm = llm;
	}

	/**
	 * Ensure we have a session ID for this target.
	 */
	private async _ensure_session(): Promise<string> {
		if (!this._session_id) {
			const params: AttachToTargetParameters = { targetId: this._target_id, flatten: true };
			const result = await this._client.send.Target.attachToTarget(params);
			this._session_id = result['sessionId'];

			// Enable necessary domains
			await Promise.all([
				this._client.send.Page.enable(this._session_id),
				this._client.send.DOM.enable(this._session_id),
				this._client.send.Runtime.enable(this._session_id),
				this._client.send.Network.enable(this._session_id),
			]);
		}

		return this._session_id;
	}

	/**
	 * Get the session ID for this target.
	 * @dev Pass this to an arbitrary CDP call
	 */
	async get_session_id(): Promise<string> {
		return await this._ensure_session();
	}

	/**
	 * Get the mouse interface for this target.
	 */
	async get_mouse(): Promise<Mouse> {
		if (!this._mouse) {
			const session_id = await this._ensure_session();
			this._mouse = new Mouse(this._browser_session, session_id, this._target_id);
		}
		return this._mouse;
	}

	/**
	 * Reload the target.
	 */
	async reload(): Promise<void> {
		const session_id = await this._ensure_session();
		await this._client.send.Page.reload(session_id);
	}

	/**
	 * Get an element by its backend node ID.
	 */
	async get_element(backend_node_id: number): Promise<Element> {
		const session_id = await this._ensure_session();
		// Dynamic import to avoid circular dependency
		const { Element: Element_ } = await import('./element');
		return new Element_(this._browser_session, backend_node_id, session_id);
	}

	/**
	 * Execute JavaScript in the target.
	 *
	 * @param page_function - JavaScript code that MUST start with (...args) => format
	 * @param args - Arguments to pass to the function
	 * @returns String representation of the JavaScript execution result.
	 *          Objects and arrays are JSON-stringified.
	 */
	async evaluate(page_function: string, ...args: any[]): Promise<string> {
		const session_id = await this._ensure_session();

		// Clean and fix common JavaScript string parsing issues
		page_function = this._fix_javascript_string(page_function);

		// Enforce arrow function format
		if (!(page_function.startsWith('(') && page_function.includes('=>'))) {
			throw new Error(
				`JavaScript code must start with (...args) => format. Got: ${page_function.slice(0, 50)}...`
			);
		}

		// Build the expression - call the arrow function with provided args
		let expression: string;
		if (args.length > 0) {
			// Convert args to JSON representation for safe passing
			const arg_strs = args.map((arg) => JSON.stringify(arg));
			expression = `(${page_function})(${arg_strs.join(', ')})`;
		} else {
			expression = `(${page_function})()`;
		}

		// Debug: log the actual expression being evaluated
		console.debug(`Evaluating JavaScript: ${JSON.stringify(expression)}`);

		const params: EvaluateParameters = { expression, returnByValue: true, awaitPromise: true };
		const result = await this._client.send.Runtime.evaluate(params, session_id);

		if ('exceptionDetails' in result) {
			throw new Error(`JavaScript evaluation failed: ${JSON.stringify(result['exceptionDetails'])}`);
		}

		const value = result['result']?.['value'];

		// Always return string representation
		if (value === null || value === undefined) {
			return '';
		} else if (typeof value === 'string') {
			return value;
		} else {
			// Convert objects, numbers, booleans to string
			try {
				return typeof value === 'object' ? JSON.stringify(value) : String(value);
			} catch (error) {
				return String(value);
			}
		}
	}

	/**
	 * Fix common JavaScript string parsing issues when written as Python string.
	 */
	private _fix_javascript_string(js_code: string): string {
		// Just do minimal, safe cleaning
		js_code = js_code.trim();

		// Only fix the most common and safe issues:

		// 1. Remove obvious Python string wrapper quotes if they exist
		if (
			(js_code.startsWith('"') && js_code.endsWith('"')) ||
			(js_code.startsWith("'") && js_code.endsWith("'"))
		) {
			// Check if it's a wrapped string (not part of JS syntax)
			const inner = js_code.slice(1, -1);
			if ((inner.match(/"/g) || []).length + (inner.match(/'/g) || []).length === 0 || inner.includes('() =>')) {
				js_code = inner;
			}
		}

		// 2. Only fix clearly escaped quotes that shouldn't be
		// But be very conservative - only if we're sure it's a Python string artifact
		if (js_code.includes('\\"') && (js_code.match(/\\"/g) || []).length > (js_code.match(/"/g) || []).length) {
			js_code = js_code.replace(/\\"/g, '"');
		}
		if (js_code.includes("\\'") && (js_code.match(/\\'/g) || []).length > (js_code.match(/'/g) || []).length) {
			js_code = js_code.replace(/\\'/g, "'");
		}

		// 3. Basic whitespace normalization only
		js_code = js_code.trim();

		// Final validation - ensure it's not empty
		if (!js_code) {
			throw new Error('JavaScript code is empty after cleaning');
		}

		return js_code;
	}

	/**
	 * Take a screenshot and return base64 encoded image.
	 *
	 * @param format - Image format ('jpeg', 'png', 'webp')
	 * @param quality - Quality 0-100 for JPEG format
	 * @returns Base64-encoded image data
	 */
	async screenshot(format: string = 'png', quality: number | null = null): Promise<string> {
		const session_id = await this._ensure_session();

		const params: CaptureScreenshotParameters = { format };

		if (quality !== null && format.toLowerCase() === 'jpeg') {
			params.quality = quality;
		}

		const result = await this._client.send.Page.captureScreenshot(params, session_id);

		return result['data'];
	}

	/**
	 * Press a key on the page (sends keyboard input to the focused element or page).
	 */
	async press(key: string): Promise<void> {
		const session_id = await this._ensure_session();

		// Handle key combinations like "Control+A"
		if (key.includes('+')) {
			const parts = key.split('+');
			const modifiers = parts.slice(0, -1);
			const main_key = parts[parts.length - 1];

			// Calculate modifier bitmask
			let modifier_value = 0;
			const modifier_map: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
			for (const mod of modifiers) {
				modifier_value |= modifier_map[mod] || 0;
			}

			// Press modifier keys
			for (const mod of modifiers) {
				const [code, vk_code] = get_key_info(mod);
				const params: DispatchKeyEventParameters = { type: 'keyDown', key: mod, code };
				if (vk_code !== null) {
					params.windowsVirtualKeyCode = vk_code;
				}
				await this._client.send.Input.dispatchKeyEvent(params, session_id);
			}

			// Press main key with modifiers bitmask
			const [main_code, main_vk_code] = get_key_info(main_key);
			const main_down_params: DispatchKeyEventParameters = {
				type: 'keyDown',
				key: main_key,
				code: main_code,
				modifiers: modifier_value,
			};
			if (main_vk_code !== null) {
				main_down_params.windowsVirtualKeyCode = main_vk_code;
			}
			await this._client.send.Input.dispatchKeyEvent(main_down_params, session_id);

			const main_up_params: DispatchKeyEventParameters = {
				type: 'keyUp',
				key: main_key,
				code: main_code,
				modifiers: modifier_value,
			};
			if (main_vk_code !== null) {
				main_up_params.windowsVirtualKeyCode = main_vk_code;
			}
			await this._client.send.Input.dispatchKeyEvent(main_up_params, session_id);

			// Release modifier keys
			for (const mod of modifiers.slice().reverse()) {
				const [code, vk_code] = get_key_info(mod);
				const release_params: DispatchKeyEventParameters = { type: 'keyUp', key: mod, code };
				if (vk_code !== null) {
					release_params.windowsVirtualKeyCode = vk_code;
				}
				await this._client.send.Input.dispatchKeyEvent(release_params, session_id);
			}
		} else {
			// Simple key press
			const [code, vk_code] = get_key_info(key);
			const key_down_params: DispatchKeyEventParameters = { type: 'keyDown', key, code };
			if (vk_code !== null) {
				key_down_params.windowsVirtualKeyCode = vk_code;
			}
			await this._client.send.Input.dispatchKeyEvent(key_down_params, session_id);

			const key_up_params: DispatchKeyEventParameters = { type: 'keyUp', key, code };
			if (vk_code !== null) {
				key_up_params.windowsVirtualKeyCode = vk_code;
			}
			await this._client.send.Input.dispatchKeyEvent(key_up_params, session_id);
		}
	}

	/**
	 * Set the viewport size.
	 */
	async set_viewport_size(width: number, height: number): Promise<void> {
		const session_id = await this._ensure_session();

		const params: SetDeviceMetricsOverrideParameters = {
			width,
			height,
			deviceScaleFactor: 1.0,
			mobile: false,
		};
		await this._client.send.Emulation.setDeviceMetricsOverride(params, session_id);
	}

	/**
	 * Get target information.
	 */
	async get_target_info(): Promise<TargetInfo> {
		const params: GetTargetInfoParameters = { targetId: this._target_id };
		const result = await this._client.send.Target.getTargetInfo(params);
		return result['targetInfo'];
	}

	/**
	 * Get the current URL.
	 */
	async get_url(): Promise<string> {
		const info = await this.get_target_info();
		return info.url || '';
	}

	/**
	 * Get the current title.
	 */
	async get_title(): Promise<string> {
		const info = await this.get_target_info();
		return info.title || '';
	}

	/**
	 * Navigate this target to a URL.
	 */
	async goto(url: string): Promise<void> {
		const session_id = await this._ensure_session();

		const params: NavigateParameters = { url };
		await this._client.send.Page.navigate(params, session_id);
	}

	/**
	 * Alias for goto.
	 */
	async navigate(url: string): Promise<void> {
		await this.goto(url);
	}

	/**
	 * Navigate back in history.
	 */
	async go_back(): Promise<void> {
		const session_id = await this._ensure_session();

		try {
			// Get navigation history
			const history = await this._client.send.Page.getNavigationHistory(session_id);
			const current_index = history['currentIndex'];
			const entries = history['entries'];

			// Check if we can go back
			if (current_index <= 0) {
				throw new Error('Cannot go back - no previous entry in history');
			}

			// Navigate to the previous entry
			const previous_entry_id = entries[current_index - 1]['id'];
			const params: NavigateToHistoryEntryParameters = { entryId: previous_entry_id };
			await this._client.send.Page.navigateToHistoryEntry(params, session_id);
		} catch (error) {
			throw new Error(`Failed to navigate back: ${error}`);
		}
	}

	/**
	 * Navigate forward in history.
	 */
	async go_forward(): Promise<void> {
		const session_id = await this._ensure_session();

		try {
			// Get navigation history
			const history = await this._client.send.Page.getNavigationHistory(session_id);
			const current_index = history['currentIndex'];
			const entries = history['entries'];

			// Check if we can go forward
			if (current_index >= entries.length - 1) {
				throw new Error('Cannot go forward - no next entry in history');
			}

			// Navigate to the next entry
			const next_entry_id = entries[current_index + 1]['id'];
			const params: NavigateToHistoryEntryParameters = { entryId: next_entry_id };
			await this._client.send.Page.navigateToHistoryEntry(params, session_id);
		} catch (error) {
			throw new Error(`Failed to navigate forward: ${error}`);
		}
	}

	/**
	 * Get elements by CSS selector.
	 */
	async get_elements_by_css_selector(selector: string): Promise<Element[]> {
		const session_id = await this._ensure_session();

		// Get document first
		const doc_result = await this._client.send.DOM.getDocument(session_id);
		const document_node_id = doc_result['root']['nodeId'];

		// Query selector all
		const query_params: QuerySelectorAllParameters = { nodeId: document_node_id, selector };
		const result = await this._client.send.DOM.querySelectorAll(query_params, session_id);

		const elements: Element[] = [];
		// Dynamic import to avoid circular dependency
		const { Element: Element_ } = await import('./element');

		// Convert node IDs to backend node IDs
		for (const node_id of result['nodeIds']) {
			// Get backend node ID
			const describe_params: DescribeNodeParameters = { nodeId: node_id };
			const node_result = await this._client.send.DOM.describeNode(describe_params, session_id);
			const backend_node_id = node_result['node']['backendNodeId'];
			elements.push(new Element_(this._browser_session, backend_node_id, session_id));
		}

		return elements;
	}

	/**
	 * Get the DOM service for this target.
	 */
	get_dom_service(): any {
		// Dynamic import to avoid circular dependency
		// In TypeScript, we'll need to import DomService
		// For now, return a placeholder
		const { DomService } = require('../dom/service');
		return new DomService(this._browser_session);
	}

	/**
	 * Get an element by a prompt.
	 */
	async get_element_by_prompt(prompt: string, llm: BaseChatModel | null = null): Promise<Element | null> {
		await this._ensure_session();
		const effective_llm = llm || this._llm;

		if (!effective_llm) {
			throw new Error('LLM not provided');
		}

		const dom_service = this.get_dom_service();

		// Lazy fetch all_frames inside get_dom_tree if needed (for cross-origin iframes)
		const [enhanced_dom_tree] = await dom_service.get_dom_tree(this._target_id, null);

		const session_id = this._browser_session.id;
		const { DOMTreeSerializer } = await import('../dom/serializer/serializer');
		const [serialized_dom_state] = new DOMTreeSerializer(
			enhanced_dom_tree,
			null,
			true, // paint_order_filtering
			session_id
		).serialize_accessible_elements();

		const llm_representation = serialized_dom_state.llm_representation();

		const system_message = new SystemMessage(
			`You are an AI created to find an element on a page by a prompt.

<browser_state>
Interactive Elements: All interactive elements will be provided in format as [index]<type>text</type> where
- index: Numeric identifier for interaction
- type: HTML element type (button, input, etc.)
- text: Element description

Examples:
[33]<div>User form</div>
[35]<button aria-label='Submit form'>Submit</button>

Note that:
- Only elements with numeric indexes in [] are interactive
- (stacked) indentation (with \\t) is important and means that the element is a (html) child of the element above (with a lower index)
- Pure text elements without [] are not interactive.
</browser_state>

Your task is to find an element index (if any) that matches the prompt (written in <prompt> tag).

If non of the elements matches the, return None.

Before you return the element index, reason about the state and elements for a sentence or two.`
		);

		const state_message = new UserMessage(`
			<browser_state>
			${llm_representation}
			</browser_state>

			<prompt>
			${prompt}
			</prompt>
			`);

		interface ElementResponse extends BaseModel {
			element_highlight_index: number | null;
		}

		class ElementResponseImpl implements ElementResponse {
			element_highlight_index: number | null;

			constructor(element_highlight_index: number | null) {
				this.element_highlight_index = element_highlight_index;
			}

			model_json_schema(): Record<string, any> {
				return {
					type: 'object',
					properties: {
						element_highlight_index: { type: ['number', 'null'] },
					},
				};
			}

			model_validate_json(json: string): this {
				const data = JSON.parse(json);
				return new ElementResponseImpl(data.element_highlight_index || null) as this;
			}
		}

		const llm_response = await effective_llm.ainvoke([system_message, state_message], {
			output_format: ElementResponseImpl,
		} as any);

		const element_highlight_index = (llm_response.completion as ElementResponseImpl).element_highlight_index;

		if (
			element_highlight_index === null ||
			element_highlight_index === undefined ||
			!(element_highlight_index in serialized_dom_state.selector_map)
		) {
			return null;
		}

		const element = serialized_dom_state.selector_map[element_highlight_index];

		const { Element: Element_ } = await import('./element');

		return new Element_(this._browser_session, element.backend_node_id, this._session_id);
	}

	/**
	 * Get an element by a prompt.
	 * @dev LLM can still return None, this just raises an error if the element is not found.
	 */
	async must_get_element_by_prompt(prompt: string, llm: BaseChatModel | null = null): Promise<Element> {
		const element = await this.get_element_by_prompt(prompt, llm);
		if (element === null) {
			throw new Error(`No element found for prompt: ${prompt}`);
		}

		return element;
	}

	/**
	 * Extract structured content from the current page using LLM.
	 *
	 * Extracts clean markdown from the page and sends it to LLM for structured data extraction.
	 *
	 * @param prompt - Description of what content to extract
	 * @param structured_output - BaseModel class defining the expected output structure
	 * @param llm - Language model to use for extraction
	 * @returns The structured BaseModel instance with extracted content
	 */
	async extract_content<T extends BaseModel>(
		prompt: string,
		structured_output: new () => T,
		llm: BaseChatModel | null = null
	): Promise<T> {
		const effective_llm = llm || this._llm;

		if (!effective_llm) {
			throw new Error('LLM not provided');
		}

		// Extract clean markdown using the same method as in tools/service.py
		let content: string;
		let content_stats: Record<string, any>;
		try {
			[content, content_stats] = await this._extract_clean_markdown();
		} catch (error) {
			throw new Error(`Could not extract clean markdown: ${error}`);
		}

		// System prompt for structured extraction
		const system_prompt = `You are an expert at extracting structured data from the markdown of a webpage.

<input>
You will be given a query and the markdown of a webpage that has been filtered to remove noise and advertising content.
</input>

<instructions>
- You are tasked to extract information from the webpage that is relevant to the query.
- You should ONLY use the information available in the webpage to answer the query. Do not make up information or provide guess from your own knowledge.
- If the information relevant to the query is not available in the page, your response should mention that.
- If the query asks for all items, products, etc., make sure to directly list all of them.
- Return the extracted content in the exact structured format specified.
</instructions>

<output>
- Your output should present ALL the information relevant to the query in the specified structured format.
- Do not answer in conversational format - directly output the relevant information in the structured format.
</output>`.trim();

		// Build prompt with just query and content
		const prompt_content = `<query>\n${prompt}\n</query>\n\n<webpage_content>\n${content}\n</webpage_content>`;

		// Send to LLM with structured output
		try {
			const response = await Promise.race([
				effective_llm.ainvoke(
					[new SystemMessage(system_prompt), new UserMessage(prompt_content)],
					{ output_format: structured_output } as any
				),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 120000)),
			]);

			// Return the structured output BaseModel instance
			return response.completion as T;
		} catch (error) {
			throw new Error(String(error));
		}
	}

	/**
	 * Extract clean markdown from the current page using enhanced DOM tree.
	 *
	 * Uses the shared markdown extractor for consistency with tools/service.py.
	 */
	private async _extract_clean_markdown(extract_links: boolean = false): Promise<[string, Record<string, any>]> {
		const { extract_clean_markdown } = await import('../dom/markdown_extractor');

		const dom_service = this.get_dom_service();
		return await extract_clean_markdown(dom_service, this._target_id, extract_links);
	}
}
