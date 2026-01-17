/**
 * TypeScript implementation of browser views
 * Converted from browser_use/browser/views.py
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BaseModel } from '../llm/base';
import type { DOMInteractedElement, SerializedDOMState } from '../dom/views';

// Known placeholder image data for about:blank pages - a 4x4 white PNG
export const PLACEHOLDER_4PX_SCREENSHOT =
	'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGP8//8/AwwwMSAB3BwAlm4DBfIlvvkAAAAASUVORK5CYII=';

// ============================================================================
// TabInfo
// ============================================================================

export interface TabInfo extends BaseModel {
	/**Represents information about a browser tab*/
	url: string;
	title: string;
	target_id: string; // TargetID type from cdp_use
	parent_target_id: string | null; // parent page that contains this popup or cross-origin iframe
}

// ============================================================================
// PageInfo
// ============================================================================

export interface PageInfo extends BaseModel {
	/**Comprehensive page size and scroll information*/
	// Current viewport dimensions
	viewport_width: number;
	viewport_height: number;
	// Total page dimensions
	page_width: number;
	page_height: number;
	// Current scroll position
	scroll_x: number;
	scroll_y: number;
	// Calculated scroll information
	pixels_above: number;
	pixels_below: number;
	pixels_left: number;
	pixels_right: number;
	// Page statistics are now computed dynamically instead of stored
}

// ============================================================================
// NetworkRequest
// ============================================================================

export class NetworkRequest {
	/**Information about a pending network request*/
	url: string;
	method: string;
	loading_duration_ms: number; // How long this request has been loading (ms since request started, max 10s)
	resource_type: string | null; // e.g., 'Document', 'Stylesheet', 'Image', 'Script', 'XHR', 'Fetch'

	constructor(
		url: string,
		method: string = 'GET',
		loading_duration_ms: number = 0.0,
		resource_type: string | null = null
	) {
		this.url = url;
		this.method = method;
		this.loading_duration_ms = loading_duration_ms;
		this.resource_type = resource_type;
	}
}

// ============================================================================
// PaginationButton
// ============================================================================

export class PaginationButton {
	/**Information about a pagination button detected on the page*/
	button_type: string; // 'next', 'prev', 'first', 'last', 'page_number'
	backend_node_id: number; // Backend node ID for clicking
	text: string; // Button text/label
	selector: string; // XPath or other selector to locate the element
	is_disabled: boolean; // Whether the button appears disabled

	constructor(
		button_type: string,
		backend_node_id: number,
		text: string,
		selector: string,
		is_disabled: boolean = false
	) {
		this.button_type = button_type;
		this.backend_node_id = backend_node_id;
		this.text = text;
		this.selector = selector;
		this.is_disabled = is_disabled;
	}
}

// ============================================================================
// BrowserStateSummary
// ============================================================================

export class BrowserStateSummary {
	/**The summary of the browser's current state designed for an LLM to process*/
	// provided by SerializedDOMState:
	dom_state: SerializedDOMState;
	url: string;
	title: string;
	tabs: TabInfo[];
	screenshot: string | null;
	page_info: PageInfo | null; // Enhanced page information
	// Keep legacy fields for backward compatibility
	pixels_above: number;
	pixels_below: number;
	browser_errors: string[];
	is_pdf_viewer: boolean; // Whether the current page is a PDF viewer
	recent_events: string | null; // Text summary of recent browser events
	pending_network_requests: NetworkRequest[]; // Currently loading network requests
	pagination_buttons: PaginationButton[]; // Detected pagination buttons
	closed_popup_messages: string[]; // Messages from auto-closed JavaScript dialogs

	constructor(
		dom_state: SerializedDOMState,
		url: string,
		title: string,
		tabs: TabInfo[],
		screenshot: string | null = null,
		page_info: PageInfo | null = null,
		pixels_above: number = 0,
		pixels_below: number = 0,
		browser_errors: string[] = [],
		is_pdf_viewer: boolean = false,
		recent_events: string | null = null,
		pending_network_requests: NetworkRequest[] = [],
		pagination_buttons: PaginationButton[] = [],
		closed_popup_messages: string[] = []
	) {
		this.dom_state = dom_state;
		this.url = url;
		this.title = title;
		this.tabs = tabs;
		this.screenshot = screenshot;
		this.page_info = page_info;
		this.pixels_above = pixels_above;
		this.pixels_below = pixels_below;
		this.browser_errors = browser_errors;
		this.is_pdf_viewer = is_pdf_viewer;
		this.recent_events = recent_events;
		this.pending_network_requests = pending_network_requests;
		this.pagination_buttons = pagination_buttons;
		this.closed_popup_messages = closed_popup_messages;
	}
}

// ============================================================================
// BrowserStateHistory
// ============================================================================

export class BrowserStateHistory {
	/**The summary of the browser's state at a past point in time to use in LLM message history*/
	url: string;
	title: string;
	tabs: TabInfo[];
	interacted_element: (DOMInteractedElement | null)[];
	screenshot_path: string | null;

	constructor(
		url: string,
		title: string,
		tabs: TabInfo[],
		interacted_element: (DOMInteractedElement | null)[],
		screenshot_path: string | null = null
	) {
		this.url = url;
		this.title = title;
		this.tabs = tabs;
		this.interacted_element = interacted_element;
		this.screenshot_path = screenshot_path;
	}

	/**Load screenshot from disk and return as base64 string*/
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

	to_dict(): Record<string, any> {
		const data: Record<string, any> = {};
		data['tabs'] = this.tabs.map((tab) => {
			// Simplified - would need proper model_dump for TabInfo
			return {
				url: tab.url,
				title: tab.title,
				target_id: tab.target_id,
				parent_target_id: tab.parent_target_id,
			};
		});
		data['screenshot_path'] = this.screenshot_path;
		data['interacted_element'] = this.interacted_element.map((el) => (el ? el.to_dict() : null));
		data['url'] = this.url;
		data['title'] = this.title;
		return data;
	}
}

// ============================================================================
// BrowserError
// ============================================================================

export class BrowserError extends Error {
	/**Browser error with structured memory for LLM context management.

	This exception class provides separate memory contexts for browser actions:
	- short_term_memory: Immediate context shown once to the LLM for the next action
	- long_term_memory: Persistent error information stored across steps
	*/
	message: string;
	short_term_memory: string | null;
	long_term_memory: string | null;
	details: Record<string, any> | null;
	while_handling_event: any | null; // BaseEvent[Any] type from bubus

	constructor(
		message: string,
		short_term_memory: string | null = null,
		long_term_memory: string | null = null,
		details: Record<string, any> | null = null,
		event: any | null = null
	) {
		/**Initialize a BrowserError with structured memory contexts.

		Args:
			message: Technical error message for logging and debugging
			short_term_memory: Context shown once to LLM (e.g., available actions, options)
			long_term_memory: Persistent error info stored in agent memory
			details: Additional metadata for debugging
			event: The browser event that triggered this error
		*/
		super(message);
		this.message = message;
		this.short_term_memory = short_term_memory;
		this.long_term_memory = long_term_memory;
		this.details = details;
		this.while_handling_event = event;
	}

	toString(): string {
		if (this.details) {
			return `${this.message} (${JSON.stringify(this.details)}) during: ${this.while_handling_event}`;
		} else if (this.while_handling_event) {
			return `${this.message} (while handling: ${this.while_handling_event})`;
		} else {
			return this.message;
		}
	}
}

// ============================================================================
// URLNotAllowedError
// ============================================================================

export class URLNotAllowedError extends BrowserError {
	/**Error raised when a URL is not allowed*/
	constructor(message: string, short_term_memory?: string | null, long_term_memory?: string | null) {
		super(message, short_term_memory, long_term_memory);
	}
}
