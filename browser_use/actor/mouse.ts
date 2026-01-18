/**
 * TypeScript implementation of mouse operations
 * Converted from browser_use/actor/mouse.py
 */

import type { BrowserSession } from '../browser/session';

// Type definitions for CDP input commands
type MouseButton = 'left' | 'right' | 'middle';

interface DispatchMouseEventParameters {
	type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
	x: number;
	y: number;
	button?: MouseButton;
	clickCount?: number;
	deltaX?: number;
	deltaY?: number;
}

interface SynthesizeScrollGestureParameters {
	x: number;
	y: number;
	xDistance: number;
	yDistance: number;
}

/**
 * Mouse operations for a target.
 */
export class Mouse {
	private _browser_session: BrowserSession;
	private _client: any; // CDP client
	private _session_id: string | null;
	private _target_id: string | null;

	constructor(browser_session: BrowserSession, session_id: string | null = null, target_id: string | null = null) {
		this._browser_session = browser_session;
		this._client = browser_session.cdp_client;
		this._session_id = session_id;
		this._target_id = target_id;
	}

	/**
	 * Click at the specified coordinates.
	 */
	async click(x: number, y: number, button: MouseButton = 'left', click_count: number = 1): Promise<void> {
		// Mouse press
		const press_params: DispatchMouseEventParameters = {
			type: 'mousePressed',
			x,
			y,
			button,
			clickCount: click_count,
		};
		await this._client.send.Input.dispatchMouseEvent(press_params, this._session_id);

		// Mouse release
		const release_params: DispatchMouseEventParameters = {
			type: 'mouseReleased',
			x,
			y,
			button,
			clickCount: click_count,
		};
		await this._client.send.Input.dispatchMouseEvent(release_params, this._session_id);
	}

	/**
	 * Press mouse button down.
	 */
	async down(button: MouseButton = 'left', click_count: number = 1): Promise<void> {
		const params: DispatchMouseEventParameters = {
			type: 'mousePressed',
			x: 0, // Will use last mouse position
			y: 0,
			button,
			clickCount: click_count,
		};
		await this._client.send.Input.dispatchMouseEvent(params, this._session_id);
	}

	/**
	 * Release mouse button.
	 */
	async up(button: MouseButton = 'left', click_count: number = 1): Promise<void> {
		const params: DispatchMouseEventParameters = {
			type: 'mouseReleased',
			x: 0, // Will use last mouse position
			y: 0,
			button,
			clickCount: click_count,
		};
		await this._client.send.Input.dispatchMouseEvent(params, this._session_id);
	}

	/**
	 * Move mouse to the specified coordinates.
	 */
	async move(x: number, y: number, steps: number = 1): Promise<void> {
		// TODO: Implement smooth movement with multiple steps if needed
		// Acknowledge parameter for future use
		void steps;

		const params: DispatchMouseEventParameters = { type: 'mouseMoved', x, y };
		await this._client.send.Input.dispatchMouseEvent(params, this._session_id);
	}

	/**
	 * Scroll the page using robust CDP methods.
	 */
	async scroll(x: number = 0, y: number = 0, delta_x: number | null = null, delta_y: number | null = null): Promise<void> {
		if (!this._session_id) {
			throw new Error('Session ID is required for scroll operations');
		}

		// Method 1: Try mouse wheel event (most reliable)
		try {
			// Get viewport dimensions
			const layout_metrics = await this._client.send.Page.getLayoutMetrics(this._session_id);
			const viewport_width = layout_metrics['layoutViewport']['clientWidth'];
			const viewport_height = layout_metrics['layoutViewport']['clientHeight'];

			// Use provided coordinates or center of viewport
			const scroll_x = x > 0 ? x : viewport_width / 2;
			const scroll_y = y > 0 ? y : viewport_height / 2;

			// Calculate scroll deltas (positive = down/right)
			const scroll_delta_x = delta_x || 0;
			const scroll_delta_y = delta_y || 0;

			// Dispatch mouse wheel event
			await this._client.send.Input.dispatchMouseEvent(
				{
					type: 'mouseWheel',
					x: scroll_x,
					y: scroll_y,
					deltaX: scroll_delta_x,
					deltaY: scroll_delta_y,
				},
				this._session_id
			);
			return;
		} catch (error) {
			// Fall through to next method
		}

		// Method 2: Fallback to synthesizeScrollGesture
		try {
			const params: SynthesizeScrollGestureParameters = {
				x,
				y,
				xDistance: delta_x || 0,
				yDistance: delta_y || 0,
			};
			await this._client.send.Input.synthesizeScrollGesture(params, this._session_id);
		} catch (error) {
			// Method 3: JavaScript fallback
			const scroll_js = `window.scrollBy(${delta_x || 0}, ${delta_y || 0})`;
			await this._client.send.Runtime.evaluate(
				{ expression: scroll_js, returnByValue: true },
				this._session_id
			);
		}
	}
}
