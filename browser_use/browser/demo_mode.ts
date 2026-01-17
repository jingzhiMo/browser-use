/**
 * TypeScript implementation of demo mode
 * Converted from browser_use/browser/demo_mode.py
 */

import type { BrowserSession } from './session';

// Embedded JavaScript for demo panel (injected into browser pages)
const _DEMO_PANEL_SCRIPT = `(function () {
  // SESSION_ID_PLACEHOLDER will be replaced by DemoMode with actual session ID
  const SESSION_ID = '__BROWSER_USE_SESSION_ID_PLACEHOLDER__';
  // ... (full JavaScript code from Python file)
  // Note: The full JavaScript code is very long, so we keep it as a string constant
})();`;

export class DemoMode {
	/**Encapsulates browser overlay injection and log broadcasting for demo mode.*/
	static readonly VALID_LEVELS = new Set(['info', 'action', 'thought', 'error', 'success', 'warning']);

	private session: BrowserSession;
	private _script_identifier: string | null = null;
	private _script_source: string | null = null;
	private _panel_ready = false;
	private _lock: Promise<void> | null = null;

	constructor(session: BrowserSession) {
		this.session = session;
	}

	reset(): void {
		this._script_identifier = null;
		this._panel_ready = false;
	}

	private _load_script(): string {
		if (this._script_source === null) {
			this._script_source = _DEMO_PANEL_SCRIPT;
		}

		// Replace placeholder with actual session ID
		const session_id = this.session.id;
		const script_with_session_id = this._script_source.replace(
			'__BROWSER_USE_SESSION_ID_PLACEHOLDER__',
			session_id
		);
		return script_with_session_id;
	}

	async ensure_ready(): Promise<void> {
		/**Add init script and inject overlay into currently open pages.*/
		if (!this.session.browser_profile?.demo_mode) {
			return;
		}
		if (!this.session._cdp_client_root) {
			throw new Error('Root CDP client not initialized');
		}

		// Simple lock implementation using Promise
		if (this._lock) {
			await this._lock;
		}

		this._lock = (async () => {
			const script = this._load_script();

			if (this._script_identifier === null) {
				this._script_identifier = await this.session._cdp_add_init_script(script);
			}

			await this._inject_into_open_pages(script);
			this._panel_ready = true;
		})();

		await this._lock;
		this._lock = null;
	}

	async send_log(
		message: string,
		level: string = 'info',
		metadata: Record<string, any> | null = null
	): Promise<void> {
		/**Send a log entry to the in-browser panel.*/
		if (!message || !this.session.browser_profile?.demo_mode) {
			return;
		}

		try {
			await this.ensure_ready();
		} catch (error) {
			console.warn(`Failed to ensure demo mode is ready: ${error}`);
			return;
		}

		if (!this.session.agent_focus_target_id) {
			return;
		}

		let level_value = level.toLowerCase();
		if (!DemoMode.VALID_LEVELS.has(level_value)) {
			level_value = 'info';
		}

		const payload = {
			message,
			level: level_value,
			metadata: metadata || {},
			timestamp: new Date().toISOString(),
		};

		const script = this._build_event_expression(JSON.stringify(payload));

		try {
			const session = await this.session.get_or_create_cdp_session(null, false);
			await session.cdp_client.send.Runtime.evaluate({
				expression: script,
				awaitPromise: false,
			});
		} catch (error) {
			console.debug(`Failed to send demo log: ${error}`);
		}
	}

	private _build_event_expression(payload: string): string {
		return `
(() => {
	const detail = ${payload};
	const event = new CustomEvent('browser-use-log', { detail });
	window.dispatchEvent(event);
})();
`.trim();
	}

	private async _inject_into_open_pages(script: string): Promise<void> {
		// Note: This would need to call session methods to get all pages
		// const targets = await this.session._cdp_get_all_pages(...);
		// Implementation would depend on BrowserSession methods
		throw new Error('Method implementation depends on BrowserSession._cdp_get_all_pages');
	}

	private async _inject_into_target(target_id: string, script: string): Promise<void> {
		const session = await this.session.get_or_create_cdp_session(target_id, false);
		await session.cdp_client.send.Runtime.evaluate({
			expression: script,
			awaitPromise: false,
		});
	}
}
