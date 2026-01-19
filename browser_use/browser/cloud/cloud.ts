/**
 * TypeScript implementation of cloud browser service
 * Converted from browser_use/browser/cloud/cloud.py
 * 
 * Cloud browser service integration for browser-use.
 *
 * This module provides integration with the browser-use cloud browser service.
 * When cloud_browser=True, it automatically creates a cloud browser instance
 * and returns the CDP URL for connection.
 */

import type {
	CloudBrowserAuthError,
	CloudBrowserError,
	CloudBrowserResponse,
	CreateBrowserRequest,
} from './views';

/**
 * Client for browser-use cloud browser service.
 */
export class CloudBrowserClient {
	api_base_url: string;
	client: any; // Would be httpx.AsyncClient in Python, use fetch or axios in TypeScript
	current_session_id: string | null = null;

	constructor(api_base_url: string = 'https://api.browser-use.com') {
		this.api_base_url = api_base_url;
		// TODO: Initialize HTTP client (use fetch API or axios)
		// For now, we'll use fetch API
		this.client = null; // Will use fetch directly
	}

	async create_browser(
		request: CreateBrowserRequest,
		extra_headers: Record<string, string> | null = null
	): Promise<CloudBrowserResponse> {
		/**Create a new cloud browser instance. For full docs refer to https://docs.cloud.browser-use.com/api-reference/v-2-api-current/browsers/create-browser-session-browsers-post

		Args:
			request: CreateBrowserRequest object containing browser creation parameters

		Returns:
			CloudBrowserResponse: Contains CDP URL and other browser info
		*/
		const url = `${this.api_base_url}/api/v2/browsers`;

		// Try to get API key from environment variable first, then auth config
		let api_token = process.env.BROWSER_USE_API_KEY || null;

		if (!api_token) {
			// Fallback to auth config file
			try {
				// TODO: Implement CloudAuthConfig.load_from_file() in TypeScript
				// const auth_config = CloudAuthConfig.load_from_file();
				// api_token = auth_config.api_token;
			} catch {
				// Ignore errors
			}
		}

		if (!api_token) {
			throw new CloudBrowserAuthError(
				'No authentication token found. Please set BROWSER_USE_API_KEY environment variable to authenticate with the cloud service. You can also create an API key at https://cloud.browser-use.com/new-api-key'
			);
		}

		const headers: Record<string, string> = {
			'X-Browser-Use-API-Key': api_token,
			'Content-Type': 'application/json',
			...(extra_headers || {}),
		};

		// Convert request to dictionary and exclude unset fields
		const request_body: Record<string, any> = {};
		if (request.profile_id !== undefined && request.profile_id !== null) {
			request_body.cloud_profile_id = request.profile_id;
		}
		if (request.proxy_country_code !== undefined && request.proxy_country_code !== null) {
			request_body.cloud_proxy_country_code = request.proxy_country_code;
		}
		if (request.timeout !== undefined && request.timeout !== null) {
			request_body.cloud_timeout = request.timeout;
		}

		try {
			console.info('🌤️ Creating cloud browser instance...');

			const response = await fetch(url, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(request_body),
			});

			if (response.status === 401) {
				throw new CloudBrowserAuthError(
					'Authentication failed. Please make sure you have set BROWSER_USE_API_KEY environment variable to authenticate with the cloud service. You can also create an API key at https://cloud.browser-use.com/new-api-key'
				);
			} else if (response.status === 403) {
				throw new CloudBrowserAuthError(
					'Access forbidden. Please check your browser-use cloud subscription status.'
				);
			} else if (!response.ok) {
				let error_msg = `Failed to create cloud browser: HTTP ${response.status}`;
				try {
					const error_data = await response.json();
					if (error_data.detail) {
						error_msg += ` - ${error_data.detail}`;
					}
				} catch {
					// Ignore JSON parsing errors
				}
				throw new CloudBrowserError(error_msg);
			}

			const browser_data = await response.json();
			const browser_response: CloudBrowserResponse = {
				id: browser_data.id,
				status: browser_data.status,
				liveUrl: browser_data.liveUrl,
				cdpUrl: browser_data.cdpUrl,
				timeoutAt: browser_data.timeoutAt,
				startedAt: browser_data.startedAt,
				finishedAt: browser_data.finishedAt || null,
			};

			// Store session ID for cleanup
			this.current_session_id = browser_response.id;

			console.info(`🌤️ Cloud browser created successfully: ${browser_response.id}`);
			console.debug(`🌤️ CDP URL: ${browser_response.cdpUrl}`);
			// Cyan color for live URL (using ANSI codes)
			console.info(`\x1b[36m🔗 Live URL: ${browser_response.liveUrl}\x1b[0m`);

			return browser_response;
		} catch (error: any) {
			if (error instanceof CloudBrowserError || error instanceof CloudBrowserAuthError) {
				throw error;
			}
			if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
				throw new CloudBrowserError(
					'Timeout while creating cloud browser. Please try again.'
				);
			}
			if (error.name === 'TypeError' && error.message?.includes('fetch')) {
				throw new CloudBrowserError(
					'Failed to connect to cloud browser service. Please check your internet connection.'
				);
			}
			throw new CloudBrowserError(`Unexpected error creating cloud browser: ${error}`);
		}
	}

	async stop_browser(
		session_id: string | null = null,
		extra_headers: Record<string, string> | null = null
	): Promise<CloudBrowserResponse> {
		/**Stop a cloud browser session.

		Args:
			session_id: Session ID to stop. If None, uses current session.

		Returns:
			CloudBrowserResponse: Updated browser info with stopped status

		Raises:
			CloudBrowserAuthError: If authentication fails
			CloudBrowserError: If stopping fails
		*/
		if (session_id === null) {
			session_id = this.current_session_id;
		}

		if (!session_id) {
			throw new CloudBrowserError(
				'No session ID provided and no current session available'
			);
		}

		const url = `${this.api_base_url}/api/v2/browsers/${session_id}`;

		// Try to get API key from environment variable first, then auth config
		let api_token = process.env.BROWSER_USE_API_KEY || null;

		if (!api_token) {
			// Fallback to auth config file
			try {
				// TODO: Implement CloudAuthConfig.load_from_file() in TypeScript
				// const auth_config = CloudAuthConfig.load_from_file();
				// api_token = auth_config.api_token;
			} catch {
				// Ignore errors
			}
		}

		if (!api_token) {
			throw new CloudBrowserAuthError(
				'No authentication token found. Please set BROWSER_USE_API_KEY environment variable to authenticate with the cloud service. You can also create an API key at https://cloud.browser-use.com/new-api-key'
			);
		}

		const headers: Record<string, string> = {
			'X-Browser-Use-API-Key': api_token,
			'Content-Type': 'application/json',
			...(extra_headers || {}),
		};

		const request_body = { action: 'stop' };

		try {
			console.info(`🌤️ Stopping cloud browser session: ${session_id}`);

			const response = await fetch(url, {
				method: 'PATCH',
				headers: headers,
				body: JSON.stringify(request_body),
			});

			if (response.status === 401) {
				throw new CloudBrowserAuthError(
					'Authentication failed. Please make sure you have set the BROWSER_USE_API_KEY environment variable to authenticate with the cloud service.'
				);
			} else if (response.status === 404) {
				// Session already stopped or doesn't exist - treating as error and clearing session
				console.debug(`🌤️ Cloud browser session ${session_id} not found (already stopped)`);
				// Clear current session if it was this one
				if (session_id === this.current_session_id) {
					this.current_session_id = null;
				}
				throw new CloudBrowserError(`Cloud browser session ${session_id} not found`);
			} else if (!response.ok) {
				let error_msg = `Failed to stop cloud browser: HTTP ${response.status}`;
				try {
					const error_data = await response.json();
					if (error_data.detail) {
						error_msg += ` - ${error_data.detail}`;
					}
				} catch {
					// Ignore JSON parsing errors
				}
				throw new CloudBrowserError(error_msg);
			}

			const browser_data = await response.json();
			const browser_response: CloudBrowserResponse = {
				id: browser_data.id,
				status: browser_data.status,
				liveUrl: browser_data.liveUrl,
				cdpUrl: browser_data.cdpUrl,
				timeoutAt: browser_data.timeoutAt,
				startedAt: browser_data.startedAt,
				finishedAt: browser_data.finishedAt || null,
			};

			// Clear current session if it was this one
			if (session_id === this.current_session_id) {
				this.current_session_id = null;
			}

			console.info(`🌤️ Cloud browser session stopped: ${browser_response.id}`);
			console.debug(`🌤️ Status: ${browser_response.status}`);

			return browser_response;
		} catch (error: any) {
			if (error instanceof CloudBrowserError || error instanceof CloudBrowserAuthError) {
				throw error;
			}
			if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
				throw new CloudBrowserError(
					'Timeout while stopping cloud browser. Please try again.'
				);
			}
			if (error.name === 'TypeError' && error.message?.includes('fetch')) {
				throw new CloudBrowserError(
					'Failed to connect to cloud browser service. Please check your internet connection.'
				);
			}
			throw new CloudBrowserError(`Unexpected error stopping cloud browser: ${error}`);
		}
	}

	async close(): Promise<void> {
		/**Close the HTTP client and cleanup any active sessions.*/
		// Try to stop current session if active
		if (this.current_session_id) {
			try {
				await this.stop_browser();
			} catch (error: any) {
				console.debug(`Failed to stop cloud browser session during cleanup: ${error}`);
			}
		}

		// No need to close fetch API client (it's stateless)
		// If using axios or similar, would need: await this.client.close();
	}
}
