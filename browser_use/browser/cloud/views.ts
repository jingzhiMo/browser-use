/**
 * TypeScript implementation of cloud browser views
 * Converted from browser_use/browser/cloud/views.py
 */

export type ProxyCountryCode =
	| 'us' // United States
	| 'uk' // United Kingdom
	| 'fr' // France
	| 'it' // Italy
	| 'jp' // Japan
	| 'au' // Australia
	| 'de' // Germany
	| 'fi' // Finland
	| 'ca' // Canada
	| 'in' // India
	| string;

// Browser session timeout limits (in minutes)
export const MAX_FREE_USER_SESSION_TIMEOUT = 15; // Free users limited to 15 minutes
export const MAX_PAID_USER_SESSION_TIMEOUT = 240; // Paid users can go up to 4 hours

/**
 * Request to create a cloud browser instance.
 *
 * Args:
 *     cloud_profile_id: The ID of the profile to use for the session
 *     cloud_proxy_country_code: Country code for proxy location
 *     cloud_timeout: The timeout for the session in minutes
 */
export interface CreateBrowserRequest {
	profile_id?: string | null;
	/**The ID of the profile to use for the session. Can be a UUID or a string of UUID.*/
	proxy_country_code?: ProxyCountryCode | null;
	/**Country code for proxy location.*/
	timeout?: number | null;
	/**The timeout for the session in minutes. Free users are limited to 15 minutes, paid users can use up to 240 minutes (4 hours).*/
}

export type CloudBrowserParams = CreateBrowserRequest; // alias for easier readability

/**
 * Response from cloud browser API.
 */
export interface CloudBrowserResponse {
	id: string;
	status: string;
	liveUrl: string;
	cdpUrl: string;
	timeoutAt: string;
	startedAt: string;
	finishedAt?: string | null;
}

/**
 * Exception raised when cloud browser operations fail.
 */
export class CloudBrowserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CloudBrowserError';
	}
}

/**
 * Exception raised when cloud browser authentication fails.
 */
export class CloudBrowserAuthError extends CloudBrowserError {
	constructor(message: string) {
		super(message);
		this.name = 'CloudBrowserAuthError';
	}
}
