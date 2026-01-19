/**
 * TypeScript implementation of event-driven CDP session management
 * Converted from browser_use/browser/session_manager.py
 * 
 * Manages CDP sessions by listening to Target.attachedToTarget and Target.detachedFromTarget
 * events, ensuring the session pool always reflects the current browser state.
 */

import type { AttachedToTargetEvent, DetachedFromTargetEvent, SessionID, TargetID } from 'cdp_use/cdp/target';
import type { BrowserSession, CDPSession, Target } from './session';
import { create_task_with_error_handling } from '../utils';

/**
 * Event-driven CDP session manager.
 *
 * Automatically synchronizes the CDP session pool with browser state via CDP events.
 *
 * Key features:
 * - Sessions added/removed automatically via Target attach/detach events
 * - Multiple sessions can attach to the same target
 * - Targets only removed when ALL sessions detach
 * - No stale sessions - pool always reflects browser reality
 *
 * SessionManager is the SINGLE SOURCE OF TRUTH for all targets and sessions.
 */
export class SessionManager {
	browser_session: BrowserSession;
	logger: any;

	// All targets (entities: pages, iframes, workers)
	private _targets: Map<TargetID, Target> = new Map();

	// All sessions (communication channels)
	private _sessions: Map<SessionID, CDPSession> = new Map();

	// Mapping: target -> sessions attached to it
	private _target_sessions: Map<TargetID, Set<SessionID>> = new Map();

	// Reverse mapping: session -> target it belongs to
	private _session_to_target: Map<SessionID, TargetID> = new Map();

	private _lock: Promise<void> = Promise.resolve(); // Simple lock implementation
	private _recovery_lock: Promise<void> = Promise.resolve();

	// Focus recovery coordination - event-driven instead of polling
	private _recovery_in_progress: boolean = false;
	private _recovery_complete_event: { wait: () => Promise<void>; set: () => void } | null = null;
	private _recovery_task: Promise<any> | null = null;

	constructor(browser_session: BrowserSession) {
		this.browser_session = browser_session;
		this.logger = browser_session.logger;
	}

	async start_monitoring(): Promise<void> {
		/**Start monitoring Target attach/detach events.

		Registers CDP event handlers to keep the session pool synchronized with browser state.
		Also discovers and initializes all existing targets on startup.
		*/
		if (!this.browser_session._cdp_client_root) {
			throw new Error('CDP client not initialized');
		}

		// Capture cdp_client_root in closure to avoid type errors
		const cdp_client = this.browser_session._cdp_client_root;

		// Enable target discovery to receive targetInfoChanged events automatically
		// This eliminates the need for getTargetInfo() polling calls
		await cdp_client.send.Target.setDiscoverTargets({
			params: { discover: true, filter: [{ type: 'page' }, { type: 'iframe' }] },
		});

		// Register synchronous event handlers (CDP requirement)
		const on_attached = (event: AttachedToTargetEvent, session_id: SessionID | null = null) => {
			// _handle_target_attached() handles:
			// - setAutoAttach for children
			// - Create CDPSession
			// - Enable monitoring (for pages/tabs)
			// - Add to pool
			create_task_with_error_handling(
				this._handle_target_attached(event),
				'handle_target_attached',
				this.logger,
				true
			);
		};

		const on_detached = (event: DetachedFromTargetEvent, session_id: SessionID | null = null) => {
			create_task_with_error_handling(
				this._handle_target_detached(event),
				'handle_target_detached',
				this.logger,
				true
			);
		};

		const on_target_info_changed = (event: any, session_id: SessionID | null = null) => {
			// Update session info from targetInfoChanged events (no polling needed!)
			create_task_with_error_handling(
				this._handle_target_info_changed(event),
				'handle_target_info_changed',
				this.logger,
				true
			);
		};

		cdp_client.register.Target.attachedToTarget(on_attached);
		cdp_client.register.Target.detachedFromTarget(on_detached);
		cdp_client.register.Target.targetInfoChanged(on_target_info_changed);

		this.logger.debug('[SessionManager] Event monitoring started');

		// Discover and initialize ALL existing targets
		await this._initialize_existing_targets();
	}

	private _get_session_for_target(target_id: TargetID): CDPSession | null {
		/**Internal: Get ANY valid session for a target (picks first available).

		⚠️ INTERNAL API - Use browser_session.get_or_create_cdp_session() instead!
		This method has no validation, no focus management, no recovery.

		Args:
			target_id: Target ID to get session for

		Returns:
			CDPSession if exists, null if target has detached
		*/
		const session_ids = this._target_sessions.get(target_id);
		if (!session_ids || session_ids.size === 0) {
			// Check if this is the focused target - indicates stale focus that needs cleanup
			if (this.browser_session.agent_focus_target_id === target_id) {
				this.logger.warning(
					`[SessionManager] ⚠️ Attempted to get session for stale focused target ${target_id.slice(0, 8)}... ` +
						'Clearing stale focus and triggering recovery.'
				);

				// Clear stale focus immediately (defense in depth)
				this.browser_session.agent_focus_target_id = null;

				// Trigger recovery if not already in progress
				if (!this._recovery_in_progress) {
					this.logger.warning('[SessionManager] Recovery was not in progress! Triggering now.');
					this._recovery_task = create_task_with_error_handling(
						this._recover_agent_focus(target_id),
						'recover_agent_focus_from_stale_get',
						this.logger,
						false
					);
				}
			}
			return null;
		}
		const first_session_id = Array.from(session_ids)[0];
		return this._sessions.get(first_session_id) || null;
	}

	get_all_page_targets(): Target[] {
		/**Get all page/tab targets using owned data.

		Returns:
			List of Target objects for all page/tab targets
		*/
		const page_targets: Target[] = [];
		for (const target of this._targets.values()) {
			if (target.target_type === 'page' || target.target_type === 'tab') {
				page_targets.push(target);
			}
		}
		return page_targets;
	}

	async validate_session(target_id: TargetID): Promise<boolean> {
		/**Check if a target still has active sessions.

		Args:
			target_id: Target ID to validate

		Returns:
			True if target has active sessions, False if it should be removed
		*/
		const session_ids = this._target_sessions.get(target_id);
		if (!session_ids) {
			return false;
		}
		return session_ids.size > 0;
	}

	async clear(): Promise<void> {
		/**Clear all owned data structures for cleanup.*/
		await this._lock;
		// Clear owned data (single source of truth)
		this._targets.clear();
		this._sessions.clear();
		this._target_sessions.clear();
		this._session_to_target.clear();

		this.logger.info('[SessionManager] Cleared all owned data (targets, sessions, mappings)');
	}

	async is_target_valid(target_id: TargetID): Promise<boolean> {
		/**Check if a target is still valid and has active sessions.

		Args:
			target_id: Target ID to validate

		Returns:
			True if target is valid and has active sessions, False otherwise
		*/
		const session_ids = this._target_sessions.get(target_id);
		if (!session_ids) {
			return false;
		}
		return session_ids.size > 0;
	}

	get_target_id_from_session_id(session_id: SessionID): TargetID | null {
		/**Look up which target a session belongs to.

		Args:
			session_id: The session ID to look up

		Returns:
			Target ID if found, null otherwise
		*/
		return this._session_to_target.get(session_id) || null;
	}

	get_target(target_id: TargetID): Target | null {
		/**Get target from owned data.

		Args:
			target_id: Target ID to get

		Returns:
			Target object if found, null otherwise
		*/
		return this._targets.get(target_id) || null;
	}

	get_all_targets(): Map<TargetID, Target> {
		/**Get all targets (read-only access to owned data).

		Returns:
			Map mapping target_id to Target objects
		*/
		return this._targets;
	}

	get_all_target_ids(): TargetID[] {
		/**Get all target IDs from owned data.

		Returns:
			List of all target IDs
		*/
		return Array.from(this._targets.keys());
	}

	get_all_sessions(): Map<SessionID, CDPSession> {
		/**Get all sessions (read-only access to owned data).

		Returns:
			Map mapping session_id to CDPSession objects
		*/
		return this._sessions;
	}

	get_session(session_id: SessionID): CDPSession | null {
		/**Get session from owned data.

		Args:
			session_id: Session ID to get

		Returns:
			CDPSession object if found, null otherwise
		*/
		return this._sessions.get(session_id) || null;
	}

	get_all_sessions_for_target(target_id: TargetID): CDPSession[] {
		/**Get ALL sessions attached to a target from owned data.

		Args:
			target_id: Target ID to get sessions for

		Returns:
			List of all CDPSession objects for this target
		*/
		const session_ids = this._target_sessions.get(target_id);
		if (!session_ids) {
			return [];
		}
		return Array.from(session_ids)
			.map((sid) => this._sessions.get(sid))
			.filter((s): s is CDPSession => s !== undefined);
	}

	get_target_sessions_mapping(): Map<TargetID, Set<SessionID>> {
		/**Get target->sessions mapping (read-only access).

		Returns:
			Map mapping target_id to set of session_ids
		*/
		return this._target_sessions;
	}

	get_focused_target(): Target | null {
		/**Get the target that currently has agent focus.

		Convenience method that uses browser_session.agent_focus_target_id.

		Returns:
			Target object if agent has focus, null otherwise
		*/
		if (!this.browser_session.agent_focus_target_id) {
			return null;
		}
		return this.get_target(this.browser_session.agent_focus_target_id);
	}

	async ensure_valid_focus(timeout: number = 3.0): Promise<boolean> {
		/**Ensure agent_focus_target_id points to a valid, attached CDP session.

		If the focus target is stale (detached), this method waits for automatic recovery.
		Uses event-driven coordination instead of polling for efficiency.

		Args:
			timeout: Maximum time to wait for recovery in seconds (default: 3.0)

		Returns:
			True if focus is valid or successfully recovered, False if no focus or recovery failed
		*/
		if (!this.browser_session.agent_focus_target_id) {
			// No focus at all - might be initial state or complete failure
			if (this._recovery_in_progress && this._recovery_complete_event) {
				// Recovery is happening, wait for it
				try {
					await Promise.race([
						this._recovery_complete_event.wait(),
						new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout * 1000)),
					]);
					// Check again after recovery - simple existence check
					const focus_id = this.browser_session.agent_focus_target_id;
					return focus_id !== null && this._get_session_for_target(focus_id) !== null;
				} catch {
					this.logger.error(`[SessionManager] ❌ Timed out waiting for recovery after ${timeout}s`);
					return false;
				}
			}
			return false;
		}

		// Simple existence check - does the focused target have a session?
		const cdp_session = this._get_session_for_target(this.browser_session.agent_focus_target_id);
		if (cdp_session) {
			// Session exists - validate it's still active
			const is_valid = await this.validate_session(this.browser_session.agent_focus_target_id);
			if (is_valid) {
				return true;
			}
		}

		// Focus is stale - wait for recovery using event instead of polling
		const stale_target_id = this.browser_session.agent_focus_target_id;
		this.logger.warning(
			`[SessionManager] ⚠️ Stale agent_focus detected (target ${stale_target_id ? stale_target_id.slice(0, 8) : 'None'}... detached), ` +
				'waiting for recovery...'
		);

		// Check if recovery is already in progress
		if (!this._recovery_in_progress) {
			this.logger.warning(
				'[SessionManager] ⚠️ Recovery not in progress for stale focus! ' +
					'This indicates a bug - recovery should have been triggered.'
			);
			return false;
		}

		// Wait for recovery complete event (event-driven, not polling!)
		if (this._recovery_complete_event) {
			try {
				const start_time = Date.now();
				await Promise.race([
					this._recovery_complete_event.wait(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout * 1000)),
				]);
				const elapsed = (Date.now() - start_time) / 1000;

				// Verify recovery succeeded - simple existence check
				const focus_id = this.browser_session.agent_focus_target_id;
				if (focus_id && this._get_session_for_target(focus_id)) {
					this.logger.info(
						`[SessionManager] ✅ Agent focus recovered to ${this.browser_session.agent_focus_target_id?.slice(0, 8)}... ` +
							`after ${elapsed * 1000}ms`
					);
					return true;
				} else {
					this.logger.error(
						`[SessionManager] ❌ Recovery completed but focus still invalid after ${elapsed * 1000}ms`
					);
					return false;
				}
			} catch {
				this.logger.error(
					`[SessionManager] ❌ Recovery timed out after ${timeout}s ` +
						`(was: ${stale_target_id ? stale_target_id.slice(0, 8) : 'None'}..., ` +
						`now: ${this.browser_session.agent_focus_target_id ? this.browser_session.agent_focus_target_id.slice(0, 8) : 'None'})`
				);
				return false;
			}
		} else {
			this.logger.error('[SessionManager] ❌ Recovery event not initialized');
			return false;
		}
	}

	private async _handle_target_attached(event: AttachedToTargetEvent): Promise<void> {
		/**Handle Target.attachedToTarget event.

		Called automatically by Chrome when a new target/session is created.
		This is the ONLY place where sessions are added to the pool.
		*/
		const target_id = event.targetInfo.targetId;
		const session_id = event.sessionId;
		const target_type = event.targetInfo.type;
		const target_info = event.targetInfo;
		const waiting_for_debugger = event.waitingForDebugger || false;

		this.logger.debug(
			`[SessionManager] Target attached: ${target_id.slice(0, 8)}... (session=${session_id.slice(0, 8)}..., ` +
				`type=${target_type}, waitingForDebugger=${waiting_for_debugger})`
		);

		// Defensive check: browser may be shutting down and _cdp_client_root could be null
		if (!this.browser_session._cdp_client_root) {
			this.logger.debug(
				`[SessionManager] Skipping target attach for ${target_id.slice(0, 8)}... - browser shutting down (no CDP client)`
			);
			return;
		}

		// Enable auto-attach for this session's children (do this FIRST, outside lock)
		try {
			await this.browser_session._cdp_client_root.send.Target.setAutoAttach({
				params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
				session_id: session_id,
			});
		} catch (error: any) {
			const error_str = String(error);
			// Expected for short-lived targets (workers, temp iframes) that detach before this executes
			if (!error_str.includes('-32001') && !error_str.includes('Session with given id not found')) {
				this.logger.debug(`[SessionManager] Auto-attach failed for ${target_type}: ${error}`);
			}
		}

		// Use a simple lock mechanism
		await this._lock;

		// Track this session for the target
		if (!this._target_sessions.has(target_id)) {
			this._target_sessions.set(target_id, new Set());
		}
		this._target_sessions.get(target_id)!.add(session_id);
		this._session_to_target.set(session_id, target_id);

		// Create or update Target (source of truth for url/title)
		if (!this._targets.has(target_id)) {
			// Import Target class dynamically
			const { Target } = await import('./session');
			const target = new Target({
				target_id: target_id,
				target_type: target_type,
				url: target_info.url || 'about:blank',
				title: target_info.title || 'Unknown title',
			});
			this._targets.set(target_id, target);
			this.logger.debug(`[SessionManager] Created target ${target_id.slice(0, 8)}... (type=${target_type})`);
		} else {
			// Update existing target info
			const existing_target = this._targets.get(target_id)!;
			existing_target.url = target_info.url || existing_target.url;
			existing_target.title = target_info.title || existing_target.title;
		}

		// Create CDPSession (communication channel)
		const { CDPSession } = await import('./session');

		if (!this.browser_session._cdp_client_root) {
			throw new Error('Root CDP client required');
		}

		const cdp_session = new CDPSession({
			cdp_client: this.browser_session._cdp_client_root,
			target_id: target_id,
			session_id: session_id,
		});

		// Add to sessions dict
		this._sessions.set(session_id, cdp_session);

		this.logger.debug(
			`[SessionManager] Created session ${session_id.slice(0, 8)}... for target ${target_id.slice(0, 8)}... ` +
				`(total sessions: ${this._sessions.size})`
		);

		// Enable lifecycle events and network monitoring for page targets
		if (target_type === 'page' || target_type === 'tab') {
			await this._enable_page_monitoring(cdp_session);
		}

		// Resume execution if waiting for debugger
		if (waiting_for_debugger) {
			try {
				if (!this.browser_session._cdp_client_root) {
					throw new Error('CDP client not available');
				}
				await this.browser_session._cdp_client_root.send.Runtime.runIfWaitingForDebugger({
					session_id: session_id,
				});
			} catch (error: any) {
				this.logger.warning(`[SessionManager] Failed to resume execution: ${error}`);
			}
		}
	}

	private async _handle_target_info_changed(event: any): Promise<void> {
		/**Handle Target.targetInfoChanged event.

		Updates target title/URL without polling getTargetInfo().
		Chrome fires this automatically when title or URL changes.
		*/
		const target_info = event.targetInfo || {};
		const target_id = target_info.targetId;

		if (!target_id) {
			return;
		}

		await this._lock;

		// Update target if it exists (source of truth for url/title)
		if (this._targets.has(target_id)) {
			const target = this._targets.get(target_id)!;
			target.title = target_info.title || target.title;
			target.url = target_info.url || target.url;
		}
	}

	private async _handle_target_detached(event: DetachedFromTargetEvent): Promise<void> {
		/**Handle Target.detachedFromTarget event.

		Called automatically by Chrome when a target/session is destroyed.
		This is the ONLY place where sessions are removed from the pool.
		*/
		const session_id = event.sessionId;
		let target_id = event.targetId || null;

		// If targetId not in event, look it up via session mapping
		if (!target_id) {
			await this._lock;
			target_id = this._session_to_target.get(session_id) || null;
		}

		if (!target_id) {
			this.logger.warning(`[SessionManager] Session detached but target unknown (session=${session_id.slice(0, 8)}...)`);
			return;
		}

		let agent_focus_lost = false;
		let target_fully_removed = false;
		let target_type: string | null = null;

		await this._lock;

		// Remove this session from target's session set
		if (this._target_sessions.has(target_id)) {
			const sessions = this._target_sessions.get(target_id)!;
			sessions.delete(session_id);

			const remaining_sessions = sessions.size;

			this.logger.debug(
				`[SessionManager] Session detached: target=${target_id.slice(0, 8)}... ` +
					`session=${session_id.slice(0, 8)}... (remaining=${remaining_sessions})`
			);

			// Only remove target when NO sessions remain
			if (remaining_sessions === 0) {
				this.logger.debug(`[SessionManager] No sessions remain for target ${target_id.slice(0, 8)}..., removing target`);

				target_fully_removed = true;

				// Check if agent_focus points to this target
				agent_focus_lost = this.browser_session.agent_focus_target_id === target_id;

				// Immediately clear stale focus to prevent operations on detached target
				if (agent_focus_lost) {
					this.logger.debug(
						`[SessionManager] Clearing stale agent_focus_target_id ${target_id.slice(0, 8)}... ` +
							'to prevent operations on detached target'
					);
					this.browser_session.agent_focus_target_id = null;
				}

				// Get target type before removing (needed for TabClosedEvent dispatch)
				const target = this._targets.get(target_id);
				target_type = target ? target.target_type : null;

				// Remove target (entity) from owned data
				if (this._targets.has(target_id)) {
					this._targets.delete(target_id);
					this.logger.debug(`[SessionManager] Removed target ${target_id.slice(0, 8)}... (remaining targets: ${this._targets.size})`);
				}

				// Clean up tracking
				this._target_sessions.delete(target_id);
			}
		} else {
			// Target not tracked - already removed or never attached
			this.logger.debug(
				`[SessionManager] Session detached from untracked target: target=${target_id.slice(0, 8)}... ` +
					`session=${session_id.slice(0, 8)}... (target was already removed or attach event was missed)`
			);
		}

		// Remove session from owned sessions dict
		if (this._sessions.has(session_id)) {
			this._sessions.delete(session_id);
			this.logger.debug(`[SessionManager] Removed session ${session_id.slice(0, 8)}... (remaining sessions: ${this._sessions.size})`);
		}

		// Remove from reverse mapping
		if (this._session_to_target.has(session_id)) {
			this._session_to_target.delete(session_id);
		}

		// Dispatch TabClosedEvent only for page/tab targets that are fully removed (not iframes/workers or partial detaches)
		if (target_fully_removed) {
			if (target_type === 'page' || target_type === 'tab') {
				const { TabClosedEvent } = await import('./events');
				this.browser_session.event_bus.dispatch(new TabClosedEvent({ target_id: target_id }));
				this.logger.debug(`[SessionManager] Dispatched TabClosedEvent for page target ${target_id.slice(0, 8)}...`);
			} else if (target_type) {
				this.logger.debug(
					`[SessionManager] Target ${target_id.slice(0, 8)}... fully removed (type=${target_type}) - not dispatching TabClosedEvent`
				);
			}
		}

		// Auto-recover agent_focus outside the lock to avoid blocking other operations
		if (agent_focus_lost) {
			// Create recovery task instead of awaiting directly - allows concurrent operations to wait on same recovery
			if (!this._recovery_in_progress) {
				this._recovery_task = create_task_with_error_handling(
					this._recover_agent_focus(target_id),
					'recover_agent_focus',
					this.logger,
					false
				);
			}
		}
	}

	private async _recover_agent_focus(crashed_target_id: TargetID): Promise<void> {
		/**Auto-recover agent_focus when the focused target crashes/detaches.

		Uses recovery lock to prevent concurrent recovery attempts from creating multiple emergency tabs.
		Coordinates with ensure_valid_focus() via events for efficient waiting.

		Args:
			crashed_target_id: The target ID that was lost
		*/
		try {
			// Prevent concurrent recovery attempts
			await this._recovery_lock;

			// Set recovery state INSIDE lock to prevent race conditions
			if (this._recovery_in_progress) {
				this.logger.debug('[SessionManager] Recovery already in progress, waiting for it to complete');
				// Wait for ongoing recovery instead of starting a new one
				if (this._recovery_complete_event) {
					try {
						await Promise.race([
							this._recovery_complete_event.wait(),
							new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
						]);
					} catch {
						this.logger.error('[SessionManager] Timed out waiting for ongoing recovery');
					}
				}
				return;
			}

			// Set recovery state
			this._recovery_in_progress = true;
			const event = { _set: false, _waiters: [] as Array<() => void> };
			this._recovery_complete_event = {
				wait: () => {
					return new Promise<void>((resolve) => {
						if (event._set) {
							resolve();
						} else {
							event._waiters.push(resolve);
						}
					});
				},
				set: () => {
					event._set = true;
					event._waiters.forEach((resolve) => resolve());
					event._waiters = [];
				},
			};

			if (!this.browser_session._cdp_client_root) {
				this.logger.debug('[SessionManager] Skipping focus recovery - browser shutting down (no CDP client)');
				return;
			}

			// Check if another recovery already fixed agent_focus
			if (
				this.browser_session.agent_focus_target_id &&
				this.browser_session.agent_focus_target_id !== crashed_target_id
			) {
				this.logger.debug(
					`[SessionManager] Agent focus already recovered by concurrent operation ` +
						`(now: ${this.browser_session.agent_focus_target_id.slice(0, 8)}...), skipping recovery`
				);
				return;
			}

			// Note: agent_focus_target_id may already be null (cleared in _handle_target_detached)
			const current_focus_desc =
				this.browser_session.agent_focus_target_id !== null
					? `${this.browser_session.agent_focus_target_id.slice(0, 8)}...`
					: 'None (already cleared)';

			this.logger.warning(
				`[SessionManager] Agent focus target ${crashed_target_id.slice(0, 8)}... detached! ` +
					`Current focus: ${current_focus_desc}. Auto-recovering by switching to another target...`
			);

			// Perform recovery (outside lock to allow concurrent operations)
			// Try to find another valid page target
			const page_targets = this.get_all_page_targets();

			let new_target_id: TargetID | null = null;
			let is_existing_tab = false;

			if (page_targets.length > 0) {
				// Switch to most recent page that's not the crashed one
				new_target_id = page_targets[page_targets.length - 1].target_id;
				is_existing_tab = true;
				this.logger.info(`[SessionManager] Switching agent_focus to existing tab ${new_target_id.slice(0, 8)}...`);
			} else {
				// No pages exist - create a new one
				this.logger.warning('[SessionManager] No tabs remain! Creating new tab for agent...');
				new_target_id = await this.browser_session._cdp_create_new_page('about:blank');
				this.logger.info(`[SessionManager] Created new tab ${new_target_id.slice(0, 8)}... for agent`);

				// Dispatch TabCreatedEvent so watchdogs can initialize
				const { TabCreatedEvent } = await import('./events');
				this.browser_session.event_bus.dispatch(
					new TabCreatedEvent({ url: 'about:blank', target_id: new_target_id })
				);
			}

			// Wait for CDP attach event to create session
			// Note: This polling is necessary - waiting for external Chrome CDP event
			// _handle_target_attached will add session to pool when Chrome fires attachedToTarget
			let new_session: CDPSession | null = null;
			for (let attempt = 0; attempt < 20; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				new_session = this._get_session_for_target(new_target_id);
				if (new_session) {
					break;
				}
			}

			if (new_session) {
				this.browser_session.agent_focus_target_id = new_target_id;
				this.logger.info(`[SessionManager] ✅ Agent focus recovered: ${new_target_id.slice(0, 8)}...`);

				// Visually activate the tab in browser (only for existing tabs)
				if (is_existing_tab) {
					try {
						if (!this.browser_session._cdp_client_root) {
							throw new Error('CDP client not available');
						}
						await this.browser_session._cdp_client_root.send.Target.activateTarget({
							params: { targetId: new_target_id },
						});
						this.logger.debug(`[SessionManager] Activated tab ${new_target_id.slice(0, 8)}... in browser UI`);
					} catch (error: any) {
						this.logger.debug(`[SessionManager] Failed to activate tab visually: ${error}`);
					}
				}

				// Get target to access url (from owned data)
				const target = this.get_target(new_target_id);
				const target_url = target ? target.url : 'about:blank';

				// Dispatch focus changed event
				const { AgentFocusChangedEvent } = await import('./events');
				this.browser_session.event_bus.dispatch(
					new AgentFocusChangedEvent({ target_id: new_target_id, url: target_url })
				);
				return;
			}

			// Recovery failed - create emergency fallback tab
			this.logger.error(
				`[SessionManager] ❌ Failed to get session for ${new_target_id.slice(0, 8)}... after 2s, creating emergency fallback tab`
			);

			const fallback_target_id = await this.browser_session._cdp_create_new_page('about:blank');
			this.logger.warning(`[SessionManager] Created emergency fallback tab ${fallback_target_id.slice(0, 8)}...`);

			// Try one more time with fallback
			// Note: This polling is necessary - waiting for external Chrome CDP event
			for (let attempt = 0; attempt < 20; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				const fallback_session = this._get_session_for_target(fallback_target_id);
				if (fallback_session) {
					this.browser_session.agent_focus_target_id = fallback_target_id;
					this.logger.warning(
						`[SessionManager] ⚠️ Agent focus set to emergency fallback: ${fallback_target_id.slice(0, 8)}...`
					);

					const { AgentFocusChangedEvent, TabCreatedEvent } = await import('./events');
					this.browser_session.event_bus.dispatch(
						new TabCreatedEvent({ url: 'about:blank', target_id: fallback_target_id })
					);
					this.browser_session.event_bus.dispatch(
						new AgentFocusChangedEvent({ target_id: fallback_target_id, url: 'about:blank' })
					);
					return;
				}
			}

			// Complete failure - this should never happen
			this.logger.error(
				'[SessionManager] 🚨 CRITICAL: Failed to recover agent_focus even with fallback! Agent may be in broken state.'
			);
		} catch (error: any) {
			this.logger.error(`[SessionManager] ❌ Error during agent_focus recovery: ${error.constructor.name}: ${error}`);
		} finally {
			// Always signal completion and reset recovery state
			// This allows all waiting operations to proceed (success or failure)
			if (this._recovery_complete_event) {
				this._recovery_complete_event.set();
			}
			this._recovery_in_progress = false;
			this._recovery_task = null;
			this.logger.debug('[SessionManager] Recovery state reset');
		}
	}

	private async _initialize_existing_targets(): Promise<void> {
		/**Discover and initialize all existing targets at startup.

		Attaches to each target and initializes it SYNCHRONOUSLY.
		Chrome will also fire attachedToTarget events, but _handle_target_attached() is
		idempotent (checks if target already in pool), so duplicate handling is safe.

		This eliminates race conditions - monitoring is guaranteed ready before navigation.
		*/
		const cdp_client = this.browser_session._cdp_client_root;
		if (!cdp_client) {
			throw new Error('CDP client not available');
		}

		// Get all existing targets
		const targets_result = await cdp_client.send.Target.getTargets();
		const existing_targets = targets_result.targetInfos || [];

		this.logger.debug(`[SessionManager] Discovered ${existing_targets.length} existing targets`);

		// Track target IDs for verification
		const target_ids_to_wait_for: TargetID[] = [];

		// Just attach to ALL existing targets - Chrome fires attachedToTarget events
		// The on_attached handler (via create_task) does ALL the work
		for (const target of existing_targets) {
			const target_id = target.targetId;
			const target_type = target.type || 'unknown';

			try {
				// Just attach - event handler does everything
				await cdp_client.send.Target.attachToTarget({ params: { targetId: target_id, flatten: true } });
				target_ids_to_wait_for.push(target_id);
			} catch (error: any) {
				this.logger.debug(
					`[SessionManager] Failed to attach to existing target ${target_id.slice(0, 8)}... (type=${target_type}): ${error}`
				);
			}
		}

		// Wait for event handlers to complete their work (they run via create_task)
		// Use event-driven approach instead of polling for better performance
		const ready_event = { _set: false, _waiters: [] as Array<() => void> };
		const readyEvent = {
			wait: () => {
				return new Promise<void>((resolve) => {
					if (ready_event._set) {
						resolve();
					} else {
						ready_event._waiters.push(resolve);
					}
				});
			},
			set: () => {
				ready_event._set = true;
				ready_event._waiters.forEach((resolve) => resolve());
				ready_event._waiters = [];
			},
		};

		const check_all_ready = async () => {
			/**Check if all sessions are ready and signal completion.*/
			while (true) {
				let ready_count = 0;
				for (const tid of target_ids_to_wait_for) {
					const session = this._get_session_for_target(tid);
					if (session) {
						const target = this._targets.get(tid);
						const target_type = target ? target.target_type : 'unknown';
						// For pages, verify monitoring is enabled
						if (target_type === 'page' || target_type === 'tab') {
							if ((session as any)._lifecycle_events !== undefined && (session as any)._lifecycle_events !== null) {
								ready_count += 1;
							}
						} else {
							// Non-page targets don't need monitoring
							ready_count += 1;
						}
					}
				}

				if (ready_count === target_ids_to_wait_for.length) {
					readyEvent.set();
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		};

		// Start checking in background
		const check_task = create_task_with_error_handling(check_all_ready(), 'check_all_targets_ready', this.logger);

		try {
			// Wait for completion with timeout
			await Promise.race([
				readyEvent.wait(),
				new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
			]);
		} catch {
			// Timeout - count what's ready
			let ready_count = 0;
			for (const tid of target_ids_to_wait_for) {
				const session = this._get_session_for_target(tid);
				if (session) {
					const target = this._targets.get(tid);
					const target_type = target ? target.target_type : 'unknown';
					// For pages, verify monitoring is enabled
					if (target_type === 'page' || target_type === 'tab') {
						if ((session as any)._lifecycle_events !== undefined && (session as any)._lifecycle_events !== null) {
							ready_count += 1;
						}
					} else {
						// Non-page targets don't need monitoring
						ready_count += 1;
					}
				}
			}
			this.logger.warning(
				`[SessionManager] Initialization timeout after 2.0s: ${ready_count}/${target_ids_to_wait_for.length} sessions ready`
			);
		} finally {
			// Cancel check task
			// Note: In TypeScript, we'd need to implement task cancellation
			// For now, we'll just let it finish
		}
	}

	private async _enable_page_monitoring(cdp_session: CDPSession): Promise<void> {
		/**Enable lifecycle events and network monitoring for a page target.

		This is called once per page when it's created, avoiding handler accumulation.
		Registers a SINGLE lifecycle handler per session that stores events for navigations to consume.

		Args:
			cdp_session: The CDP session to enable monitoring on
		*/
		try {
			// Enable Page domain first (required for lifecycle events)
			await cdp_session.cdp_client.send.Page.enable({ session_id: cdp_session.session_id });

			// Enable lifecycle events (load, DOMContentLoaded, networkIdle, etc.)
			await cdp_session.cdp_client.send.Page.setLifecycleEventsEnabled({
				params: { enabled: true },
				session_id: cdp_session.session_id,
			});

			// Enable network monitoring for networkIdle detection
			await cdp_session.cdp_client.send.Network.enable({ session_id: cdp_session.session_id });

			// Initialize lifecycle event storage for this session (thread-safe)
			(cdp_session as any)._lifecycle_events = []; // Keep last 50 events
			(cdp_session as any)._lifecycle_lock = Promise.resolve(); // Simple lock

			// Register ONE handler per session that stores events
			const on_lifecycle_event = (event: any, session_id: SessionID | null = null) => {
				const event_name = event.name || 'unknown';
				const event_loader_id = event.loaderId || 'none';

				// Find which target this session belongs to
				let target_id_from_event: TargetID | null = null;
				if (session_id) {
					target_id_from_event = this.get_target_id_from_session_id(session_id);
				}

				// Check if this event is for our target
				if (target_id_from_event === cdp_session.target_id) {
					// Store event for navigations to consume
					const event_data = {
						name: event_name,
						loaderId: event_loader_id,
						timestamp: Date.now() / 1000,
					};
					// Append is atomic in JavaScript
					try {
						(cdp_session as any)._lifecycle_events.push(event_data);
						// Keep only last 50 events
						if ((cdp_session as any)._lifecycle_events.length > 50) {
							(cdp_session as any)._lifecycle_events.shift();
						}
					} catch (error: any) {
						// Only log errors, not every event
						this.logger.error(`[SessionManager] Failed to store lifecycle event: ${error}`);
					}
				}
			};

			// Register the handler ONCE (this is the only place we register)
			cdp_session.cdp_client.register.Page.lifecycleEvent(on_lifecycle_event);
		} catch (error: any) {
			// Don't fail - target might be short-lived or already detached
			const error_str = String(error);
			if (error_str.includes('-32001') || error_str.includes('Session with given id not found')) {
				this.logger.debug(
					`[SessionManager] Target ${cdp_session.target_id.slice(0, 8)}... detached before monitoring could be enabled (normal for short-lived targets)`
				);
			} else {
				this.logger.warning(
					`[SessionManager] Failed to enable monitoring for target ${cdp_session.target_id.slice(0, 8)}...: ${error}`
				);
			}
		}
	}
}
