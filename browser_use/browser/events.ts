/**
 * TypeScript implementation of browser events
 * Converted from browser_use/browser/events.py
 */

import type { BaseEvent } from 'bubus';
import type { TargetID } from 'cdp_use/cdp/target';
import type { BrowserStateSummary } from './views';
import type { EnhancedDOMTreeNode } from '../dom/views';

/**
 * Safely parse environment variable timeout values with robust error handling.
 *
 * Args:
 * 	env_var: Environment variable name (e.g. 'TIMEOUT_NavigateToUrlEvent')
 * 	default: Default timeout value as float (e.g. 15.0)
 *
 * Returns:
 * 	Parsed float value or the default if parsing fails
 */
function _get_timeout(env_var: string, default_value: number): number | null {
	// Try environment variable first
	const env_value = process.env[env_var];
	if (env_value) {
		try {
			const parsed = parseFloat(env_value);
			if (parsed < 0) {
				console.warn(`${env_var}=${env_value} is negative, using default ${default_value}`);
				return default_value;
			}
			return parsed;
		} catch (error) {
			console.warn(`${env_var}=${env_value} is not a valid number, using default ${default_value}`);
		}
	}

	// Fall back to default
	return default_value;
}

// ============================================================================
// Agent/Tools -> BrowserSession Events (High-level browser actions)
// ============================================================================

export class ElementSelectedEvent<T = any> implements BaseEvent {
	/**An element was selected.*/
	node: EnhancedDOMTreeNode;
	event_timeout: number | null;

	constructor(node: EnhancedDOMTreeNode, event_timeout: number | null = null) {
		this.node = node;
		this.event_timeout = event_timeout;
	}

	static serialize_node(data: EnhancedDOMTreeNode | null): EnhancedDOMTreeNode | null {
		if (data === null) {
			return null;
		}
		// Create a serialized version without circular references
		return {
			...data,
			content_document: null,
			shadow_root_type: null,
			shadow_roots: [],
			parent_node: null,
			children_nodes: [],
			ax_node: null,
			snapshot_node: null,
		} as EnhancedDOMTreeNode;
	}
}

export class NavigateToUrlEvent implements BaseEvent {
	/**Navigate to a specific URL.*/
	url: string;
	wait_until: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
	timeout_ms: number | null;
	new_tab: boolean;
	event_timeout: number | null;

	constructor(
		url: string,
		wait_until: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' = 'load',
		timeout_ms: number | null = null,
		new_tab: boolean = false,
		event_timeout: number | null = null
	) {
		this.url = url;
		this.wait_until = wait_until;
		this.timeout_ms = timeout_ms;
		this.new_tab = new_tab;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_NavigateToUrlEvent', 15.0);
	}
}

export class ClickElementEvent extends ElementSelectedEvent<Record<string, any> | null> {
	/**Click an element.*/
	node: EnhancedDOMTreeNode;
	button: 'left' | 'right' | 'middle';
	event_timeout: number | null;

	constructor(
		node: EnhancedDOMTreeNode,
		button: 'left' | 'right' | 'middle' = 'left',
		event_timeout: number | null = null
	) {
		super(node, event_timeout);
		this.node = node;
		this.button = button;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_ClickElementEvent', 15.0);
	}
}

export class ClickCoordinateEvent implements BaseEvent {
	/**Click at specific coordinates.*/
	coordinate_x: number;
	coordinate_y: number;
	button: 'left' | 'right' | 'middle';
	force: boolean;
	event_timeout: number | null;

	constructor(
		coordinate_x: number,
		coordinate_y: number,
		button: 'left' | 'right' | 'middle' = 'left',
		force: boolean = false,
		event_timeout: number | null = null
	) {
		this.coordinate_x = coordinate_x;
		this.coordinate_y = coordinate_y;
		this.button = button;
		this.force = force;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_ClickCoordinateEvent', 15.0);
	}
}

export class TypeTextEvent extends ElementSelectedEvent<Record<string, any> | null> {
	/**Type text into an element.*/
	node: EnhancedDOMTreeNode;
	text: string;
	clear: boolean;
	is_sensitive: boolean;
	sensitive_key_name: string | null;
	event_timeout: number | null;

	constructor(
		node: EnhancedDOMTreeNode,
		text: string,
		clear: boolean = true,
		is_sensitive: boolean = false,
		sensitive_key_name: string | null = null,
		event_timeout: number | null = null
	) {
		super(node, event_timeout);
		this.node = node;
		this.text = text;
		this.clear = clear;
		this.is_sensitive = is_sensitive;
		this.sensitive_key_name = sensitive_key_name;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_TypeTextEvent', 60.0);
	}
}

export class ScrollEvent extends ElementSelectedEvent<null> {
	/**Scroll the page or element.*/
	direction: 'up' | 'down' | 'left' | 'right';
	amount: number;
	node: EnhancedDOMTreeNode | null;
	event_timeout: number | null;

	constructor(
		direction: 'up' | 'down' | 'left' | 'right',
		amount: number,
		node: EnhancedDOMTreeNode | null = null,
		event_timeout: number | null = null
	) {
		super(node || ({} as EnhancedDOMTreeNode), event_timeout);
		this.direction = direction;
		this.amount = amount;
		this.node = node;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_ScrollEvent', 8.0);
	}
}

export class SwitchTabEvent implements BaseEvent {
	/**Switch to a different tab.*/
	target_id: TargetID | null;
	event_timeout: number | null;

	constructor(target_id: TargetID | null = null, event_timeout: number | null = null) {
		this.target_id = target_id;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_SwitchTabEvent', 10.0);
	}
}

export class CloseTabEvent implements BaseEvent {
	/**Close a tab.*/
	target_id: TargetID;
	event_timeout: number | null;

	constructor(target_id: TargetID, event_timeout: number | null = null) {
		this.target_id = target_id;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_CloseTabEvent', 10.0);
	}
}

export class ScreenshotEvent implements BaseEvent {
	/**Request to take a screenshot.*/
	full_page: boolean;
	clip: Record<string, number> | null;
	event_timeout: number | null;

	constructor(
		full_page: boolean = false,
		clip: Record<string, number> | null = null,
		event_timeout: number | null = null
	) {
		this.full_page = full_page;
		this.clip = clip;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_ScreenshotEvent', 15.0);
	}
}

export class BrowserStateRequestEvent implements BaseEvent {
	/**Request current browser state.*/
	include_dom: boolean;
	include_screenshot: boolean;
	include_recent_events: boolean;
	event_timeout: number | null;

	constructor(
		include_dom: boolean = true,
		include_screenshot: boolean = true,
		include_recent_events: boolean = false,
		event_timeout: number | null = null
	) {
		this.include_dom = include_dom;
		this.include_screenshot = include_screenshot;
		this.include_recent_events = include_recent_events;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserStateRequestEvent', 30.0);
	}
}

export class GoBackEvent implements BaseEvent {
	/**Navigate back in browser history.*/
	event_timeout: number | null;

	constructor(event_timeout: number | null = null) {
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_GoBackEvent', 15.0);
	}
}

export class GoForwardEvent implements BaseEvent {
	/**Navigate forward in browser history.*/
	event_timeout: number | null;

	constructor(event_timeout: number | null = null) {
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_GoForwardEvent', 15.0);
	}
}

export class RefreshEvent implements BaseEvent {
	/**Refresh/reload the current page.*/
	event_timeout: number | null;

	constructor(event_timeout: number | null = null) {
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_RefreshEvent', 15.0);
	}
}

export class WaitEvent implements BaseEvent {
	/**Wait for a specified number of seconds.*/
	seconds: number;
	max_seconds: number;
	event_timeout: number | null;

	constructor(seconds: number = 3.0, max_seconds: number = 10.0, event_timeout: number | null = null) {
		this.seconds = seconds;
		this.max_seconds = max_seconds;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_WaitEvent', 60.0);
	}
}

export class SendKeysEvent implements BaseEvent {
	/**Send keyboard keys/shortcuts.*/
	keys: string;
	event_timeout: number | null;

	constructor(keys: string, event_timeout: number | null = null) {
		this.keys = keys;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_SendKeysEvent', 60.0);
	}
}

export class UploadFileEvent extends ElementSelectedEvent<null> {
	/**Upload a file to an element.*/
	node: EnhancedDOMTreeNode;
	file_path: string;
	event_timeout: number | null;

	constructor(node: EnhancedDOMTreeNode, file_path: string, event_timeout: number | null = null) {
		super(node, event_timeout);
		this.node = node;
		this.file_path = file_path;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_UploadFileEvent', 30.0);
	}
}

export class GetDropdownOptionsEvent extends ElementSelectedEvent<Record<string, string>> {
	/**Get all options from any dropdown (native <select>, ARIA menus, or custom dropdowns).

	Returns a dict containing dropdown type, options list, and element metadata.*/
	node: EnhancedDOMTreeNode;
	event_timeout: number | null;

	constructor(node: EnhancedDOMTreeNode, event_timeout: number | null = null) {
		super(node, event_timeout);
		this.node = node;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_GetDropdownOptionsEvent', 15.0);
	}
}

export class SelectDropdownOptionEvent extends ElementSelectedEvent<Record<string, string>> {
	/**Select a dropdown option by exact text from any dropdown type.

	Returns a dict containing success status and selection details.*/
	node: EnhancedDOMTreeNode;
	text: string;
	event_timeout: number | null;

	constructor(node: EnhancedDOMTreeNode, text: string, event_timeout: number | null = null) {
		super(node, event_timeout);
		this.node = node;
		this.text = text;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_SelectDropdownOptionEvent', 8.0);
	}
}

export class ScrollToTextEvent implements BaseEvent {
	/**Scroll to specific text on the page. Raises exception if text not found.*/
	text: string;
	direction: 'up' | 'down';
	event_timeout: number | null;

	constructor(text: string, direction: 'up' | 'down' = 'down', event_timeout: number | null = null) {
		this.text = text;
		this.direction = direction;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_ScrollToTextEvent', 15.0);
	}
}

// ============================================================================
// Browser Lifecycle Events
// ============================================================================

export class BrowserStartEvent implements BaseEvent {
	/**Start/connect to browser.*/
	cdp_url: string | null;
	launch_options: Record<string, any>;
	event_timeout: number | null;

	constructor(cdp_url: string | null = null, launch_options: Record<string, any> = {}, event_timeout: number | null = null) {
		this.cdp_url = cdp_url;
		this.launch_options = launch_options;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserStartEvent', 30.0);
	}
}

export class BrowserStopEvent implements BaseEvent {
	/**Stop/disconnect from browser.*/
	force: boolean;
	event_timeout: number | null;

	constructor(force: boolean = false, event_timeout: number | null = null) {
		this.force = force;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserStopEvent', 45.0);
	}
}

export class BrowserLaunchResult {
	/**Result of launching a browser.*/
	cdp_url: string;

	constructor(cdp_url: string) {
		this.cdp_url = cdp_url;
	}
}

export class BrowserLaunchEvent implements BaseEvent {
	/**Launch a local browser process.*/
	event_timeout: number | null;

	constructor(event_timeout: number | null = null) {
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserLaunchEvent', 30.0);
	}
}

export class BrowserKillEvent implements BaseEvent {
	/**Kill local browser subprocess.*/
	event_timeout: number | null;

	constructor(event_timeout: number | null = null) {
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserKillEvent', 30.0);
	}
}

// ============================================================================
// DOM-related Events
// ============================================================================

export class BrowserConnectedEvent implements BaseEvent {
	/**Browser has started/connected.*/
	cdp_url: string;
	event_timeout: number | null;

	constructor(cdp_url: string, event_timeout: number | null = null) {
		this.cdp_url = cdp_url;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserConnectedEvent', 30.0);
	}
}

export class BrowserStoppedEvent implements BaseEvent {
	/**Browser has stopped/disconnected.*/
	reason: string | null;
	event_timeout: number | null;

	constructor(reason: string | null = null, event_timeout: number | null = null) {
		this.reason = reason;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserStoppedEvent', 30.0);
	}
}

export class TabCreatedEvent implements BaseEvent {
	/**A new tab was created.*/
	target_id: TargetID;
	url: string;
	event_timeout: number | null;

	constructor(target_id: TargetID, url: string, event_timeout: number | null = null) {
		this.target_id = target_id;
		this.url = url;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_TabCreatedEvent', 30.0);
	}
}

export class TabClosedEvent implements BaseEvent {
	/**A tab was closed.*/
	target_id: TargetID;
	event_timeout: number | null;

	constructor(target_id: TargetID, event_timeout: number | null = null) {
		this.target_id = target_id;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_TabClosedEvent', 10.0);
	}
}

export class AgentFocusChangedEvent implements BaseEvent {
	/**Agent focus changed to a different tab.*/
	target_id: TargetID;
	url: string;
	event_timeout: number | null;

	constructor(target_id: TargetID, url: string, event_timeout: number | null = null) {
		this.target_id = target_id;
		this.url = url;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_AgentFocusChangedEvent', 10.0);
	}
}

export class TargetCrashedEvent implements BaseEvent {
	/**A target has crashed.*/
	target_id: TargetID;
	error: string;
	event_timeout: number | null;

	constructor(target_id: TargetID, error: string, event_timeout: number | null = null) {
		this.target_id = target_id;
		this.error = error;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_TargetCrashedEvent', 10.0);
	}
}

export class NavigationStartedEvent implements BaseEvent {
	/**Navigation started.*/
	target_id: TargetID;
	url: string;
	event_timeout: number | null;

	constructor(target_id: TargetID, url: string, event_timeout: number | null = null) {
		this.target_id = target_id;
		this.url = url;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_NavigationStartedEvent', 30.0);
	}
}

export class NavigationCompleteEvent implements BaseEvent {
	/**Navigation completed.*/
	target_id: TargetID;
	url: string;
	status: number | null;
	error_message: string | null;
	loading_status: string | null;
	event_timeout: number | null;

	constructor(
		target_id: TargetID,
		url: string,
		status: number | null = null,
		error_message: string | null = null,
		loading_status: string | null = null,
		event_timeout: number | null = null
	) {
		this.target_id = target_id;
		this.url = url;
		this.status = status;
		this.error_message = error_message;
		this.loading_status = loading_status;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_NavigationCompleteEvent', 30.0);
	}
}

// ============================================================================
// Error Events
// ============================================================================

export class BrowserErrorEvent implements BaseEvent {
	/**An error occurred in the browser layer.*/
	error_type: string;
	message: string;
	details: Record<string, any>;
	event_timeout: number | null;

	constructor(
		error_type: string,
		message: string,
		details: Record<string, any> = {},
		event_timeout: number | null = null
	) {
		this.error_type = error_type;
		this.message = message;
		this.details = details;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_BrowserErrorEvent', 30.0);
	}
}

// ============================================================================
// Storage State Events
// ============================================================================

export class SaveStorageStateEvent implements BaseEvent {
	/**Request to save browser storage state.*/
	path: string | null;
	event_timeout: number | null;

	constructor(path: string | null = null, event_timeout: number | null = null) {
		this.path = path;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_SaveStorageStateEvent', 45.0);
	}
}

export class StorageStateSavedEvent implements BaseEvent {
	/**Notification that storage state was saved.*/
	path: string;
	cookies_count: number;
	origins_count: number;
	event_timeout: number | null;

	constructor(path: string, cookies_count: number, origins_count: number, event_timeout: number | null = null) {
		this.path = path;
		this.cookies_count = cookies_count;
		this.origins_count = origins_count;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_StorageStateSavedEvent', 30.0);
	}
}

export class LoadStorageStateEvent implements BaseEvent {
	/**Request to load browser storage state.*/
	path: string | null;
	event_timeout: number | null;

	constructor(path: string | null = null, event_timeout: number | null = null) {
		this.path = path;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_LoadStorageStateEvent', 45.0);
	}
}

export class StorageStateLoadedEvent implements BaseEvent {
	/**Notification that storage state was loaded.*/
	path: string;
	cookies_count: number;
	origins_count: number;
	event_timeout: number | null;

	constructor(path: string, cookies_count: number, origins_count: number, event_timeout: number | null = null) {
		this.path = path;
		this.cookies_count = cookies_count;
		this.origins_count = origins_count;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_StorageStateLoadedEvent', 30.0);
	}
}

// ============================================================================
// File Download Events
// ============================================================================

export class FileDownloadedEvent implements BaseEvent {
	/**A file has been downloaded.*/
	url: string;
	path: string;
	file_name: string;
	file_size: number;
	file_type: string | null;
	mime_type: string | null;
	from_cache: boolean;
	auto_download: boolean;
	event_timeout: number | null;

	constructor(
		url: string,
		path: string,
		file_name: string,
		file_size: number,
		file_type: string | null = null,
		mime_type: string | null = null,
		from_cache: boolean = false,
		auto_download: boolean = false,
		event_timeout: number | null = null
	) {
		this.url = url;
		this.path = path;
		this.file_name = file_name;
		this.file_size = file_size;
		this.file_type = file_type;
		this.mime_type = mime_type;
		this.from_cache = from_cache;
		this.auto_download = auto_download;
		this.event_timeout = event_timeout ?? _get_timeout('TIMEOUT_FileDownloadedEvent', 30.0);
	}
}

export class AboutBlankDVDScreensaverShownEvent implements BaseEvent {
	/**AboutBlankWatchdog has shown DVD screensaver animation on an about:blank tab.*/
	target_id: TargetID;
	error: string | null;

	constructor(target_id: TargetID, error: string | null = null) {
		this.target_id = target_id;
		this.error = error;
	}
}

export class DialogOpenedEvent implements BaseEvent {
	/**Event dispatched when a JavaScript dialog is opened and handled.*/
	dialog_type: string; // 'alert', 'confirm', 'prompt', or 'beforeunload'
	message: string;
	url: string;
	frame_id: string | null;

	constructor(dialog_type: string, message: string, url: string, frame_id: string | null = null) {
		this.dialog_type = dialog_type;
		this.message = message;
		this.url = url;
		this.frame_id = frame_id;
	}
}

// Note: _get_timeout is already defined at the top of the file
