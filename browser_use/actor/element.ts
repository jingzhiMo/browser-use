/**
 * TypeScript implementation of element operations
 * Converted from browser_use/actor/element.py
 */

import type { BrowserSession } from '../browser/session';

// Type definitions for element operations
export type ModifierType = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface Position {
	/**2D position coordinates.*/
	x: number;
	y: number;
}

export interface BoundingBox {
	/**Element bounding box with position and dimensions.*/
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ElementInfo {
	/**Basic information about a DOM element.*/
	backendNodeId: number;
	nodeId: number | null;
	nodeName: string;
	nodeType: number;
	nodeValue: string | null;
	attributes: Record<string, string>;
	boundingBox: BoundingBox | null;
	error: string | null;
}

// Type definitions for CDP commands
type MouseButton = 'left' | 'right' | 'middle';

interface PushNodesByBackendIdsToFrontendParameters {
	backendNodeIds: number[];
}

interface ResolveNodeParameters {
	nodeId: number;
}

interface FocusParameters {
	nodeId: number;
}

interface GetAttributesParameters {
	nodeId: number;
}

interface GetBoxModelParameters {
	nodeId: number;
}

interface RequestChildNodesParameters {
	nodeId: number;
	depth?: number;
}

interface DescribeNodeParameters {
	nodeId: number;
	depth?: number;
}

interface DispatchMouseEventParameters {
	type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
	x: number;
	y: number;
	button?: MouseButton;
	clickCount?: number;
	modifiers?: number;
	deltaX?: number;
	deltaY?: number;
}

interface DispatchKeyEventParameters {
	type: 'keyDown' | 'keyUp' | 'char';
	key?: string;
	code?: string;
	windowsVirtualKeyCode?: number;
	modifiers?: number;
	text?: string;
}

interface CallFunctionOnParameters {
	functionDeclaration: string;
	objectId: string;
	returnByValue?: boolean;
	awaitPromise?: boolean;
	arguments?: Array<{ value: any }>;
}

interface CaptureScreenshotParameters {
	format: string;
	quality?: number;
	clip?: {
		x: number;
		y: number;
		width: number;
		height: number;
		scale: number;
	};
}

/**
 * Element operations using BackendNodeId.
 */
export class Element {
	private _browser_session: BrowserSession;
	private _client: any; // CDP client
	private _backend_node_id: number;
	private _session_id: string | null;

	constructor(browser_session: BrowserSession, backend_node_id: number, session_id: string | null = null) {
		this._browser_session = browser_session;
		this._client = browser_session.cdp_client;
		this._backend_node_id = backend_node_id;
		this._session_id = session_id;
	}

	/**
	 * Get DOM node ID from backend node ID.
	 */
	private async _get_node_id(): Promise<number> {
		const params: PushNodesByBackendIdsToFrontendParameters = { backendNodeIds: [this._backend_node_id] };
		const result = await this._client.send.DOM.pushNodesByBackendIdsToFrontend(params, this._session_id);
		return result['nodeIds'][0];
	}

	/**
	 * Get remote object ID for this element.
	 */
	private async _get_remote_object_id(): Promise<string | null> {
		const node_id = await this._get_node_id();
		const params: ResolveNodeParameters = { nodeId: node_id };
		const result = await this._client.send.DOM.resolveNode(params, this._session_id);
		const object_id = result['object']?.['objectId'] || null;

		return object_id;
	}

	/**
	 * Click the element using the advanced watchdog implementation.
	 */
	async click(button: MouseButton = 'left', click_count: number = 1, modifiers: ModifierType[] | null = null): Promise<void> {
		try {
			// Get viewport dimensions for visibility checks
			const layout_metrics = await this._client.send.Page.getLayoutMetrics(this._session_id);
			const viewport_width = layout_metrics['layoutViewport']['clientWidth'];
			const viewport_height = layout_metrics['layoutViewport']['clientHeight'];

			// Try multiple methods to get element geometry
			let quads: number[][] = [];

			// Method 1: Try DOM.getContentQuads first (best for inline elements and complex layouts)
			try {
				const content_quads_result = await this._client.send.DOM.getContentQuads(
					{ backendNodeId: this._backend_node_id },
					this._session_id
				);
				if (content_quads_result['quads'] && content_quads_result['quads'].length > 0) {
					quads = content_quads_result['quads'];
				}
			} catch (error) {
				// Fall through
			}

			// Method 2: Fall back to DOM.getBoxModel
			if (quads.length === 0) {
				try {
					const box_model = await this._client.send.DOM.getBoxModel(
						{ backendNodeId: this._backend_node_id },
						this._session_id
					);
					if (box_model['model'] && box_model['model']['content']) {
						const content_quad = box_model['model']['content'];
						if (content_quad.length >= 8) {
							// Convert box model format to quad format
							quads = [
								[
									content_quad[0],
									content_quad[1], // x1, y1
									content_quad[2],
									content_quad[3], // x2, y2
									content_quad[4],
									content_quad[5], // x3, y3
									content_quad[6],
									content_quad[7], // x4, y4
								],
							];
						}
					}
				} catch (error) {
					// Fall through
				}
			}

			// Method 3: Fall back to JavaScript getBoundingClientRect
			if (quads.length === 0) {
				try {
					const result = await this._client.send.DOM.resolveNode(
						{ backendNodeId: this._backend_node_id },
						this._session_id
					);
					if (result['object'] && result['object']['objectId']) {
						const object_id = result['object']['objectId'];

						// Get bounding rect via JavaScript
						const bounds_result = await this._client.send.Runtime.callFunctionOn(
							{
								functionDeclaration: `
									function() {
										const rect = this.getBoundingClientRect();
										return {
											x: rect.left,
											y: rect.top,
											width: rect.width,
											height: rect.height
										};
									}
								`,
								objectId: object_id,
								returnByValue: true,
							},
							this._session_id
						);

						if (bounds_result['result'] && bounds_result['result']['value']) {
							const rect = bounds_result['result']['value'];
							// Convert rect to quad format
							const x = rect['x'];
							const y = rect['y'];
							const w = rect['width'];
							const h = rect['height'];
							quads = [
								[
									x,
									y, // top-left
									x + w,
									y, // top-right
									x + w,
									y + h, // bottom-right
									x,
									y + h, // bottom-left
								],
							];
						}
					}
				} catch (error) {
					// Fall through
				}
			}

			// If we still don't have quads, fall back to JS click
			if (quads.length === 0) {
				try {
					const result = await this._client.send.DOM.resolveNode(
						{ backendNodeId: this._backend_node_id },
						this._session_id
					);
					if (!result['object'] || !result['object']['objectId']) {
						throw new Error('Failed to find DOM element based on backendNodeId, maybe page content changed?');
					}
					const object_id = result['object']['objectId'];

					await this._client.send.Runtime.callFunctionOn(
						{
							functionDeclaration: 'function() { this.click(); }',
							objectId: object_id,
						},
						this._session_id
					);
					await new Promise((resolve) => setTimeout(resolve, 50));
					return;
				} catch (js_e) {
					throw new Error(`Failed to click element: ${js_e}`);
				}
			}

			// Find the largest visible quad within the viewport
			let best_quad: number[] | null = null;
			let best_area = 0;

			for (const quad of quads) {
				if (quad.length < 8) {
					continue;
				}

				// Calculate quad bounds
				const xs = [quad[0], quad[2], quad[4], quad[6]];
				const ys = [quad[1], quad[3], quad[5], quad[7]];
				const min_x = Math.min(...xs);
				const max_x = Math.max(...xs);
				const min_y = Math.min(...ys);
				const max_y = Math.max(...ys);

				// Check if quad intersects with viewport
				if (max_x < 0 || max_y < 0 || min_x > viewport_width || min_y > viewport_height) {
					continue; // Quad is completely outside viewport
				}

				// Calculate visible area (intersection with viewport)
				const visible_min_x = Math.max(0, min_x);
				const visible_max_x = Math.min(viewport_width, max_x);
				const visible_min_y = Math.max(0, min_y);
				const visible_max_y = Math.min(viewport_height, max_y);

				const visible_width = visible_max_x - visible_min_x;
				const visible_height = visible_max_y - visible_min_y;
				const visible_area = visible_width * visible_height;

				if (visible_area > best_area) {
					best_area = visible_area;
					best_quad = quad;
				}
			}

			if (!best_quad) {
				// No visible quad found, use the first quad anyway
				best_quad = quads[0];
			}

			// Calculate center point of the best quad
			const center_x = best_quad.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / 4;
			const center_y = best_quad.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / 4;

			// Ensure click point is within viewport bounds
			const final_x = Math.max(0, Math.min(viewport_width - 1, center_x));
			const final_y = Math.max(0, Math.min(viewport_height - 1, center_y));

			// Scroll element into view
			try {
				await this._client.send.DOM.scrollIntoViewIfNeeded(
					{ backendNodeId: this._backend_node_id },
					this._session_id
				);
				await new Promise((resolve) => setTimeout(resolve, 50)); // Wait for scroll to complete
			} catch (error) {
				// Ignore scroll errors
			}

			// Calculate modifier bitmask for CDP
			let modifier_value = 0;
			if (modifiers) {
				const modifier_map: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
				for (const mod of modifiers) {
					modifier_value |= modifier_map[mod] || 0;
				}
			}

			// Perform the click using CDP
			try {
				// Move mouse to element
				await this._client.send.Input.dispatchMouseEvent(
					{
						type: 'mouseMoved',
						x: final_x,
						y: final_y,
					},
					this._session_id
				);
				await new Promise((resolve) => setTimeout(resolve, 50));

				// Mouse down
				try {
					await Promise.race([
						this._client.send.Input.dispatchMouseEvent(
							{
								type: 'mousePressed',
								x: final_x,
								y: final_y,
								button,
								clickCount: click_count,
								modifiers: modifier_value,
							},
							this._session_id
						),
						new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000)),
					]);
					await new Promise((resolve) => setTimeout(resolve, 80));
				} catch (error) {
					// Don't sleep if we timed out
				}

				// Mouse up
				try {
					await Promise.race([
						this._client.send.Input.dispatchMouseEvent(
							{
								type: 'mouseReleased',
								x: final_x,
								y: final_y,
								button,
								clickCount: click_count,
								modifiers: modifier_value,
							},
							this._session_id
						),
						new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
					]);
				} catch (error) {
					// Ignore timeout
				}
			} catch (e) {
				// Fall back to JavaScript click via CDP
				try {
					const result = await this._client.send.DOM.resolveNode(
						{ backendNodeId: this._backend_node_id },
						this._session_id
					);
					if (!result['object'] || !result['object']['objectId']) {
						throw new Error('Failed to find DOM element based on backendNodeId, maybe page content changed?');
					}
					const object_id = result['object']['objectId'];

					await this._client.send.Runtime.callFunctionOn(
						{
							functionDeclaration: 'function() { this.click(); }',
							objectId: object_id,
						},
						this._session_id
					);
					await new Promise((resolve) => setTimeout(resolve, 100));
					return;
				} catch (js_e) {
					throw new Error(`Failed to click element: ${e}`);
				}
			}
		} catch (e) {
			// Extract key element info for error message
			throw new Error(`Failed to click element: ${e}`);
		}
	}

	/**
	 * Fill the input element using proper CDP methods with improved focus handling.
	 */
	async fill(value: string, clear: boolean = true): Promise<void> {
		try {
			// Use the existing CDP client and session
			const cdp_client = this._client;
			const session_id = this._session_id;
			const backend_node_id = this._backend_node_id;

			if (!session_id) {
				throw new Error('Session ID is required for fill operation');
			}

			// Track coordinates for metadata
			let input_coordinates: { input_x: number; input_y: number } | null = null;

			// Scroll element into view
			try {
				await cdp_client.send.DOM.scrollIntoViewIfNeeded({ backendNodeId: backend_node_id }, session_id);
				await new Promise((resolve) => setTimeout(resolve, 10));
			} catch (e) {
				console.warn(`Failed to scroll element into view: ${e}`);
			}

			// Get object ID for the element
			const result = await cdp_client.send.DOM.resolveNode({ backendNodeId: backend_node_id }, session_id);
			if (!result['object'] || !result['object']['objectId']) {
				throw new Error('Failed to get object ID for element');
			}
			const object_id = result['object']['objectId'];

			// Get element coordinates for focus
			try {
				const bounds_result = await cdp_client.send.Runtime.callFunctionOn(
					{
						functionDeclaration: 'function() { return this.getBoundingClientRect(); }',
						objectId: object_id,
						returnByValue: true,
					},
					session_id
				);
				if (bounds_result['result']?.['value']) {
					const bounds = bounds_result['result']['value'];
					const center_x = bounds['x'] + bounds['width'] / 2;
					const center_y = bounds['y'] + bounds['height'] / 2;
					input_coordinates = { input_x: center_x, input_y: center_y };
					console.debug(`Using element coordinates: x=${center_x.toFixed(1)}, y=${center_y.toFixed(1)}`);
				}
			} catch (e) {
				console.debug(`Could not get element coordinates: ${e}`);
			}

			// Step 1: Focus the element
			const focused_successfully = await this._focus_element_simple(
				backend_node_id,
				object_id,
				cdp_client,
				session_id,
				input_coordinates
			);

			// Step 2: Clear existing text if requested
			if (clear) {
				const cleared_successfully = await this._clear_text_field(object_id, cdp_client, session_id);
				if (!cleared_successfully) {
					console.warn('Text field clearing failed, typing may append to existing text');
				}
			}

			// Step 3: Type the text character by character using proper human-like key events
			console.debug(`Typing text character by character: "${value}"`);

			for (let i = 0; i < value.length; i++) {
				const char = value[i];
				// Handle newline characters as Enter key
				if (char === '\n') {
					// Send proper Enter key sequence
					await cdp_client.send.Input.dispatchKeyEvent(
						{
							type: 'keyDown',
							key: 'Enter',
							code: 'Enter',
							windowsVirtualKeyCode: 13,
						},
						session_id
					);

					// Small delay to emulate human typing speed
					await new Promise((resolve) => setTimeout(resolve, 1));

					// Send char event with carriage return
					await cdp_client.send.Input.dispatchKeyEvent(
						{
							type: 'char',
							text: '\r',
							key: 'Enter',
						},
						session_id
					);

					// Send keyUp event
					await cdp_client.send.Input.dispatchKeyEvent(
						{
							type: 'keyUp',
							key: 'Enter',
							code: 'Enter',
							windowsVirtualKeyCode: 13,
						},
						session_id
					);
				} else {
					// Handle regular characters
					// Get proper modifiers, VK code, and base key for the character
					const [modifiers, vk_code, base_key] = this._get_char_modifiers_and_vk(char);
					const key_code = this._get_key_code_for_char(base_key);

					// Step 1: Send keyDown event (NO text parameter)
					await cdp_client.send.Input.dispatchKeyEvent(
						{
							type: 'keyDown',
							key: base_key,
							code: key_code,
							modifiers,
							windowsVirtualKeyCode: vk_code,
						},
						session_id
					);

					// Small delay to emulate human typing speed
					await new Promise((resolve) => setTimeout(resolve, 1));

					// Step 2: Send char event (WITH text parameter) - this is crucial for text input
					await cdp_client.send.Input.dispatchKeyEvent(
						{
							type: 'char',
							text: char,
							key: char,
						},
						session_id
					);

					// Step 3: Send keyUp event (NO text parameter)
					await cdp_client.send.Input.dispatchKeyEvent(
						{
							type: 'keyUp',
							key: base_key,
							code: key_code,
							modifiers,
							windowsVirtualKeyCode: vk_code,
						},
						session_id
					);
				}

				// Add 18ms delay between keystrokes
				await new Promise((resolve) => setTimeout(resolve, 18));
			}
		} catch (e) {
			throw new Error(`Failed to fill element: ${String(e)}`);
		}
	}

	/**
	 * Hover over the element.
	 */
	async hover(): Promise<void> {
		const box = await this.get_bounding_box();
		if (!box) {
			throw new Error('Element is not visible or has no bounding box');
		}

		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;

		const params: DispatchMouseEventParameters = { type: 'mouseMoved', x, y };
		await this._client.send.Input.dispatchMouseEvent(params, this._session_id);
	}

	/**
	 * Focus the element.
	 */
	async focus(): Promise<void> {
		const node_id = await this._get_node_id();
		const params: FocusParameters = { nodeId: node_id };
		await this._client.send.DOM.focus(params, this._session_id);
	}

	/**
	 * Check or uncheck a checkbox/radio button.
	 */
	async check(): Promise<void> {
		await this.click();
	}

	/**
	 * Select option(s) in a select element.
	 */
	async select_option(values: string | string[]): Promise<void> {
		const values_list = Array.isArray(values) ? values : [values];

		// Focus the element first
		try {
			await this.focus();
		} catch (error) {
			console.warn('Failed to focus element');
		}

		// For select elements, we need to find option elements and click them
		// This is a simplified approach - in practice, you might need to handle
		// different select types (single vs multi-select) differently
		const node_id = await this._get_node_id();

		// Request child nodes to get the options
		const params: RequestChildNodesParameters = { nodeId: node_id, depth: 1 };
		await this._client.send.DOM.requestChildNodes(params, this._session_id);

		// Get the updated node description with children
		const describe_params: DescribeNodeParameters = { nodeId: node_id, depth: 1 };
		const describe_result = await this._client.send.DOM.describeNode(describe_params, this._session_id);

		const select_node = describe_result['node'];

		// Find and select matching options
		const children = select_node['children'] || [];
		for (const child of children) {
			if (child['nodeName']?.toLowerCase() === 'option') {
				// Get option attributes
				const attrs = child['attributes'] || [];
				const option_attrs: Record<string, string> = {};
				for (let i = 0; i < attrs.length; i += 2) {
					if (i + 1 < attrs.length) {
						option_attrs[attrs[i]] = attrs[i + 1];
					}
				}

				const option_value = option_attrs['value'] || '';
				const option_text = child['nodeValue'] || '';

				// Check if this option should be selected
				const should_select = values_list.includes(option_value) || values_list.includes(option_text);

				if (should_select) {
					// Click the option to select it
					const option_node_id = child['nodeId'];
					if (option_node_id) {
						// Get backend node ID for the option
						const option_describe_params: DescribeNodeParameters = { nodeId: option_node_id };
						const option_backend_result = await this._client.send.DOM.describeNode(
							option_describe_params,
							this._session_id
						);
						const option_backend_id = option_backend_result['node']['backendNodeId'];

						// Create an Element for the option and click it
						const option_element = new Element(this._browser_session, option_backend_id, this._session_id);
						await option_element.click();
					}
				}
			}
		}
	}

	/**
	 * Drag this element to another element or position.
	 */
	async drag_to(
		target: Element | Position,
		source_position: Position | null = null,
		target_position: Position | null = null
	): Promise<void> {
		// Get source coordinates
		let source_x: number;
		let source_y: number;
		if (source_position) {
			source_x = source_position.x;
			source_y = source_position.y;
		} else {
			const source_box = await this.get_bounding_box();
			if (!source_box) {
				throw new Error('Source element is not visible');
			}
			source_x = source_box.x + source_box.width / 2;
			source_y = source_box.y + source_box.height / 2;
		}

		// Get target coordinates
		let target_x: number;
		let target_y: number;
		if ('x' in target && 'y' in target && !('get_bounding_box' in target)) {
			// target is a Position
			target_x = target.x;
			target_y = target.y;
		} else {
			// target is an Element
			const target_element = target as Element;
			if (target_position) {
				const target_box = await target_element.get_bounding_box();
				if (!target_box) {
					throw new Error('Target element is not visible');
				}
				target_x = target_box.x + target_position.x;
				target_y = target_box.y + target_position.y;
			} else {
				const target_box = await target_element.get_bounding_box();
				if (!target_box) {
					throw new Error('Target element is not visible');
				}
				target_x = target_box.x + target_box.width / 2;
				target_y = target_box.y + target_box.height / 2;
			}
		}

		// Perform drag operation
		await this._client.send.Input.dispatchMouseEvent(
			{ type: 'mousePressed', x: source_x, y: source_y, button: 'left' },
			this._session_id
		);

		await this._client.send.Input.dispatchMouseEvent({ type: 'mouseMoved', x: target_x, y: target_y }, this._session_id);

		await this._client.send.Input.dispatchMouseEvent(
			{ type: 'mouseReleased', x: target_x, y: target_y, button: 'left' },
			this._session_id
		);
	}

	/**
	 * Get an attribute value.
	 */
	async get_attribute(name: string): Promise<string | null> {
		const node_id = await this._get_node_id();
		const params: GetAttributesParameters = { nodeId: node_id };
		const result = await this._client.send.DOM.getAttributes(params, this._session_id);

		const attributes = result['attributes'];
		for (let i = 0; i < attributes.length; i += 2) {
			if (attributes[i] === name) {
				return attributes[i + 1];
			}
		}
		return null;
	}

	/**
	 * Get the bounding box of the element.
	 */
	async get_bounding_box(): Promise<BoundingBox | null> {
		try {
			const node_id = await this._get_node_id();
			const params: GetBoxModelParameters = { nodeId: node_id };
			const result = await this._client.send.DOM.getBoxModel(params, this._session_id);

			if (!result['model']) {
				return null;
			}

			// Get content box (first 8 values are content quad: x1,y1,x2,y2,x3,y3,x4,y4)
			const content = result['model']['content'];
			if (content.length < 8) {
				return null;
			}

			// Calculate bounding box from quad
			const x_coords = [content[0], content[2], content[4], content[6]];
			const y_coords = [content[1], content[3], content[5], content[7]];

			const x = Math.min(...x_coords);
			const y = Math.min(...y_coords);
			const width = Math.max(...x_coords) - x;
			const height = Math.max(...y_coords) - y;

			return { x, y, width, height };
		} catch (error) {
			return null;
		}
	}

	/**
	 * Take a screenshot of this element and return base64 encoded image.
	 *
	 * @param format - Image format ('jpeg', 'png', 'webp')
	 * @param quality - Quality 0-100 for JPEG format
	 * @returns Base64-encoded image data
	 */
	async screenshot(format: string = 'png', quality: number | null = null): Promise<string> {
		// Get element's bounding box
		const box = await this.get_bounding_box();
		if (!box) {
			throw new Error('Element is not visible or has no bounding box');
		}

		// Create viewport clip for the element
		const viewport = {
			x: box.x,
			y: box.y,
			width: box.width,
			height: box.height,
			scale: 1.0,
		};

		// Prepare screenshot parameters
		const params: CaptureScreenshotParameters = { format, clip: viewport };

		if (quality !== null && format.toLowerCase() === 'jpeg') {
			params.quality = quality;
		}

		// Take screenshot
		const result = await this._client.send.Page.captureScreenshot(params, this._session_id);

		return result['data'];
	}

	/**
	 * Execute JavaScript code in the context of this element.
	 *
	 * The JavaScript code executes with 'this' bound to the element, allowing direct
	 * access to element properties and methods.
	 *
	 * @param page_function - JavaScript code that MUST start with (...args) => format
	 * @param args - Arguments to pass to the function
	 * @returns String representation of the JavaScript execution result.
	 *          Objects and arrays are JSON-stringified.
	 */
	async evaluate(page_function: string, ...args: any[]): Promise<string> {
		// Get remote object ID for this element
		const object_id = await this._get_remote_object_id();
		if (!object_id) {
			throw new Error('Element has no remote object ID (element may be detached from DOM)');
		}

		// Validate arrow function format (allow async prefix)
		page_function = page_function.trim();
		// Check for arrow function with optional async prefix
		if (!(page_function.includes('=>') && (page_function.startsWith('(') || page_function.startsWith('async')))) {
			throw new Error(
				`JavaScript code must start with (...args) => or async (...args) => format. Got: ${page_function.slice(0, 50)}...`
			);
		}

		// Convert arrow function to function declaration for CallFunctionOn
		// CallFunctionOn expects 'function(...args) { ... }' format, not arrow functions
		// We need to convert: '() => expression' to 'function() { return expression; }'
		// or: '(x, y) => { statements }' to 'function(x, y) { statements }'

		// Extract parameters and body from arrow function
		// Check if it's an async arrow function
		const is_async = page_function.trim().startsWith('async');
		const async_prefix = is_async ? 'async ' : '';

		// Match: (params) => body  or  async (params) => body
		// Strip 'async' prefix if present for parsing
		let func_to_parse = page_function.trim();
		if (is_async) {
			func_to_parse = func_to_parse.slice(5).trim(); // Remove 'async' prefix
		}

		const arrow_match = func_to_parse.match(/\s*\(([^)]*)\)\s*=>\s*(.+)/s);
		if (!arrow_match) {
			throw new Error(`Could not parse arrow function: ${page_function.slice(0, 50)}...`);
		}

		const params_str = arrow_match[1].trim(); // e.g., '', 'x', 'x, y'
		let body = arrow_match[2].trim();

		// If body doesn't start with {, it's an expression that needs implicit return
		let function_declaration: string;
		if (!body.startsWith('{')) {
			function_declaration = `${async_prefix}function(${params_str}) { return ${body}; }`;
		} else {
			// Body already has braces, use as-is
			function_declaration = `${async_prefix}function(${params_str}) ${body}`;
		}

		// Build CallArgument list for args if provided
		const call_arguments: Array<{ value: any }> = [];
		if (args.length > 0) {
			for (const arg of args) {
				// Convert Python values to CallArgument format
				call_arguments.push({ value: arg });
			}
		}

		// Prepare CallFunctionOn parameters
		const params: CallFunctionOnParameters = {
			functionDeclaration: function_declaration,
			objectId: object_id,
			returnByValue: true,
			awaitPromise: true,
		};

		if (call_arguments.length > 0) {
			params.arguments = call_arguments;
		}

		// Execute the function on the element
		const result = await this._client.send.Runtime.callFunctionOn(params, this._session_id);

		// Handle exceptions
		if ('exceptionDetails' in result) {
			throw new Error(`JavaScript evaluation failed: ${JSON.stringify(result['exceptionDetails'])}`);
		}

		// Extract and return value
		const value = result['result']?.['value'];

		// Return string representation (matching Page.evaluate behavior)
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
	 * Get modifiers, virtual key code, and base key for a character.
	 *
	 * @returns [modifiers, windowsVirtualKeyCode, base_key]
	 */
	private _get_char_modifiers_and_vk(char: string): [number, number, string] {
		// Characters that require Shift modifier
		const shift_chars: Record<string, [string, number]> = {
			'!': ['1', 49],
			'@': ['2', 50],
			'#': ['3', 51],
			$: ['4', 52],
			'%': ['5', 53],
			'^': ['6', 54],
			'&': ['7', 55],
			'*': ['8', 56],
			'(': ['9', 57],
			')': ['0', 48],
			_: ['-', 189],
			'+': ['=', 187],
			'{': ['[', 219],
			'}': [']', 221],
			'|': ['\\', 220],
			':': [';', 186],
			'"': ["'", 222],
			'<': [',', 188],
			'>': ['.', 190],
			'?': ['/', 191],
			'~': ['`', 192],
		};

		// Check if character requires Shift
		if (char in shift_chars) {
			const [base_key, vk_code] = shift_chars[char];
			return [8, vk_code, base_key]; // Shift=8
		}

		// Uppercase letters require Shift
		if (char === char.toUpperCase() && char !== char.toLowerCase()) {
			return [8, char.charCodeAt(0), char.toLowerCase()]; // Shift=8
		}

		// Lowercase letters
		if (char === char.toLowerCase() && char !== char.toUpperCase()) {
			return [0, char.toUpperCase().charCodeAt(0), char];
		}

		// Numbers
		if (/\d/.test(char)) {
			return [0, char.charCodeAt(0), char];
		}

		// Special characters without Shift
		const no_shift_chars: Record<string, number> = {
			' ': 32,
			'-': 189,
			'=': 187,
			'[': 219,
			']': 221,
			'\\': 220,
			';': 186,
			"'": 222,
			',': 188,
			'.': 190,
			'/': 191,
			'`': 192,
		};

		if (char in no_shift_chars) {
			return [0, no_shift_chars[char], char];
		}

		// Fallback
		return [0, char.toUpperCase().charCodeAt(0), char];
	}

	/**
	 * Get the proper key code for a character (like Playwright does).
	 */
	private _get_key_code_for_char(char: string): string {
		// Key code mapping for common characters (using proper base keys + modifiers)
		const key_codes: Record<string, string> = {
			' ': 'Space',
			'.': 'Period',
			',': 'Comma',
			'-': 'Minus',
			_: 'Minus', // Underscore uses Minus with Shift
			'@': 'Digit2', // @ uses Digit2 with Shift
			'!': 'Digit1', // ! uses Digit1 with Shift (not 'Exclamation')
			'?': 'Slash', // ? uses Slash with Shift
			':': 'Semicolon', // : uses Semicolon with Shift
			';': 'Semicolon',
			'(': 'Digit9', // ( uses Digit9 with Shift
			')': 'Digit0', // ) uses Digit0 with Shift
			'[': 'BracketLeft',
			']': 'BracketRight',
			'{': 'BracketLeft', // { uses BracketLeft with Shift
			'}': 'BracketRight', // } uses BracketRight with Shift
			'/': 'Slash',
			'\\': 'Backslash',
			'=': 'Equal',
			'+': 'Equal', // + uses Equal with Shift
			'*': 'Digit8', // * uses Digit8 with Shift
			'&': 'Digit7', // & uses Digit7 with Shift
			'%': 'Digit5', // % uses Digit5 with Shift
			$: 'Digit4', // $ uses Digit4 with Shift
			'#': 'Digit3', // # uses Digit3 with Shift
			'^': 'Digit6', // ^ uses Digit6 with Shift
			'~': 'Backquote', // ~ uses Backquote with Shift
			'`': 'Backquote',
			'"': 'Quote', // " uses Quote with Shift
			"'": 'Quote',
			'<': 'Comma', // < uses Comma with Shift
			'>': 'Period', // > uses Period with Shift
			'|': 'Backslash', // | uses Backslash with Shift
		};

		if (char in key_codes) {
			return key_codes[char];
		} else if (/[a-zA-Z]/.test(char)) {
			return `Key${char.toUpperCase()}`;
		} else if (/\d/.test(char)) {
			return `Digit${char}`;
		} else {
			// Fallback for unknown characters
			return /[a-zA-Z]/.test(char) ? `Key${char.toUpperCase()}` : 'Unidentified';
		}
	}

	/**
	 * Clear text field using multiple strategies, starting with the most reliable.
	 */
	private async _clear_text_field(object_id: string, cdp_client: any, session_id: string): Promise<boolean> {
		try {
			// Strategy 1: Direct JavaScript value setting (most reliable for modern web apps)
			console.debug('Clearing text field using JavaScript value setting');

			await cdp_client.send.Runtime.callFunctionOn(
				{
					functionDeclaration: `
						function() {
							// Try to select all text first (only works on text-like inputs)
							// This handles cases where cursor is in the middle of text
							try {
								this.select();
							} catch (e) {
								// Some input types (date, color, number, etc.) don't support select()
								// That's fine, we'll just clear the value directly
							}
							// Set value to empty
							this.value = "";
							// Dispatch events to notify frameworks like React
							this.dispatchEvent(new Event("input", { bubbles: true }));
							this.dispatchEvent(new Event("change", { bubbles: true }));
							return this.value;
						}
					`,
					objectId: object_id,
					returnByValue: true,
				},
				session_id
			);

			// Verify clearing worked by checking the value
			const verify_result = await cdp_client.send.Runtime.callFunctionOn(
				{
					functionDeclaration: 'function() { return this.value; }',
					objectId: object_id,
					returnByValue: true,
				},
				session_id
			);

			const current_value = verify_result['result']?.['value'] || '';
			if (!current_value) {
				console.debug('Text field cleared successfully using JavaScript');
				return true;
			} else {
				console.debug(`JavaScript clear partially failed, field still contains: "${current_value}"`);
			}
		} catch (e) {
			console.debug(`JavaScript clear failed: ${e}`);
		}

		// Strategy 2: Triple-click + Delete (fallback for stubborn fields)
		try {
			console.debug('Fallback: Clearing using triple-click + Delete');

			// Get element center coordinates for triple-click
			const bounds_result = await cdp_client.send.Runtime.callFunctionOn(
				{
					functionDeclaration: 'function() { return this.getBoundingClientRect(); }',
					objectId: object_id,
					returnByValue: true,
				},
				session_id
			);

			if (bounds_result['result']?.['value']) {
				const bounds = bounds_result['result']['value'];
				const center_x = bounds['x'] + bounds['width'] / 2;
				const center_y = bounds['y'] + bounds['height'] / 2;

				// Triple-click to select all text
				await cdp_client.send.Input.dispatchMouseEvent(
					{
						type: 'mousePressed',
						x: center_x,
						y: center_y,
						button: 'left',
						clickCount: 3,
					},
					session_id
				);
				await cdp_client.send.Input.dispatchMouseEvent(
					{
						type: 'mouseReleased',
						x: center_x,
						y: center_y,
						button: 'left',
						clickCount: 3,
					},
					session_id
				);

				// Delete selected text
				await cdp_client.send.Input.dispatchKeyEvent(
					{
						type: 'keyDown',
						key: 'Delete',
						code: 'Delete',
					},
					session_id
				);
				await cdp_client.send.Input.dispatchKeyEvent(
					{
						type: 'keyUp',
						key: 'Delete',
						code: 'Delete',
					},
					session_id
				);

				console.debug('Text field cleared using triple-click + Delete');
				return true;
			}
		} catch (e) {
			console.debug(`Triple-click clear failed: ${e}`);
		}

		// If all strategies failed
		console.warn('All text clearing strategies failed');
		return false;
	}

	/**
	 * Focus element using multiple strategies with robust fallbacks.
	 */
	private async _focus_element_simple(
		backend_node_id: number,
		object_id: string,
		cdp_client: any,
		session_id: string,
		input_coordinates: { input_x: number; input_y: number } | null = null
	): Promise<boolean> {
		try {
			// Strategy 1: CDP focus (most reliable)
			console.debug('Focusing element using CDP focus');
			await cdp_client.send.DOM.focus({ backendNodeId: backend_node_id }, session_id);
			console.debug('Element focused successfully using CDP focus');
			return true;
		} catch (e) {
			console.debug(`CDP focus failed: ${e}, trying JavaScript focus`);
		}

		try {
			// Strategy 2: JavaScript focus (fallback)
			console.debug('Focusing element using JavaScript focus');
			await cdp_client.send.Runtime.callFunctionOn(
				{
					functionDeclaration: 'function() { this.focus(); }',
					objectId: object_id,
				},
				session_id
			);
			console.debug('Element focused successfully using JavaScript');
			return true;
		} catch (e) {
			console.debug(`JavaScript focus failed: ${e}, trying click focus`);
		}

		try {
			// Strategy 3: Click to focus (last resort)
			if (input_coordinates) {
				console.debug(`Focusing element by clicking at coordinates: ${JSON.stringify(input_coordinates)}`);
				const center_x = input_coordinates.input_x;
				const center_y = input_coordinates.input_y;

				// Click on the element to focus it
				await cdp_client.send.Input.dispatchMouseEvent(
					{
						type: 'mousePressed',
						x: center_x,
						y: center_y,
						button: 'left',
						clickCount: 1,
					},
					session_id
				);
				await cdp_client.send.Input.dispatchMouseEvent(
					{
						type: 'mouseReleased',
						x: center_x,
						y: center_y,
						button: 'left',
						clickCount: 1,
					},
					session_id
				);
				console.debug('Element focused using click');
				return true;
			} else {
				console.debug('No coordinates available for click focus');
			}
		} catch (e) {
			console.warn(`All focus strategies failed: ${e}`);
		}
		return false;
	}

	/**
	 * Get basic information about the element including coordinates and properties.
	 */
	async get_basic_info(): Promise<ElementInfo> {
		try {
			// Get basic node information
			const node_id = await this._get_node_id();
			const describe_result = await this._client.send.DOM.describeNode({ nodeId: node_id }, this._session_id);

			const node_info = describe_result['node'];

			// Get bounding box
			const bounding_box = await this.get_bounding_box();

			// Get attributes as a proper dict
			const attributes_list = node_info['attributes'] || [];
			const attributes_dict: Record<string, string> = {};
			for (let i = 0; i < attributes_list.length; i += 2) {
				if (i + 1 < attributes_list.length) {
					attributes_dict[attributes_list[i]] = attributes_list[i + 1];
				}
			}

			return {
				backendNodeId: this._backend_node_id,
				nodeId: node_id,
				nodeName: node_info['nodeName'] || '',
				nodeType: node_info['nodeType'] || 0,
				nodeValue: node_info['nodeValue'] || null,
				attributes: attributes_dict,
				boundingBox: bounding_box,
				error: null,
			};
		} catch (e) {
			return {
				backendNodeId: this._backend_node_id,
				nodeId: null,
				nodeName: '',
				nodeType: 0,
				nodeValue: null,
				attributes: {},
				boundingBox: null,
				error: String(e),
			};
		}
	}
}
