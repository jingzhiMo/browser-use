/**
 * TypeScript implementation of GIF generation
 * Converted from browser_use/agent/gif.py
 * 
 * Note: This implementation requires image processing libraries.
 * For production use, consider using 'sharp' or 'canvas' for image manipulation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentHistoryList } from './views';
import { PLACEHOLDER_4PX_SCREENSHOT } from '../browser/views';

// Helper function to decode unicode escapes
function decode_unicode_escapes_to_utf8(text: string): string {
	/**Handle decoding any unicode escape sequences embedded in a string (needed to render non-ASCII languages like chinese or arabic in the GIF overlay text)*/

	if (!text.includes('\\u')) {
		// doesn't have any escape sequences that need to be decoded
		return text;
	}

	try {
		// Try to decode Unicode escape sequences
		return JSON.parse('"' + text.replace(/\\u/g, '\\u') + '"');
	} catch (error) {
		// Failed to decode unicode escape sequences
		return text;
	}
}

// Helper function to check if URL is a new tab page
function is_new_tab_page(url: string): boolean {
	const new_tab_urls = [
		'about:blank',
		'chrome://newtab/',
		'edge://newtab/',
		'about:newtab',
	];
	return new_tab_urls.includes(url.toLowerCase());
}

export interface CreateHistoryGifOptions {
	output_path?: string;
	duration?: number;
	show_goals?: boolean;
	show_task?: boolean;
	show_logo?: boolean;
	font_size?: number;
	title_font_size?: number;
	goal_font_size?: number;
	margin?: number;
	line_spacing?: number;
}

export function create_history_gif(
	task: string,
	history: AgentHistoryList,
	options: CreateHistoryGifOptions = {}
): void {
	/**Create a GIF from the agent's history with overlaid task and goal text.*/
	const {
		output_path = 'agent_history.gif',
		duration = 3000,
		show_goals = true,
		show_task = true,
		show_logo = false,
		font_size = 40,
		title_font_size = 56,
		goal_font_size = 44,
		margin = 40,
		line_spacing = 1.5,
	} = options;

	if (!history.history || history.history.length === 0) {
		console.warn('No history to create GIF from');
		return;
	}

	// Get all screenshots from history (including None placeholders)
	const screenshots = history.screenshots(true); // return_none_if_not_screenshot=True

	if (!screenshots || screenshots.length === 0) {
		console.warn('No screenshots found in history');
		return;
	}

	// Find the first non-placeholder screenshot
	// A screenshot is considered a placeholder if:
	// 1. It's the exact 4px placeholder for about:blank pages, OR
	// 2. It comes from a new tab page (chrome://newtab/, about:blank, etc.)
	let first_real_screenshot: string | null = null;
	for (const screenshot of screenshots) {
		if (screenshot && screenshot !== PLACEHOLDER_4PX_SCREENSHOT) {
			first_real_screenshot = screenshot;
			break;
		}
	}

	if (!first_real_screenshot) {
		console.warn(
			'No valid screenshots found (all are placeholders or from new tab pages)'
		);
		return;
	}

	// Note: Image processing in TypeScript requires external libraries
	// For now, we'll provide a stub implementation
	// TODO: Implement using 'sharp' or 'canvas' library for:
	// - Loading fonts
	// - Creating images from base64 screenshots
	// - Drawing text overlays
	// - Composing images
	// - Saving GIF files

	console.warn(
		'GIF generation is not yet fully implemented in TypeScript. ' +
			'This requires image processing libraries like "sharp" or "canvas". ' +
			'Please use the Python version for GIF generation.'
	);

	// Placeholder implementation
	// In a full implementation, you would:
	// 1. Load fonts (similar to PIL ImageFont.truetype)
	// 2. Process each screenshot:
	//    - Decode base64 to image buffer
	//    - Create image from buffer
	//    - Add text overlays if show_goals is true
	//    - Add to images array
	// 3. Create task frame if show_task is true
	// 4. Save all images as animated GIF

	// Example structure for full implementation:
	/*
	const images: any[] = [];
	
	// Load fonts (would need font loading library)
	// const regular_font = loadFont(font_size);
	// const title_font = loadFont(title_font_size);
	// const goal_font = loadFont(goal_font_size);
	
	// Create task frame if requested
	if (show_task && task) {
		const task_frame = _create_task_frame(
			task,
			first_real_screenshot,
			title_font,
			regular_font,
			logo,
			line_spacing
		);
		images.push(task_frame);
	}
	
	// Process each history item with its corresponding screenshot
	for (let i = 0; i < history.history.length; i++) {
		const item = history.history[i];
		const screenshot = screenshots[i];
		
		if (!screenshot || screenshot === PLACEHOLDER_4PX_SCREENSHOT) {
			continue;
		}
		
		if (is_new_tab_page(item.state.url)) {
			continue;
		}
		
		// Convert base64 screenshot to image
		// const image = decodeBase64ToImage(screenshot);
		
		if (show_goals && item.model_output) {
			// image = _add_overlay_to_image(
			// 	image,
			// 	i + 1,
			// 	item.model_output.current_state.next_goal,
			// 	regular_font,
			// 	title_font,
			// 	margin,
			// 	logo
			// );
		}
		
		// images.push(image);
	}
	
	// Save the GIF
	// saveGif(output_path, images, duration);
	*/
}

function _create_task_frame(
	task: string,
	first_screenshot: string,
	title_font: any, // Would be font object from image library
	regular_font: any, // Would be font object from image library
	logo: any | null = null, // Would be image object
	line_spacing: number = 1.5
): any {
	/**Create initial frame showing the task.*/
	// TODO: Implement using image processing library
	// This would:
	// 1. Decode first_screenshot from base64
	// 2. Create new image with black background
	// 3. Draw task text centered
	// 4. Add logo if provided
	// 5. Return image object
	return null;
}

function _add_overlay_to_image(
	image: any, // Would be image object
	step_number: number,
	goal_text: string,
	regular_font: any, // Would be font object
	title_font: any, // Would be font object
	margin: number,
	logo: any | null = null,
	display_step: boolean = true,
	text_color: [number, number, number, number] = [255, 255, 255, 255],
	text_box_color: [number, number, number, number] = [0, 0, 0, 255]
): any {
	/**Add step number and goal overlay to an image.*/
	// TODO: Implement using image processing library
	// This would:
	// 1. Decode unicode escapes in goal_text
	// 2. Convert image to RGBA
	// 3. Create text layer
	// 4. Draw step number (bottom left) with rounded rectangle background
	// 5. Draw goal text (centered, bottom) with rounded rectangle background
	// 6. Add logo if provided (top right)
	// 7. Composite layers
	// 8. Return result image
	return image;
}

function _wrap_text(
	text: string,
	font: any, // Would be font object
	max_width: number
): string {
	/**
	 * Wrap text to fit within a given width.
	 *
	 * Args:
	 *     text: Text to wrap
	 *     font: Font to use for text
	 *     max_width: Maximum width in pixels
	 *
	 * Returns:
	 *     Wrapped text with newlines
	 */
	text = decode_unicode_escapes_to_utf8(text);
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current_line: string[] = [];

	for (const word of words) {
		current_line.push(word);
		const line = current_line.join(' ');
		// TODO: Measure text width using font metrics
		// For now, use a simple character-based approximation
		// In real implementation: const bbox = font.getBoundingBox(line);
		const estimated_width = line.length * (font?.size || 10) * 0.6; // Rough estimate
		if (estimated_width > max_width) {
			if (current_line.length === 1) {
				lines.push(current_line.pop()!);
			} else {
				current_line.pop();
				lines.push(current_line.join(' '));
				current_line = [word];
			}
		}
	}

	if (current_line.length > 0) {
		lines.push(current_line.join(' '));
	}

	return lines.join('\n');
}
