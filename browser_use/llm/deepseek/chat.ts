/**
 * ChatDeepSeek - DeepSeek /chat/completions wrapper (OpenAI-compatible).
 */

import { BaseChatModel, BaseModel, BaseModelConstructor } from '../base';
import { ModelProviderError, ModelRateLimitError } from '../exceptions';
import { BaseMessage } from '../messages';
import { SchemaOptimizer } from '../schema';
import { ChatInvokeCompletion } from '../views';
import { DeepSeekMessageSerializer } from './serializer';

// Type definitions for OpenAI-compatible client
interface AsyncOpenAIClient {
	chat: {
		completions: {
			create(params: {
				model: string;
				messages: any[];
				temperature?: number;
				max_tokens?: number;
				top_p?: number;
				seed?: number;
				tools?: any[];
				tool_choice?: any;
				response_format?: any;
				stop?: string[];
				prefix?: boolean;
			}): Promise<{
				choices: Array<{
					message: {
						content: string | null;
						tool_calls?: Array<{
							function: {
								name: string;
								arguments: string | Record<string, any>;
							};
						}>;
					};
				}>;
			}>;
		};
	};
}

export interface ChatDeepSeekConfig {
	model?: string;
	max_tokens?: number | null;
	temperature?: number | null;
	top_p?: number | null;
	seed?: number | null;
	api_key?: string | null;
	base_url?: string | null;
	timeout?: number | null;
	client_params?: Record<string, any> | null;
}

export class ChatDeepSeek implements BaseChatModel {
	model: string;
	max_tokens: number | null;
	temperature: number | null;
	top_p: number | null;
	seed: number | null;
	api_key: string | null;
	base_url: string | null;
	timeout: number | null;
	client_params: Record<string, any> | null;

	_verified_api_keys: boolean = false;

	constructor(config: ChatDeepSeekConfig = {}) {
		this.model = config.model || 'deepseek-chat';
		this.max_tokens = config.max_tokens ?? null;
		this.temperature = config.temperature ?? null;
		this.top_p = config.top_p ?? null;
		this.seed = config.seed ?? null;
		this.api_key = config.api_key ?? null;
		this.base_url = config.base_url ?? 'https://api.deepseek.com/v1';
		this.timeout = config.timeout ?? null;
		this.client_params = config.client_params ?? null;
	}

	get provider(): string {
		return 'deepseek';
	}

	get name(): string {
		return this.model;
	}

	private _client(): AsyncOpenAIClient {
		// In a real implementation, you would use the actual OpenAI client:
		// import { OpenAI } from 'openai';
		// return new OpenAI({
		//   apiKey: this.api_key,
		//   baseURL: this.base_url,
		//   timeout: this.timeout,
		//   ...this.client_params
		// });
		throw new Error(
			'_client() must be implemented with actual OpenAI-compatible client library. ' +
				'Install: npm install openai'
		);
	}

	/**
	 * Invoke the chat model with string output
	 */
	async ainvoke(
		messages: BaseMessage[],
		output_format?: null,
		tools?: Array<Record<string, any>> | null,
		stop?: string[] | null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<string>>;

	/**
	 * Invoke the chat model with structured output
	 */
	async ainvoke<T extends BaseModel>(
		messages: BaseMessage[],
		output_format: BaseModelConstructor<T>,
		tools?: Array<Record<string, any>> | null,
		stop?: string[] | null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<T>>;

	/**
	 * Main implementation
	 * DeepSeek ainvoke supports:
	 * 1. Regular text/multi-turn conversation
	 * 2. Function Calling
	 * 3. JSON Output (response_format)
	 * 4. Conversation prefix continuation (beta, prefix, stop)
	 */
	async ainvoke<T extends BaseModel = BaseModel>(
		messages: BaseMessage[],
		output_format?: BaseModelConstructor<T> | null,
		tools?: Array<Record<string, any>> | null,
		stop?: string[] | null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>> {
		const client = this._client();
		const dsMessages = DeepSeekMessageSerializer.serializeMessages(messages);
		const common: Record<string, any> = {};

		if (this.temperature !== null && this.temperature !== undefined) {
			common.temperature = this.temperature;
		}
		if (this.max_tokens !== null && this.max_tokens !== undefined) {
			common.max_tokens = this.max_tokens;
		}
		if (this.top_p !== null && this.top_p !== undefined) {
			common.top_p = this.top_p;
		}
		if (this.seed !== null && this.seed !== undefined) {
			common.seed = this.seed;
		}

		// Beta conversation prefix continuation (see official documentation)
		if (this.base_url && String(this.base_url).endsWith('/beta')) {
			// The last assistant message must have prefix
			if (
				dsMessages.length > 0 &&
				typeof dsMessages[dsMessages.length - 1] === 'object' &&
				dsMessages[dsMessages.length - 1].role === 'assistant'
			) {
				dsMessages[dsMessages.length - 1].prefix = true;
			}
			if (stop) {
				common.stop = stop;
			}
		}

		// ① Regular multi-turn conversation/text output
		if (output_format === null || output_format === undefined) {
			if (!tools) {
				try {
					const resp = await client.chat.completions.create({
						model: this.model,
						messages: dsMessages,
						...common,
					});
					return {
						completion: resp.choices[0].message.content || '',
						usage: null,
					};
				} catch (error: any) {
					if (error.name === 'RateLimitError') {
						throw new ModelRateLimitError(String(error), this.name);
					}
					throw new ModelProviderError(String(error), undefined, this.name);
				}
			}
		}

		// ② Function Calling path (with tools or output_format)
		if (tools || (output_format !== null && output_format !== undefined)) {
			try {
				let callTools = tools;
				let toolChoice: any = null;

				if (output_format !== null && output_format !== undefined) {
					const formatInstance = new output_format();
					const toolName = output_format.name;
					const schema = SchemaOptimizer.createOptimizedJsonSchema(output_format);
					delete schema.title;

					callTools = [
						{
							type: 'function',
							function: {
								name: toolName,
								description: `Return a JSON object of type ${toolName}`,
								parameters: schema,
							},
						},
					];
					toolChoice = { type: 'function', function: { name: toolName } };
				}

				const resp = await client.chat.completions.create({
					model: this.model,
					messages: dsMessages,
					tools: callTools,
					tool_choice: toolChoice,
					...common,
				});

				const msg = resp.choices[0].message;
				if (!msg.tool_calls || msg.tool_calls.length === 0) {
					throw new Error('Expected tool_calls in response but got none');
				}

				const rawArgs = msg.tool_calls[0].function.arguments;
				let parsed: any;
				if (typeof rawArgs === 'string') {
					parsed = JSON.parse(rawArgs);
				} else {
					parsed = rawArgs;
				}

				// Fix: only use model_validate when output_format is not None
				if (output_format !== null && output_format !== undefined) {
					const formatInstance = new output_format();
					return {
						completion: formatInstance.model_validate_json(JSON.stringify(parsed)),
						usage: null,
					};
				} else {
					// If no output_format, return dict directly
					return {
						completion: parsed,
						usage: null,
					};
				}
			} catch (error: any) {
				if (error.name === 'RateLimitError') {
					throw new ModelRateLimitError(String(error), this.name);
				}
				throw new ModelProviderError(String(error), undefined, this.name);
			}
		}

		// ③ JSON Output path (official response_format)
		if (output_format !== null && output_format !== undefined) {
			try {
				const resp = await client.chat.completions.create({
					model: this.model,
					messages: dsMessages,
					response_format: { type: 'json_object' },
					...common,
				});

				const content = resp.choices[0].message.content;
				if (!content) {
					throw new ModelProviderError('Empty JSON content in DeepSeek response', 500, this.name);
				}

				const formatInstance = new output_format();
				const parsed = formatInstance.model_validate_json(content);

				return {
					completion: parsed as T,
					usage: null,
				};
			} catch (error: any) {
				if (error.name === 'RateLimitError') {
					throw new ModelRateLimitError(String(error), this.name);
				}
				throw new ModelProviderError(String(error), undefined, this.name);
			}
		}

		throw new ModelProviderError('No valid ainvoke execution path for DeepSeek LLM', 500, this.name);
	}
}
