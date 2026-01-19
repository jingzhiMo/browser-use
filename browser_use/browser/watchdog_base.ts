/**
 * TypeScript implementation of base watchdog class
 * Converted from browser_use/browser/watchdog_base.py
 */

import type { BaseEvent, EventBus } from 'bubus';
import type { BrowserSession } from './session';

/**
 * Base class for all browser watchdogs.
 *
 * Watchdogs monitor browser state and emit events based on changes.
 * They automatically register event handlers based on method names.
 *
 * Handler methods should be named: on_EventTypeName(self, event: EventTypeName)
 */
export abstract class BaseWatchdog {
	// Class variables to statically define the list of events relevant to each watchdog
	// (not enforced, just to make it easier to understand the code and debug watchdogs at runtime)
	static LISTENS_TO: (new (...args: any[]) => BaseEvent<any>)[] = []; // Events this watchdog listens to
	static EMITS: (new (...args: any[]) => BaseEvent<any>)[] = []; // Events this watchdog emits

	// Core dependencies
	event_bus: EventBus;
	browser_session: BrowserSession;

	constructor(event_bus: EventBus, browser_session: BrowserSession) {
		this.event_bus = event_bus;
		this.browser_session = browser_session;
	}

	get logger() {
		/**Get the logger from the browser session.*/
		return this.browser_session.logger;
	}

	static attach_handler_to_session(
		browser_session: BrowserSession,
		event_class: new (...args: any[]) => BaseEvent<any>,
		handler: (event: BaseEvent<any>) => Promise<any>
	): void {
		/**Attach a single event handler to a browser session.

		Args:
			browser_session: The browser session to attach to
			event_class: The event class to listen for
			handler: The handler method (must start with 'on_' and end with event type)
		*/
		const event_bus = browser_session.event_bus;

		// Validate handler naming convention
		if (!handler.name) {
			throw new Error('Handler must have a name attribute');
		}
		if (!handler.name.startsWith('on_')) {
			throw new Error(`Handler ${handler.name} must start with "on_"`);
		}
		if (!handler.name.endsWith(event_class.name)) {
			throw new Error(
				`Handler ${handler.name} must end with event type ${event_class.name}`
			);
		}

		// Get the watchdog instance if this is a bound method
		// In TypeScript, we need to check if handler is bound
		const watchdog_class_name = 'Unknown'; // Will be set when handler is called

		// Create a wrapper function with unique name to avoid duplicate handler warnings
		// Capture handler by value to avoid closure issues
		const make_unique_handler = (actual_handler: (event: BaseEvent<any>) => Promise<any>) => {
			const unique_handler = async (event: BaseEvent<any>) => {
				// just for debug logging, not used for anything else
				const parent_event = event.event_parent_id
					? event_bus.event_history.get(event.event_parent_id)
					: null;
				const grandparent_event =
					parent_event && parent_event.event_parent_id
						? event_bus.event_history.get(parent_event.event_parent_id)
						: null;
				const parent = parent_event
					? `↲  triggered by on_${parent_event.event_type}#${parent_event.event_id.slice(-4)}`
					: '👈 by Agent';
				const grandparent = parent_event
					? grandparent_event
						? `↲  under ${grandparent_event.event_type}#${grandparent_event.event_id.slice(-4)}`
						: '👈 by Agent'
					: '';
				const event_str = `#${event.event_id.slice(-4)}`;
				const time_start = Date.now() / 1000;
				const watchdog_and_handler_str = `[${watchdog_class_name}.${actual_handler.name}(${event_str})]`.padEnd(54);
				browser_session.logger.debug(
					`🚌 ${watchdog_and_handler_str} ⏳ Starting...       ${parent} ${grandparent}`
				);

				try {
					// **EXECUTE THE EVENT HANDLER FUNCTION**
					const result = await actual_handler(event);

					if (result instanceof Error) {
						throw result;
					}

					// just for debug logging, not used for anything else
					const time_end = Date.now() / 1000;
					const time_elapsed = time_end - time_start;
					const result_summary = result === null || result === undefined ? '' : ` ➡️ <${result.constructor.name}>`;
					const parents_summary = ` ${parent}`
						.replace('↲  triggered by ', '⤴  returned to  ')
						.replace('👈 by Agent', '👉 returned to  Agent');
					browser_session.logger.debug(
						`🚌 ${watchdog_and_handler_str} Succeeded (${time_elapsed.toFixed(2)}s)${result_summary}${parents_summary}`
					);
					return result;
				} catch (error: any) {
					const time_end = Date.now() / 1000;
					const time_elapsed = time_end - time_start;
					const original_error = error;
					browser_session.logger.error(
						`🚌 ${watchdog_and_handler_str} ❌ Failed (${time_elapsed.toFixed(2)}s): ${error.constructor.name}: ${error}`
					);

					// attempt to repair potentially crashed CDP session
					try {
						if (browser_session.agent_focus_target_id) {
							// With event-driven sessions, Chrome will send detach/attach events
							// SessionManager handles pool cleanup automatically
							const target_id_to_restore = browser_session.agent_focus_target_id;
							browser_session.logger.debug(
								`🚌 ${watchdog_and_handler_str} ⚠️ Session error detected, waiting for CDP events to sync (target: ${target_id_to_restore})`
							);

							// Wait for new attach event to restore the session
							// This will raise ValueError if target doesn't re-attach
							await browser_session.get_or_create_cdp_session({
								target_id: target_id_to_restore,
								focus: true,
							});
						} else {
							// Try to get any available session
							await browser_session.get_or_create_cdp_session({
								target_id: null,
								focus: true,
							});
						}
					} catch (sub_error: any) {
						const error_type_str = sub_error.constructor.name;
						if (
							error_type_str.includes('ConnectionClosedError') ||
							error_type_str.includes('ConnectionError')
						) {
							browser_session.logger.error(
								`🚌 ${watchdog_and_handler_str} ❌ Browser closed or CDP Connection disconnected by remote. ${error_type_str}: ${sub_error}\n`
							);
							throw sub_error;
						} else {
							browser_session.logger.error(
								`🚌 ${watchdog_and_handler_str} ❌ CDP connected but failed to re-create CDP session after error "${original_error.constructor.name}: ${original_error}" in ${actual_handler.name}(${event.event_type}#${event.event_id.slice(-4)}): due to ${error_type_str}: ${sub_error}\n`
							);
						}
					}

					// Always re-raise the original error with its traceback preserved
					throw original_error;
				}
			};

			// Set a unique name for the handler
			Object.defineProperty(unique_handler, 'name', {
				value: `${watchdog_class_name}.${actual_handler.name}`,
				writable: false,
			});

			return unique_handler;
		};

		const unique_handler = make_unique_handler(handler);
		(unique_handler as any).__name__ = `${watchdog_class_name}.${handler.name}`;

		// Check if this handler is already registered - throw error if duplicate
		const existing_handlers = event_bus.handlers.get(event_class.name) || [];
		const handler_names = existing_handlers.map((h: any) => h.name || String(h));

		if (handler_names.includes((unique_handler as any).__name__)) {
			throw new Error(
				`[${watchdog_class_name}] Duplicate handler registration attempted! ` +
					`Handler ${(unique_handler as any).__name__} is already registered for ${event_class.name}. ` +
					`This likely means attach_to_session() was called multiple times.`
			);
		}

		event_bus.on(event_class, unique_handler);
	}

	attach_to_session(): void {
		/**Attach watchdog to its browser session and start monitoring.

		This method handles event listener registration. The watchdog is already
		bound to a browser session via self.browser_session from initialization.
		*/
		// Register event handlers automatically based on method names
		if (!this.browser_session) {
			throw new Error(
				'Root CDP client not initialized - browser may not be connected yet'
			);
		}

		// Import events module dynamically
		// In TypeScript, we need to import the events module
		const events = require('./events');
		const event_classes: Record<string, new (...args: any[]) => BaseEvent<any>> = {};

		// Find all event classes
		for (const name of Object.keys(events)) {
			const obj = events[name];
			if (
				typeof obj === 'function' &&
				obj.prototype instanceof BaseEvent &&
				obj !== BaseEvent
			) {
				event_classes[name] = obj;
			}
		}

		// Find all handler methods (on_EventName)
		const registered_events = new Set<new (...args: any[]) => BaseEvent<any>>();
		for (const method_name of Object.getOwnPropertyNames(Object.getPrototypeOf(this))) {
			if (method_name.startsWith('on_') && typeof (this as any)[method_name] === 'function') {
				// Extract event name from method name (on_EventName -> EventName)
				const event_name = method_name.substring(3); // Remove 'on_' prefix

				if (event_name in event_classes) {
					const event_class = event_classes[event_name];

					// ASSERTION: If LISTENS_TO is defined, enforce it
					const ListensTo = (this.constructor as typeof BaseWatchdog).LISTENS_TO;
					if (ListensTo && ListensTo.length > 0) {
						if (!ListensTo.includes(event_class)) {
							throw new Error(
								`[${this.constructor.name}] Handler ${method_name} listens to ${event_name} ` +
									`but ${event_name} is not declared in LISTENS_TO: ${ListensTo.map((e) => e.name).join(', ')}`
							);
						}
					}

					const handler = (this as any)[method_name].bind(this);

					// Use the static helper to attach the handler
					BaseWatchdog.attach_handler_to_session(
						this.browser_session,
						event_class,
						handler
					);
					registered_events.add(event_class);
				}
			}
		}

		// ASSERTION: If LISTENS_TO is defined, ensure all declared events have handlers
		const ListensTo = (this.constructor as typeof BaseWatchdog).LISTENS_TO;
		if (ListensTo && ListensTo.length > 0) {
			const missing_handlers = ListensTo.filter((e) => !registered_events.has(e));
			if (missing_handlers.length > 0) {
				const missing_names = missing_handlers.map((e) => e.name);
				this.logger.warning(
					`[${this.constructor.name}] LISTENS_TO declares ${missing_names.join(', ')} ` +
						`but no handlers found (missing on_${missing_names.join('_, on_')} methods)`
				);
			}
		}
	}

	// Note: TypeScript doesn't have __del__ like Python, but we can use a cleanup method
	// or rely on garbage collection. For now, we'll provide a cleanup method.
	cleanup(): void {
		/**Clean up any running tasks during garbage collection.*/

		// A BIT OF MAGIC: Cancel any private attributes that look like async tasks
		try {
			for (const attr_name of Object.getOwnPropertyNames(this)) {
				// e.g. _browser_crash_watcher_task = Promise/Task
				if (attr_name.startsWith('_') && attr_name.endsWith('_task')) {
					try {
						const task = (this as any)[attr_name];
						if (
							task &&
							typeof task.cancel === 'function' &&
							!task.done &&
							!task.done()
						) {
							task.cancel();
							// this.logger.debug(`[${this.constructor.name}] Cancelled ${attr_name} during cleanup`)
						}
					} catch {
						// Ignore errors during cleanup
					}
				}

				// e.g. _cdp_download_tasks = Set<Promise> or Array<Promise>
				if (attr_name.startsWith('_') && attr_name.endsWith('_tasks')) {
					try {
						const tasks = (this as any)[attr_name];
						if (tasks && typeof tasks[Symbol.iterator] === 'function') {
							for (const task of tasks) {
								try {
									if (
										task &&
										typeof task.cancel === 'function' &&
										!task.done &&
										!task.done()
									) {
										task.cancel();
										// this.logger.debug(`[${this.constructor.name}] Cancelled ${attr_name} during cleanup`)
									}
								} catch {
									// Ignore errors during cleanup
								}
							}
						}
					} catch {
						// Ignore errors during cleanup
					}
				}
			}
		} catch (error: any) {
			// Import logger from utils
			const { logger } = require('../utils');
			logger.error(
				`⚠️ Error during BrowserSession ${this.constructor.name} garbage collection cleanup(): ${error.constructor.name}: ${error}`
			);
		}
	}
}
