/**
 * Serializer for converting messages to OpenAI Responses API input format.
 */

import {
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	SystemMessage,
	UserMessage,
} from '../messages';

// Type definitions for OpenAI Responses API
type ResponseInputTextParam = {
	text: string;
	type: 'input_text';
};

type ResponseInputImageParam = {
	image_url: string;
	detail?: 'auto' | 'low' | 'high';
	type: 'input_image';
};

type ResponseInputMessageContentListParam = Array<ResponseInputTextParam | ResponseInputImageParam>;

type EasyInputMessageParam = {
	role: 'user' | 'system' | 'assistant';
	content: string | ResponseInputMessageContentListParam;
};

export class ResponsesAPIMessageSerializer {
	/**Serializer for converting between custom message types and OpenAI Responses API input format.*/

	private static _serializeContentPartText(part: ContentPartTextParam): ResponseInputTextParam {
		return { text: part.text, type: 'input_text' };
	}

	private static _serializeContentPartImage(part: ContentPartImageParam): ResponseInputImageParam {
		return {
			image_url: part.image_url.url,
			detail: part.image_url.detail,
			type: 'input_image',
		};
	}

	private static _serializeUserContent(
		content: string | (ContentPartTextParam | ContentPartImageParam)[]
	): string | ResponseInputMessageContentListParam {
		/**Serialize content for user messages (text and images allowed).*/
		if (typeof content === 'string') {
			return content;
		}

		const serializedParts: ResponseInputMessageContentListParam = [];
		for (const part of content) {
			if (part.type === 'text') {
				serializedParts.push(ResponsesAPIMessageSerializer._serializeContentPartText(part));
			} else if (part.type === 'image_url') {
				serializedParts.push(ResponsesAPIMessageSerializer._serializeContentPartImage(part));
			}
		}
		return serializedParts;
	}

	private static _serializeSystemContent(
		content: string | ContentPartTextParam[]
	): string | ResponseInputMessageContentListParam {
		/**Serialize content for system messages (text only).*/
		if (typeof content === 'string') {
			return content;
		}

		const serializedParts: ResponseInputMessageContentListParam = [];
		for (const part of content) {
			if (part.type === 'text') {
				serializedParts.push(ResponsesAPIMessageSerializer._serializeContentPartText(part));
			}
		}
		return serializedParts;
	}

	private static _serializeAssistantContent(
		content: string | (ContentPartTextParam | ContentPartRefusalParam)[] | null
	): string | ResponseInputMessageContentListParam | null {
		/**Serialize content for assistant messages (text only for Responses API).*/
		if (content === null) {
			return null;
		}
		if (typeof content === 'string') {
			return content;
		}

		const serializedParts: ResponseInputMessageContentListParam = [];
		for (const part of content) {
			if (part.type === 'text') {
				serializedParts.push(ResponsesAPIMessageSerializer._serializeContentPartText(part));
			}
			// Refusals are converted to text for the Responses API
			else if (part.type === 'refusal') {
				serializedParts.push({
					text: `[Refusal: ${part.refusal}]`,
					type: 'input_text',
				});
			}
		}
		return serializedParts;
	}

	/**
	 * Serialize a custom message to an OpenAI Responses API input message param.
	 */
	static serialize(message: BaseMessage): EasyInputMessageParam {
		if (message.role === 'user') {
			return {
				role: 'user',
				content: ResponsesAPIMessageSerializer._serializeUserContent(message.content),
			};
		} else if (message.role === 'system') {
			// Note: Responses API uses 'developer' role for system messages in some contexts,
			// but 'system' is also supported via EasyInputMessageParam
			return {
				role: 'system',
				content: ResponsesAPIMessageSerializer._serializeSystemContent(message.content),
			};
		} else if (message.role === 'assistant') {
			let content = ResponsesAPIMessageSerializer._serializeAssistantContent(message.content);
			// For assistant messages, we need to provide content
			// If content is None but there are tool calls, we represent them as text
			if (content === null) {
				if (message.tool_calls && message.tool_calls.length > 0) {
					// Convert tool calls to a text representation for context
					const toolCallText = message.tool_calls
						.map((tc) => `[Tool call: ${tc.function.name}(${tc.function.arguments})]`)
						.join('\n');
					content = toolCallText;
				} else {
					content = '';
				}
			}

			return {
				role: 'assistant',
				content: content,
			};
		} else {
			throw new Error(`Unknown message type: ${(message as any).role}`);
		}
	}

	/**
	 * Serialize a list of messages to Responses API input format.
	 */
	static serializeMessages(messages: BaseMessage[]): EasyInputMessageParam[] {
		return messages.map((m) => ResponsesAPIMessageSerializer.serialize(m));
	}
}
