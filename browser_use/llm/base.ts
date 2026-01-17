/**
 * We have switched all of our code from langchain to openai.types.chat.chat_completion_message_param.
 * For easier transition we have
 */

import { BaseMessage } from './messages';
import { ChatInvokeCompletion } from './views';

/**
 * BaseModel interface - represents a Pydantic BaseModel equivalent
 */
export interface BaseModel {
	model_json_schema(): Record<string, any>;
	model_validate_json(json: string): this;
}

/**
 * BaseModel constructor type
 */
export type BaseModelConstructor<T extends BaseModel> = new () => T;

/**
 * BaseChatModel protocol interface
 * In TypeScript, we use an interface instead of Protocol
 */
export interface BaseChatModel {
	_verified_api_keys?: boolean;
	model: string;
	readonly provider: string;
	readonly name: string;
	readonly model_name: string;

	/**
	 * Invoke the chat model with string output
	 */
	ainvoke(
		messages: BaseMessage[],
		output_format?: null,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<string>>;

	/**
	 * Invoke the chat model with structured output
	 */
	ainvoke<T extends BaseModel>(
		messages: BaseMessage[],
		output_format: BaseModelConstructor<T>,
		...kwargs: any[]
	): Promise<ChatInvokeCompletion<T>>;
}
