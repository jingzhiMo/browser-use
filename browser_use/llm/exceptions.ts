/**
 * Exception types for LLM models
 */

export class ModelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ModelError';
	}
}

export class ModelProviderError extends ModelError {
	message: string;
	status_code: number;
	model: string | null;

	constructor(message: string, status_code: number = 502, model: string | null = null) {
		super(message);
		this.name = 'ModelProviderError';
		this.message = message;
		this.status_code = status_code;
		this.model = model;
	}
}

export class ModelRateLimitError extends ModelProviderError {
	/**Exception raised when a model provider returns a rate limit error.*/

	constructor(message: string, status_code: number = 429, model: string | null = null) {
		super(message, status_code, model);
		this.name = 'ModelRateLimitError';
	}
}
