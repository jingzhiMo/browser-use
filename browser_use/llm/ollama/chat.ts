/**
 * TypeScript implementation of ChatOllama
 * A wrapper around Ollama's chat model
 */

import { OllamaMessageSerializer } from './serializer';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * BaseModel interface - represents a Pydantic BaseModel equivalent
 * In TypeScript, this would typically be a class with static methods
 */
interface BaseModel {
	model_json_schema(): Record<string, any>;
	model_validate_json(json: string): this;
}

/**
 * BaseModel constructor type
 */
type BaseModelConstructor<T extends BaseModel> = new () => T;

/**
 * BaseMessage type (from messages.ts)
 */
type BaseMessage = any; // Will be imported from messages module

/**
 * ChatInvokeUsage type
 */
type ChatInvokeUsage = {
	prompt_tokens: number;
	prompt_cached_tokens?: number | null;
	prompt_cache_creation_tokens?: number | null;
	prompt_image_tokens?: number | null;
	completion_tokens: number;
	total_tokens: number;
};

/**
 * ChatInvokeCompletion generic type
 */
type ChatInvokeCompletion<T> = {
	completion: T;
	thinking?: string | null;
	redacted_thinking?: string | null;
	usage: ChatInvokeUsage | null;
	stop_reason?: string | null;
};

/**
 * BaseChatModel interface
 */
interface BaseChatModel {
	_verified_api_keys?: boolean;
	model: string;
	readonly provider: string;
	readonly name: string;
	readonly model_name: string;
	ainvoke<T extends BaseModel>(
		messages: BaseMessage[],
		output_format?: typeof T | null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<T>>;
	ainvoke(
		messages: BaseMessage[],
		output_format?: null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<string>>;
}

/**
 * Ollama Options type
 */
type OllamaOptions = Record<string, any> | null | undefined;

/**
 * Ollama Client Response type
 */
type OllamaChatResponse = {
	message: {
		content: string | null;
		role?: string;
	};
	done?: boolean;
	model?: string;
	created_at?: string;
};

/**
 * Ollama Async Client interface
 */
interface OllamaAsyncClient {
	chat(params: {
		model: string;
		messages: any[];
		format?: Record<string, any>;
		options?: OllamaOptions;
	}): Promise<OllamaChatResponse>;
}

// ============================================================================
// Exception Types
// ============================================================================

class ModelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ModelError';
	}
}

class ModelProviderError extends ModelError {
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

// ============================================================================
// ChatOllama Class
// ============================================================================

interface ChatOllamaConfig {
	model: string;
	host?: string | null;
	timeout?: number | null;
	client_params?: Record<string, any> | null;
	ollama_options?: Record<string, any> | OllamaOptions | null;
}

export class ChatOllama implements BaseChatModel {
	model: string;
	host: string | null;
	timeout: number | null;
	client_params: Record<string, any> | null;
	ollama_options: Record<string, any> | OllamaOptions | null;

	_verified_api_keys: boolean = false;

	constructor(config: ChatOllamaConfig) {
		this.model = config.model;
		this.host = config.host ?? null;
		this.timeout = config.timeout ?? null;
		this.client_params = config.client_params ?? null;
		this.ollama_options = config.ollama_options ?? null;
	}

	/**
	 * Get the provider name
	 */
	get provider(): string {
		return 'ollama';
	}

	/**
	 * Get the model name (alias for model)
	 */
	get name(): string {
		return this.model;
	}

	/**
	 * Get the model name (legacy support)
	 */
	get model_name(): string {
		return this.model;
	}

	/**
	 * Prepare client parameters dictionary
	 */
	private _getClientParams(): Record<string, any> {
		return {
			host: this.host,
			timeout: this.timeout,
			client_params: this.client_params,
		};
	}

	/**
	 * Returns an OllamaAsyncClient client.
	 * 
	 * In a real implementation, you would import and use the actual Ollama client:
	 * ```typescript
	 * import { Ollama } from 'ollama';
	 * return new Ollama({ 
	 *   host: this.host, 
	 *   timeout: this.timeout, 
	 *   ...this.client_params 
	 * });
	 * ```
	 * 
	 * Install: `npm install ollama`
	 */
	getClient(): OllamaAsyncClient {
		// This is a placeholder - implement with actual Ollama client library
		// For now, this is a type placeholder that will need to be implemented
		throw new Error(
			'getClient() must be implemented with actual Ollama client library. ' +
			'Install: npm install ollama'
		);
	}

	/**
	 * Invoke the chat model with string output
	 */
	async ainvoke(
		messages: BaseMessage[],
		output_format?: null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<string>>;

	/**
	 * Invoke the chat model with structured output
	 */
	async ainvoke<T extends BaseModel>(
		messages: BaseMessage[],
		output_format: BaseModelConstructor<T>,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<T>>;

	/**
	 * Main implementation of ainvoke
	 */
	async ainvoke<T extends BaseModel = BaseModel>(
		messages: BaseMessage[],
		output_format?: BaseModelConstructor<T> | null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>> {
		const ollamaMessages = OllamaMessageSerializer.serializeMessages(messages);

		try {
			if (output_format === null || output_format === undefined) {
				const response = await this.getClient().chat({
					model: this.model,
					messages: ollamaMessages,
					options: this.ollama_options,
				});

				return {
					completion: response.message.content || '',
					usage: null,
				};
			} else {
				// Create an instance to get the schema
				const formatInstance = new output_format();
				const schema = formatInstance.model_json_schema();

				const response = await this.getClient().chat({
					model: this.model,
					messages: ollamaMessages,
					format: schema,
					options: this.ollama_options,
				});

				const completionContent = response.message.content || '';
				// Parse JSON and validate using the output format
				const formatInstanceForValidation = new output_format();
				const completion = formatInstanceForValidation.model_validate_json(completionContent);

				return {
					completion: completion as T,
					usage: null,
				};
			}
		} catch (error: any) {
			throw new ModelProviderError(
				error?.message || String(error),
				error?.status_code,
				this.name
			);
		}
	}
}
