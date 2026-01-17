/**
 * Serializer for converting between custom message types and OpenAI message param types.
 */

import {
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	SystemMessage,
	ToolCall,
	UserMessage,
} from '../messages';

// Type definitions for OpenAI message types
type ChatCompletionContentPartTextParam = {
	text: string;
	type: 'text';
};

type ChatCompletionContentPartImageParam = {
	image_url: {
		url: string;
		detail?: 'auto' | 'low' | 'high';
	};
	type: 'image_url';
};

type ChatCompletionContentPartRefusalParam = {
	refusal: string;
	type: 'refusal';
};

type ChatCompletionMessageFunctionToolCallParam = {
	id: string;
	function: {
		name: string;
		arguments: string;
	};
	type: 'function';
};

type ChatCompletionUserMessageParam = {
	role: 'user';
	content: string | (ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam)[];
	name?: string;
};

type ChatCompletionSystemMessageParam = {
	role: 'system';
	content: string | ChatCompletionContentPartTextParam[];
	name?: string;
};

type ChatCompletionAssistantMessageParam = {
	role: 'assistant';
	content?: string | (ChatCompletionContentPartTextParam | ChatCompletionContentPartRefusalParam)[] | null;
	name?: string;
	refusal?: string;
	tool_calls?: ChatCompletionMessageFunctionToolCallParam[];
};

export type ChatCompletionMessageParam =
	| ChatCompletionUserMessageParam
	| ChatCompletionSystemMessageParam
	| ChatCompletionAssistantMessageParam;

export class OpenAIMessageSerializer {
	/**Serializer for converting between custom message types and OpenAI message param types.*/

	private static _serializeContentPartText(part: ContentPartTextParam): ChatCompletionContentPartTextParam {
		return { text: part.text, type: 'text' };
	}

	private static _serializeContentPartImage(part: ContentPartImageParam): ChatCompletionContentPartImageParam {
		return {
			image_url: {
				url: part.image_url.url,
				detail: part.image_url.detail,
			},
			type: 'image_url',
		};
	}

	private static _serializeContentPartRefusal(
		part: ContentPartRefusalParam
	): ChatCompletionContentPartRefusalParam {
		return { refusal: part.refusal, type: 'refusal' };
	}

	private static _serializeUserContent(
		content: string | (ContentPartTextParam | ContentPartImageParam)[]
	): string | (ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam)[] {
		/**Serialize content for user messages (text and images allowed).*/
		if (typeof content === 'string') {
			return content;
		}

		const serializedParts: (ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam)[] = [];
		for (const part of content) {
			if (part.type === 'text') {
				serializedParts.push(OpenAIMessageSerializer._serializeContentPartText(part));
			} else if (part.type === 'image_url') {
				serializedParts.push(OpenAIMessageSerializer._serializeContentPartImage(part));
			}
		}
		return serializedParts;
	}

	private static _serializeSystemContent(
		content: string | ContentPartTextParam[]
	): string | ChatCompletionContentPartTextParam[] {
		/**Serialize content for system messages (text only).*/
		if (typeof content === 'string') {
			return content;
		}

		const serializedParts: ChatCompletionContentPartTextParam[] = [];
		for (const part of content) {
			if (part.type === 'text') {
				serializedParts.push(OpenAIMessageSerializer._serializeContentPartText(part));
			}
		}
		return serializedParts;
	}

	private static _serializeAssistantContent(
		content: string | (ContentPartTextParam | ContentPartRefusalParam)[] | null
	): string | (ChatCompletionContentPartTextParam | ChatCompletionContentPartRefusalParam)[] | null {
		/**Serialize content for assistant messages (text and refusal allowed).*/
		if (content === null) {
			return null;
		}
		if (typeof content === 'string') {
			return content;
		}

		const serializedParts: (ChatCompletionContentPartTextParam | ChatCompletionContentPartRefusalParam)[] =
			[];
		for (const part of content) {
			if (part.type === 'text') {
				serializedParts.push(OpenAIMessageSerializer._serializeContentPartText(part));
			} else if (part.type === 'refusal') {
				serializedParts.push(OpenAIMessageSerializer._serializeContentPartRefusal(part));
			}
		}
		return serializedParts;
	}

	private static _serializeToolCall(toolCall: ToolCall): ChatCompletionMessageFunctionToolCallParam {
		return {
			id: toolCall.id,
			function: {
				name: toolCall.function.name,
				arguments: toolCall.function.arguments,
			},
			type: 'function',
		};
	}

	/**
	 * Serialize a custom message to an OpenAI message param.
	 */
	static serialize(message: BaseMessage): ChatCompletionMessageParam {
		if (message.role === 'user') {
			const userResult: ChatCompletionUserMessageParam = {
				role: 'user',
				content: OpenAIMessageSerializer._serializeUserContent(message.content),
			};
			if (message.name !== null && message.name !== undefined) {
				userResult.name = message.name;
			}
			return userResult;
		} else if (message.role === 'system') {
			const systemResult: ChatCompletionSystemMessageParam = {
				role: 'system',
				content: OpenAIMessageSerializer._serializeSystemContent(message.content),
			};
			if (message.name !== null && message.name !== undefined) {
				systemResult.name = message.name;
			}
			return systemResult;
		} else if (message.role === 'assistant') {
			// Handle content serialization
			let content: string | (ChatCompletionContentPartTextParam | ChatCompletionContentPartRefusalParam)[] | null = null;
			if (message.content !== null && message.content !== undefined) {
				content = OpenAIMessageSerializer._serializeAssistantContent(message.content);
			}

			const assistantResult: ChatCompletionAssistantMessageParam = { role: 'assistant' };

			// Only add content if it's not None
			if (content !== null) {
				assistantResult.content = content;
			}

			if (message.name !== null && message.name !== undefined) {
				assistantResult.name = message.name;
			}
			if (message.refusal !== null && message.refusal !== undefined) {
				assistantResult.refusal = message.refusal;
			}
			if (message.tool_calls && message.tool_calls.length > 0) {
				assistantResult.tool_calls = message.tool_calls.map((tc) =>
					OpenAIMessageSerializer._serializeToolCall(tc)
				);
			}

			return assistantResult;
		} else {
			throw new Error(`Unknown message type: ${(message as any).role}`);
		}
	}

	static serializeMessages(messages: BaseMessage[]): ChatCompletionMessageParam[] {
		return messages.map((m) => OpenAIMessageSerializer.serialize(m));
	}
}
