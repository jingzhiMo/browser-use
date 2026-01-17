/**
 * TypeScript implementation of message manager utils
 * Converted from browser_use/agent/message_manager/utils.py
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { BaseMessage } from '../../llm/messages';

/**
 * Save conversation history to file asynchronously.
 */
export async function save_conversation(
	input_messages: BaseMessage[],
	response: any,
	target: string,
	encoding: string | null = null
): Promise<void> {
	const target_path = path.resolve(target);
	const target_dir = path.dirname(target_path);
	
	// Create directories if they don't exist
	await fs.mkdir(target_dir, { recursive: true });
	
	const content = await _format_conversation(input_messages, response);
	await fs.writeFile(target_path, content, encoding || 'utf-8');
}

/**
 * Format the conversation including messages and response.
 */
async function _format_conversation(messages: BaseMessage[], response: any): Promise<string> {
	const lines: string[] = [];

	// Format messages
	for (const message of messages) {
		lines.push(` ${message.role} `);

		// Get text content from message
		// In TypeScript, BaseMessage should have a text property or content property
		let text = '';
		if ('text' in message && typeof message.text === 'string') {
			text = message.text;
		} else if (typeof (message as any).content === 'string') {
			text = (message as any).content;
		} else if (Array.isArray((message as any).content)) {
			text = (message as any).content
				.filter((part: any) => part.type === 'text')
				.map((part: any) => part.text)
				.join('\n');
		}

		lines.push(text);
		lines.push(''); // Empty line after each message
	}

	// Format response
	if (response && typeof response.model_dump_json === 'function') {
		const responseJson = JSON.parse(response.model_dump_json({ exclude_unset: true }));
		lines.push(JSON.stringify(responseJson, null, 2));
	} else if (response && typeof response === 'object') {
		// Try to use JSON.stringify with ensure_ascii equivalent (default behavior)
		lines.push(JSON.stringify(response, null, 2));
	} else {
		lines.push(JSON.stringify(response, null, 2));
	}

	return lines.join('\n');
}
