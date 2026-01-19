/**
 * TypeScript implementation of about:blank watchdog
 * Converted from browser_use/browser/watchdogs/aboutblank_watchdog.py
 */

import type { BaseEvent } from 'bubus';
import type { TargetID } from 'cdp_use/cdp/target';
import type {
	AboutBlankDVDScreensaverShownEvent,
	BrowserStopEvent,
	BrowserStoppedEvent,
	CloseTabEvent,
	NavigateToUrlEvent,
	TabClosedEvent,
	TabCreatedEvent,
} from '../events';
import { BaseWatchdog } from '../watchdog_base';

/**
 * Ensures there's always exactly one about:blank tab with DVD screensaver.
 */
export class AboutBlankWatchdog extends BaseWatchdog {
	// Event contracts
	static LISTENS_TO: (new (...args: any[]) => BaseEvent<any>)[] = [
		// BrowserStopEvent,
		// BrowserStoppedEvent,
		// TabCreatedEvent,
		// TabClosedEvent,
	];
	static EMITS: (new (...args: any[]) => BaseEvent<any>)[] = [
		// NavigateToUrlEvent,
		// CloseTabEvent,
		// AboutBlankDVDScreensaverShownEvent,
	];

	private _stopping: boolean = false;

	async on_BrowserStopEvent(event: BrowserStopEvent): Promise<void> {
		/**Handle browser stop request - stop creating new tabs.*/
		this._stopping = true;
	}

	async on_BrowserStoppedEvent(event: BrowserStoppedEvent): Promise<void> {
		/**Handle browser stopped event.*/
		this._stopping = true;
	}

	async on_TabCreatedEvent(event: TabCreatedEvent): Promise<void> {
		/**Check tabs when a new tab is created.*/

		// If an about:blank tab was created, show DVD screensaver on all about:blank tabs
		if (event.url === 'about:blank') {
			await this._show_dvd_screensaver_on_about_blank_tabs();
		}
	}

	async on_TabClosedEvent(event: TabClosedEvent): Promise<void> {
		/**Check tabs when a tab is closed and proactively create about:blank if needed.*/

		// Don't create new tabs if browser is shutting down
		if (this._stopping) {
			return;
		}

		// Check if we're about to close the last tab (event happens BEFORE tab closes)
		// Use _cdp_get_all_pages for quick check without fetching titles
		const page_targets = await this.browser_session._cdp_get_all_pages();
		if (page_targets.length < 1) {
			this.logger.debug(
				'[AboutBlankWatchdog] Last tab closing, creating new about:blank tab to avoid closing entire browser'
			);
			// Create the animation tab since no tabs should remain
			const navigate_event = this.event_bus.dispatch(
				new NavigateToUrlEvent({ url: 'about:blank', new_tab: true })
			);
			await navigate_event;
			// Show DVD screensaver on the new tab
			await this._show_dvd_screensaver_on_about_blank_tabs();
		} else {
			// Multiple tabs exist, check after close
			await this._check_and_ensure_about_blank_tab();
		}
	}

	async attach_to_target(target_id: TargetID): Promise<void> {
		/**AboutBlankWatchdog doesn't monitor individual targets.*/
		// pass
	}

	async _check_and_ensure_about_blank_tab(): Promise<void> {
		/**Check current tabs and ensure exactly one about:blank tab with animation exists.*/
		try {
			// For quick checks, just get page targets without titles to reduce noise
			const page_targets = await this.browser_session._cdp_get_all_pages();

			// If no tabs exist at all, create one to keep browser alive
			if (page_targets.length === 0) {
				// Only create a new tab if there are no tabs at all
				this.logger.debug(
					'[AboutBlankWatchdog] No tabs exist, creating new about:blank DVD screensaver tab'
				);
				const navigate_event = this.event_bus.dispatch(
					new NavigateToUrlEvent({ url: 'about:blank', new_tab: true })
				);
				await navigate_event;
				// Show DVD screensaver on the new tab
				await this._show_dvd_screensaver_on_about_blank_tabs();
			}
			// Otherwise there are tabs, don't create new ones to avoid interfering

		} catch (error: any) {
			this.logger.error(`[AboutBlankWatchdog] Error ensuring about:blank tab: ${error}`);
		}
	}

	async _show_dvd_screensaver_on_about_blank_tabs(): Promise<void> {
		/**Show DVD screensaver on all about:blank pages only.*/
		try {
			// Get just the page targets without expensive title fetching
			const page_targets = await this.browser_session._cdp_get_all_pages();
			const browser_session_label = String(this.browser_session.id).slice(-4);

			for (const page_target of page_targets) {
				const target_id = page_target.targetId;
				const url = page_target.url;

				// Only target about:blank pages specifically
				if (url === 'about:blank') {
					await this._show_dvd_screensaver_loading_animation_cdp(
						target_id,
						browser_session_label
					);
				}
			}
		} catch (error: any) {
			this.logger.error(`[AboutBlankWatchdog] Error showing DVD screensaver: ${error}`);
		}
	}

	async _show_dvd_screensaver_loading_animation_cdp(
		target_id: TargetID,
		browser_session_label: string
	): Promise<void> {
		/**
		 * Injects a DVD screensaver-style bouncing logo loading animation overlay into the target using CDP.
		 * This is used to visually indicate that the browser is setting up or waiting.
		 */
		try {
			// Create temporary session for this target without switching focus
			const temp_session = await this.browser_session.get_or_create_cdp_session({
				target_id: target_id,
				focus: false,
			});

			// Inject the DVD screensaver script (from main branch with idempotency added)
			const script = `
				(function(browser_session_label) {
					// Idempotency check
					if (window.__dvdAnimationRunning) {
						return; // Already running, don't add another
					}
					window.__dvdAnimationRunning = true;
					
					// Ensure document.body exists before proceeding
					if (!document.body) {
						// Try again after DOM is ready
						window.__dvdAnimationRunning = false; // Reset flag to retry
						if (document.readyState === 'loading') {
							document.addEventListener('DOMContentLoaded', () => arguments.callee(browser_session_label));
						}
						return;
					}
					
					const animated_title = \`Starting agent \${browser_session_label}...\`;
					if (document.title === animated_title) {
						return;      // already run on this tab, dont run again
					}
					document.title = animated_title;

					// Create the main overlay
					const loadingOverlay = document.createElement('div');
					loadingOverlay.id = 'pretty-loading-animation';
					loadingOverlay.style.position = 'fixed';
					loadingOverlay.style.top = '0';
					loadingOverlay.style.left = '0';
					loadingOverlay.style.width = '100vw';
					loadingOverlay.style.height = '100vh';
					loadingOverlay.style.background = '#000';
					loadingOverlay.style.zIndex = '99999';
					loadingOverlay.style.overflow = 'hidden';

					// Create the image element
					const img = document.createElement('img');
					img.src = 'https://cf.browser-use.com/logo.svg';
					img.alt = 'Browser-Use';
					img.style.width = '200px';
					img.style.height = 'auto';
					img.style.position = 'absolute';
					img.style.left = '0px';
					img.style.top = '0px';
					img.style.zIndex = '2';
					img.style.opacity = '0.8';

					loadingOverlay.appendChild(img);
					document.body.appendChild(loadingOverlay);

					// DVD screensaver bounce logic
					let x = Math.random() * (window.innerWidth - 300);
					let y = Math.random() * (window.innerHeight - 300);
					let dx = 1.2 + Math.random() * 0.4; // px per frame
					let dy = 1.2 + Math.random() * 0.4;
					// Randomize direction
					if (Math.random() > 0.5) dx = -dx;
					if (Math.random() > 0.5) dy = -dy;

					function animate() {
						const imgWidth = img.offsetWidth || 300;
						const imgHeight = img.offsetHeight || 300;
						x += dx;
						y += dy;

						if (x <= 0) {
							x = 0;
							dx = Math.abs(dx);
						} else if (x + imgWidth >= window.innerWidth) {
							x = window.innerWidth - imgWidth;
							dx = -Math.abs(dx);
						}
						if (y <= 0) {
							y = 0;
							dy = Math.abs(dy);
						} else if (y + imgHeight >= window.innerHeight) {
							y = window.innerHeight - imgHeight;
							dy = -Math.abs(dy);
						}

						img.style.left = \`\${x}px\`;
						img.style.top = \`\${y}px\`;

						requestAnimationFrame(animate);
					}
					animate();

					// Responsive: update bounds on resize
					window.addEventListener('resize', () => {
						x = Math.min(x, window.innerWidth - img.offsetWidth);
						y = Math.min(y, window.innerHeight - img.offsetHeight);
					});

					// Add a little CSS for smoothness
					const style = document.createElement('style');
					style.textContent = \`
						#pretty-loading-animation {
							/*backdrop-filter: blur(2px) brightness(0.9);*/
						}
						#pretty-loading-animation img {
							user-select: none;
							pointer-events: none;
						}
					\`;
					document.head.appendChild(style);
				})('${browser_session_label}');
			`;

			await temp_session.cdp_client.send.Runtime.evaluate({
				params: { expression: script },
				session_id: temp_session.session_id,
			});

			// No need to detach - session is cached

			// Dispatch event
			this.event_bus.dispatch(
				new AboutBlankDVDScreensaverShownEvent({ target_id: target_id })
			);
		} catch (error: any) {
			this.logger.error(`[AboutBlankWatchdog] Error injecting DVD screensaver: ${error}`);
		}
	}
}
