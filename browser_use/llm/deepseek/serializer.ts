/**
 * Serializer for converting browser-use messages to DeepSeek messages.
 */

import {
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	SystemMessage,
	ToolCall,
	UserMessage,
} from '../messages';

type MessageDict = Record<string, any>;

export class DeepSeekMessageSerializer {
	// -------- content 处理 --------------------------------------------------
	private static _serializeTextPart(part: ContentPartTextParam): string {
		return part.text;
	}

	private static _serializeImagePart(part: ContentPartImageParam): Record<string, any> {
		const url = part.image_url.url;
		// DeepSeek supports both data: URLs and regular URLs
		return { type: 'image_url', image_url: { url } };
	}

	private static _serializeContent(
		content: string | (ContentPartTextParam | ContentPartImageParam)[] | null | undefined
	): string | Array<Record<string, any>> {
		if (content === null || content === undefined) {
			return '';
		}
		if (typeof content === 'string') {
			return content;
		}

		const serialized: Array<Record<string, any>> = [];
		for (const part of content) {
			if (part.type === 'text') {
				serialized.push({
					type: 'text',
					text: DeepSeekMessageSerializer._serializeTextPart(part),
				});
			} else if (part.type === 'image_url') {
				serialized.push(DeepSeekMessageSerializer._serializeImagePart(part));
			} else if (part.type === 'refusal') {
				serialized.push({ type: 'text', text: `[Refusal] ${part.refusal}` });
			}
		}
		return serialized;
	}

	// -------- Tool-call 处理 -------------------------------------------------
	private static _serializeToolCalls(toolCalls: ToolCall[]): Array<Record<string, any>> {
		const deepseekToolCalls: Array<Record<string, any>> = [];
		for (const tc of toolCalls) {
			let arguments_: Record<string, any>;
			try {
				arguments_ = JSON.parse(tc.function.arguments);
			} catch (error) {
				arguments_ = { arguments: tc.function.arguments };
			}
			deepseekToolCalls.push({
				id: tc.id,
				type: 'function',
				function: {
					name: tc.function.name,
					arguments: arguments_,
				},
			});
		}
		return deepseekToolCalls;
	}

	// -------- 单条消息序列化 -------------------------------------------------
	static serialize(message: BaseMessage): MessageDict {
		if (message.role === 'user') {
			return {
				role: 'user',
				content: DeepSeekMessageSerializer._serializeContent(message.content),
			};
		}
		if (message.role === 'system') {
			return {
				role: 'system',
				content: DeepSeekMessageSerializer._serializeContent(message.content),
			};
		}
		if (message.role === 'assistant') {
			const msg: MessageDict = {
				role: 'assistant',
				content: DeepSeekMessageSerializer._serializeContent(message.content),
			};
			if (message.tool_calls && message.tool_calls.length > 0) {
				msg.tool_calls = DeepSeekMessageSerializer._serializeToolCalls(message.tool_calls);
			}
			return msg;
		}
		throw new Error(`Unknown message type: ${(message as any).role}`);
	}

	// -------- 列表序列化 -----------------------------------------------------
	static serializeMessages(messages: BaseMessage[]): MessageDict[] {
		return messages.map((m) => DeepSeekMessageSerializer.serialize(m));
	}
}
