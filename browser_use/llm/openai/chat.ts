/**
 * ChatOpenAI - A wrapper around AsyncOpenAI that implements the BaseLLM protocol.
 *
 * This class accepts all AsyncOpenAI parameters while adding model
 * and temperature parameters for the LLM interface (if temperature it not `None`).
 */

import { BaseChatModel, BaseModel, BaseModelConstructor } from '../base';
import { ModelProviderError, ModelRateLimitError } from '../exceptions';
import { BaseMessage } from '../messages';
import { SchemaOptimizer } from '../schema';
import { ChatInvokeCompletion, ChatInvokeUsage } from '../views';
import { OpenAIMessageSerializer } from './serializer';

// Type definitions for OpenAI client
type ChatModel = string;
type ReasoningEffort = 'low' | 'medium' | 'high';
type ServiceTier = 'auto' | 'default' | 'flex' | 'priority' | 'scale';

type JSONSchema = {
	name: string;
	strict: boolean;
	schema: Record<string, any>;
};

type ResponseFormatJSONSchema = {
	type: 'json_schema';
	json_schema: JSONSchema;
};

type ChatCompletionContentPartTextParam = {
	text: string;
	type: 'text';
};

type ChatCompletion = {
	choices: Array<{
		message: {
			content: string | null;
		};
		finish_reason?: string | null;
	}>;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		prompt_tokens_details?: {
			cached_tokens?: number;
		} | null;
		completion_tokens_details?: {
			reasoning_tokens?: number;
		} | null;
	} | null;
};

interface AsyncOpenAIClient {
	chat: {
		completions: {
			create(params: {
				model: string | ChatModel;
				messages: any[];
				temperature?: number;
				frequency_penalty?: number;
				max_completion_tokens?: number;
				top_p?: number;
				seed?: number;
				service_tier?: ServiceTier;
				reasoning_effort?: ReasoningEffort;
				response_format?: ResponseFormatJSONSchema;
			}): Promise<ChatCompletion>;
		};
	};
}

export interface ChatOpenAIConfig {
	// Model configuration
	model: ChatModel | string;
	temperature?: number | null;
	frequency_penalty?: number | null;
	reasoning_effort?: ReasoningEffort;
	seed?: number | null;
	service_tier?: ServiceTier | null;
	top_p?: number | null;
	add_schema_to_system_prompt?: boolean;
	dont_force_structured_output?: boolean;
	remove_min_items_from_schema?: boolean;
	remove_defaults_from_schema?: boolean;

	// Client initialization parameters
	api_key?: string | null;
	organization?: string | null;
	project?: string | null;
	base_url?: string | null;
	websocket_base_url?: string | null;
	timeout?: number | null;
	max_retries?: number;
	default_headers?: Record<string, string> | null;
	default_query?: Record<string, any> | null;
	http_client?: any | null;
	_strict_response_validation?: boolean;
	max_completion_tokens?: number | null;
	reasoning_models?: (ChatModel | string)[] | null;
}

export class ChatOpenAI implements BaseChatModel {
	// Model configuration
	model: ChatModel | string;
	temperature: number | null;
	frequency_penalty: number | null;
	reasoning_effort: ReasoningEffort;
	seed: number | null;
	service_tier: ServiceTier | null;
	top_p: number | null;
	add_schema_to_system_prompt: boolean;
	dont_force_structured_output: boolean;
	remove_min_items_from_schema: boolean;
	remove_defaults_from_schema: boolean;

	// Client initialization parameters
	api_key: string | null;
	organization: string | null;
	project: string | null;
	base_url: string | null;
	websocket_base_url: string | null;
	timeout: number | null;
	max_retries: number;
	default_headers: Record<string, string> | null;
	default_query: Record<string, any> | null;
	http_client: any | null;
	_strict_response_validation: boolean;
	max_completion_tokens: number | null;
	reasoning_models: (ChatModel | string)[] | null;

	_verified_api_keys: boolean = false;

	constructor(config: ChatOpenAIConfig) {
		this.model = config.model;
		this.temperature = config.temperature ?? 0.2;
		this.frequency_penalty = config.frequency_penalty ?? 0.3; // this avoids infinite generation of \t for models like 4.1-mini
		this.reasoning_effort = config.reasoning_effort ?? 'low';
		this.seed = config.seed ?? null;
		this.service_tier = config.service_tier ?? null;
		this.top_p = config.top_p ?? null;
		this.add_schema_to_system_prompt = config.add_schema_to_system_prompt ?? false;
		this.dont_force_structured_output = config.dont_force_structured_output ?? false;
		this.remove_min_items_from_schema = config.remove_min_items_from_schema ?? false;
		this.remove_defaults_from_schema = config.remove_defaults_from_schema ?? false;

		this.api_key = config.api_key ?? null;
		this.organization = config.organization ?? null;
		this.project = config.project ?? null;
		this.base_url = config.base_url ?? null;
		this.websocket_base_url = config.websocket_base_url ?? null;
		this.timeout = config.timeout ?? null;
		this.max_retries = config.max_retries ?? 5; // Increase default retries for automation reliability
		this.default_headers = config.default_headers ?? null;
		this.default_query = config.default_query ?? null;
		this.http_client = config.http_client ?? null;
		this._strict_response_validation = config._strict_response_validation ?? false;
		this.max_completion_tokens = config.max_completion_tokens ?? 4096;
		this.reasoning_models =
			config.reasoning_models ??
			['o4-mini', 'o3', 'o3-mini', 'o1', 'o1-pro', 'o3-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
	}

	get provider(): string {
		return 'openai';
	}

	get name(): string {
		return String(this.model);
	}

	private _getClientParams(): Record<string, any> {
		/**Prepare client parameters dictionary.*/
		// Define base client params
		const baseParams: Record<string, any> = {
			api_key: this.api_key,
			organization: this.organization,
			project: this.project,
			base_url: this.base_url,
			websocket_base_url: this.websocket_base_url,
			timeout: this.timeout,
			max_retries: this.max_retries,
			default_headers: this.default_headers,
			default_query: this.default_query,
			_strict_response_validation: this._strict_response_validation,
		};

		// Create client_params dict with non-None values
		const clientParams: Record<string, any> = {};
		for (const [k, v] of Object.entries(baseParams)) {
			if (v !== null && v !== undefined) {
				clientParams[k] = v;
			}
		}

		// Add http_client if provided
		if (this.http_client !== null && this.http_client !== undefined) {
			clientParams.http_client = this.http_client;
		}

		return clientParams;
	}

	getClient(): AsyncOpenAIClient {
		/**
		 * Returns an AsyncOpenAI client.
		 *
		 * Returns:
		 *     AsyncOpenAI: An instance of the AsyncOpenAI client.
		 */
		// In a real implementation, you would use:
		// import { OpenAI } from 'openai';
		// const clientParams = this._getClientParams();
		// return new OpenAI(clientParams);
		throw new Error(
			'getClient() must be implemented with actual OpenAI client library. ' + 'Install: npm install openai'
		);
	}

	private _getUsage(response: ChatCompletion): ChatInvokeUsage | null {
		if (response.usage !== null && response.usage !== undefined) {
			let completionTokens = response.usage.completion_tokens;
			const completionTokenDetails = response.usage.completion_tokens_details;
			if (completionTokenDetails !== null && completionTokenDetails !== undefined) {
				const reasoningTokens = completionTokenDetails.reasoning_tokens;
				if (reasoningTokens !== null && reasoningTokens !== undefined) {
					completionTokens += reasoningTokens;
				}
			}

			const usage: ChatInvokeUsage = {
				prompt_tokens: response.usage.prompt_tokens,
				prompt_cached_tokens:
					response.usage.prompt_tokens_details?.cached_tokens ?? null,
				prompt_cache_creation_tokens: null,
				prompt_image_tokens: null,
				completion_tokens: completionTokens,
				total_tokens: response.usage.total_tokens,
			};
			return usage;
		} else {
			return null;
		}
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
	 * Invoke the model with the given messages.
	 *
	 * @param messages - List of chat messages
	 * @param output_format - Optional Pydantic model class for structured output
	 * @returns Either a string response or an instance of output_format
	 */
	async ainvoke<T extends BaseModel = BaseModel>(
		messages: BaseMessage[],
		output_format?: BaseModelConstructor<T> | null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>> {
		const openaiMessages = OpenAIMessageSerializer.serializeMessages(messages);

		try {
			const modelParams: Record<string, any> = {};

			if (this.temperature !== null && this.temperature !== undefined) {
				modelParams.temperature = this.temperature;
			}

			if (this.frequency_penalty !== null && this.frequency_penalty !== undefined) {
				modelParams.frequency_penalty = this.frequency_penalty;
			}

			if (this.max_completion_tokens !== null && this.max_completion_tokens !== undefined) {
				modelParams.max_completion_tokens = this.max_completion_tokens;
			}

			if (this.top_p !== null && this.top_p !== undefined) {
				modelParams.top_p = this.top_p;
			}

			if (this.seed !== null && this.seed !== undefined) {
				modelParams.seed = this.seed;
			}

			if (this.service_tier !== null && this.service_tier !== undefined) {
				modelParams.service_tier = this.service_tier;
			}

			if (
				this.reasoning_models &&
				this.reasoning_models.some((m) => String(m).toLowerCase().includes(String(this.model).toLowerCase()))
			) {
				modelParams.reasoning_effort = this.reasoning_effort;
				delete modelParams.temperature;
				delete modelParams.frequency_penalty;
			}

			if (output_format === null || output_format === undefined) {
				// Return string response
				const response = await this.getClient().chat.completions.create({
					model: this.model,
					messages: openaiMessages,
					...modelParams,
				});

				const usage = this._getUsage(response);
				return {
					completion: response.choices[0].message.content || '',
					usage: usage,
					stop_reason: response.choices[0]?.finish_reason ?? null,
				};
			} else {
				const formatInstance = new output_format();
				const responseFormat: JSONSchema = {
					name: 'agent_output',
					strict: true,
					schema: SchemaOptimizer.createOptimizedJsonSchema(output_format, {
						remove_min_items: this.remove_min_items_from_schema,
						remove_defaults: this.remove_defaults_from_schema,
					}),
				};

				// Add JSON schema to system prompt if requested
				if (
					this.add_schema_to_system_prompt &&
					openaiMessages.length > 0 &&
					openaiMessages[0].role === 'system'
				) {
					const schemaText = `\n<json_schema>\n${JSON.stringify(responseFormat)}\n</json_schema>`;
					if (typeof openaiMessages[0].content === 'string') {
						openaiMessages[0].content += schemaText;
					} else if (Array.isArray(openaiMessages[0].content)) {
						openaiMessages[0].content = [
							...openaiMessages[0].content,
							{ text: schemaText, type: 'text' } as ChatCompletionContentPartTextParam,
						];
					}
				}

				let response: ChatCompletion;
				if (this.dont_force_structured_output) {
					response = await this.getClient().chat.completions.create({
						model: this.model,
						messages: openaiMessages,
						...modelParams,
					});
				} else {
					// Return structured response
					response = await this.getClient().chat.completions.create({
						model: this.model,
						messages: openaiMessages,
						response_format: {
							type: 'json_schema',
							json_schema: responseFormat,
						},
						...modelParams,
					});
				}

				if (response.choices[0].message.content === null) {
					throw new ModelProviderError(
						'Failed to parse structured output from model response',
						500,
						this.name
					);
				}

				const usage = this._getUsage(response);
				const formatInstanceForValidation = new output_format();
				const parsed = formatInstanceForValidation.model_validate_json(response.choices[0].message.content);

				return {
					completion: parsed as T,
					usage: usage,
					stop_reason: response.choices[0]?.finish_reason ?? null,
				};
			}
		} catch (error: any) {
			if (error.name === 'RateLimitError') {
				throw new ModelRateLimitError(error.message || String(error), this.name);
			}

			if (error.name === 'APIConnectionError') {
				throw new ModelProviderError(String(error), undefined, this.name);
			}

			if (error.name === 'APIStatusError') {
				throw new ModelProviderError(error.message || String(error), error.status_code, this.name);
			}

			throw new ModelProviderError(String(error), undefined, this.name);
		}
	}
}
