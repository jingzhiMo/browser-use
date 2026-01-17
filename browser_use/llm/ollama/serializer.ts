/**
 * TypeScript implementation of OllamaMessageSerializer
 * Converts between browser-use message types and Ollama message types
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Ollama Image type - can be bytes (Uint8Array) or URL string
 */
type OllamaImage = {
	value: Uint8Array | string;
};

/**
 * Ollama Message ToolCall Function
 */
type OllamaToolCallFunction = {
	name: string;
	arguments: Record<string, any>;
};

/**
 * Ollama Message ToolCall
 */
type OllamaToolCall = {
	function: OllamaToolCallFunction;
};

/**
 * Ollama Message type
 */
type OllamaMessage = {
	role: 'user' | 'system' | 'assistant';
	content: string | null;
	images?: OllamaImage[];
	tool_calls?: OllamaToolCall[];
};

/**
 * Content Part Types
 */
type ContentPartText = {
	type: 'text';
	text: string;
};

type ContentPartRefusal = {
	type: 'refusal';
	refusal: string;
};

type ContentPartImage = {
	type: 'image_url';
	image_url: {
		url: string;
		detail?: 'auto' | 'low' | 'high';
		media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
	};
};

type ContentPart = ContentPartText | ContentPartRefusal | ContentPartImage;

/**
 * Browser-Use Message Types
 */
type Function = {
	name: string;
	arguments: string; // JSON string
};

type ToolCall = {
	id: string;
	function: Function;
	type: 'function';
};

type BaseMessage = UserMessage | SystemMessage | AssistantMessage;

type UserMessage = {
	role: 'user';
	content: string | ContentPart[];
	name?: string | null;
	cache?: boolean;
};

type SystemMessage = {
	role: 'system';
	content: string | ContentPartText[];
	name?: string | null;
	cache?: boolean;
};

type AssistantMessage = {
	role: 'assistant';
	content: string | (ContentPartText | ContentPartRefusal)[] | null;
	name?: string | null;
	refusal?: string | null;
	tool_calls?: ToolCall[];
	cache?: boolean;
};

// ============================================================================
// OllamaMessageSerializer Class
// ============================================================================

export class OllamaMessageSerializer {
	/**
	 * Extract text content from message content, ignoring images.
	 */
	private static _extractTextContent(
		content: string | ContentPart[] | null | undefined
	): string {
		if (content === null || content === undefined) {
			return '';
		}

		if (typeof content === 'string') {
			return content;
		}

		const textParts: string[] = [];
		for (const part of content) {
			if ('type' in part) {
				if (part.type === 'text') {
					textParts.push(part.text);
				} else if (part.type === 'refusal') {
					textParts.push(`[Refusal] ${part.refusal}`);
				}
				// Skip image parts as they're handled separately
			}
		}

		return textParts.join('\n');
	}

	/**
	 * Extract images from message content.
	 */
	private static _extractImages(
		content: string | ContentPart[] | null | undefined
	): OllamaImage[] {
		if (content === null || content === undefined || typeof content === 'string') {
			return [];
		}

		const images: OllamaImage[] = [];
		for (const part of content) {
			if ('type' in part && part.type === 'image_url') {
				const url = part.image_url.url;
				if (url.startsWith('data:')) {
					// Handle base64 encoded images
					// Format: data:image/jpeg;base64,<data>
					const [, data] = url.split(',', 2);
					// Decode base64 to bytes
					const binaryString = atob(data);
					const bytes = new Uint8Array(binaryString.length);
					for (let i = 0; i < binaryString.length; i++) {
						bytes[i] = binaryString.charCodeAt(i);
					}
					images.push({ value: bytes });
				} else {
					// Handle URL images (Ollama will download them)
					images.push({ value: url });
				}
			}
		}

		return images;
	}

	/**
	 * Convert browser-use ToolCalls to Ollama ToolCalls.
	 */
	private static _serializeToolCalls(
		toolCalls: ToolCall[]
	): OllamaToolCall[] {
		const ollamaToolCalls: OllamaToolCall[] = [];

		for (const toolCall of toolCalls) {
			// Parse arguments from JSON string to dict for Ollama
			let argumentsDict: Record<string, any>;
			try {
				argumentsDict = JSON.parse(toolCall.function.arguments);
			} catch (error) {
				// If parsing fails, wrap in a dict
				argumentsDict = { arguments: toolCall.function.arguments };
			}

			const ollamaToolCall: OllamaToolCall = {
				function: {
					name: toolCall.function.name,
					arguments: argumentsDict,
				},
			};
			ollamaToolCalls.push(ollamaToolCall);
		}

		return ollamaToolCalls;
	}

	/**
	 * Serialize a custom message to an Ollama Message.
	 */
	static serialize(message: BaseMessage): OllamaMessage {
		if (message.role === 'user') {
			const textContent = this._extractTextContent(message.content);
			const images = this._extractImages(message.content);

			const ollamaMessage: OllamaMessage = {
				role: 'user',
				content: textContent || null,
			};

			if (images.length > 0) {
				ollamaMessage.images = images;
			}

			return ollamaMessage;
		} else if (message.role === 'system') {
			const textContent = this._extractTextContent(message.content);

			return {
				role: 'system',
				content: textContent || null,
			};
		} else if (message.role === 'assistant') {
			// Handle content
			let textContent: string | null = null;
			if (message.content !== null && message.content !== undefined) {
				textContent = this._extractTextContent(message.content);
			}

			const ollamaMessage: OllamaMessage = {
				role: 'assistant',
				content: textContent || null,
			};

			// Handle tool calls
			if (message.tool_calls && message.tool_calls.length > 0) {
				ollamaMessage.tool_calls = this._serializeToolCalls(message.tool_calls);
			}

			return ollamaMessage;
		} else {
			throw new Error(`Unknown message type: ${(message as any).role}`);
		}
	}

	/**
	 * Serialize a list of browser_use messages to Ollama Messages.
	 */
	static serializeMessages(messages: BaseMessage[]): OllamaMessage[] {
		return messages.map((m) => this.serialize(m));
	}
}
