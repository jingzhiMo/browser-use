/**
 * TypeScript implementation of variable detector
 * Converted from browser_use/agent/variable_detector.py
 */

import type { AgentHistoryList, DetectedVariable } from './views';
import type { DOMInteractedElement } from '../dom/views';

/**
 * Analyze agent history and detect reusable variables.
 *
 * Uses two strategies:
 * 1. Element attributes (id, name, type, placeholder, aria-label) - most reliable
 * 2. Value pattern matching (email, phone, date formats) - fallback
 *
 * Returns:
 * 	Dictionary mapping variable names to DetectedVariable objects
 */
export function detect_variables_in_history(history: AgentHistoryList): Record<string, DetectedVariable> {
	const detected: Record<string, DetectedVariable> = {};
	const detected_values: Set<string> = new Set(); // Track which values we've already detected

	for (let step_idx = 0; step_idx < history.history.length; step_idx++) {
		const history_item = history.history[step_idx];
		if (!history_item.model_output) {
			continue;
		}

		for (let action_idx = 0; action_idx < history_item.model_output.action.length; action_idx++) {
			const action = history_item.model_output.action[action_idx];
			// Convert action to dict - handle both Pydantic models and dict-like objects
			let action_dict: Record<string, any>;
			if (typeof action === 'object' && action !== null && 'model_dump' in action) {
				action_dict = (action as any).model_dump();
			} else if (typeof action === 'object' && action !== null) {
				action_dict = action as Record<string, any>;
			} else {
				// For SimpleNamespace or similar objects
				action_dict = Object.assign({}, action);
			}

			// Get the interacted element for this action (if available)
			let element: DOMInteractedElement | null = null;
			if (history_item.state && history_item.state.interacted_element) {
				if (history_item.state.interacted_element.length > action_idx) {
					element = history_item.state.interacted_element[action_idx];
				}
			}

			// Detect variables in this action
			_detect_in_action(action_dict, element, detected, detected_values);
		}
	}

	return detected;
}

/**
 * Detect variables in a single action using element context
 */
function _detect_in_action(
	action_dict: Record<string, any>,
	element: DOMInteractedElement | null,
	detected: Record<string, DetectedVariable>,
	detected_values: Set<string>
): void {
	// Extract action type and parameters
	for (const [action_type, params] of Object.entries(action_dict)) {
		if (typeof params !== 'object' || params === null) {
			continue;
		}

		// Check fields that commonly contain variables
		const fields_to_check = ['text', 'query'];

		for (const field of fields_to_check) {
			if (!(field in params)) {
				continue;
			}

			const value = params[field];
			if (typeof value !== 'string' || !value.trim()) {
				continue;
			}

			// Skip if we already detected this exact value
			if (detected_values.has(value)) {
				continue;
			}

			// Try to detect variable type (with element context)
			const var_info = _detect_variable_type(value, element);
			if (!var_info) {
				continue;
			}

			const [var_name, var_format] = var_info;

			// Ensure unique variable name
			const unique_name = _ensure_unique_name(var_name, detected);

			// Add detected variable
			detected[unique_name] = {
				name: unique_name,
				original_value: value,
				type: 'string',
				format: var_format,
			} as DetectedVariable;

			detected_values.add(value);
		}
	}
}

/**
 * Detect if a value looks like a variable, using element context when available.
 *
 * Priority:
 * 1. Element attributes (id, name, type, placeholder, aria-label) - most reliable
 * 2. Value pattern matching (email, phone, date formats) - fallback
 *
 * Returns:
 * 	[variable_name, format] or null if not detected
 */
function _detect_variable_type(
	value: string,
	element: DOMInteractedElement | null = null
): [string, string | null] | null {
	// STRATEGY 1: Use element attributes (most reliable)
	if (element && element.attributes) {
		const attr_detection = _detect_from_attributes(element.attributes);
		if (attr_detection) {
			return attr_detection;
		}
	}

	// STRATEGY 2: Pattern matching on value (fallback)
	return _detect_from_value_pattern(value);
}

/**
 * Detect variable from element attributes.
 *
 * Check attributes in priority order:
 * 1. type attribute (HTML5 input types - most specific)
 * 2. id, name, placeholder, aria-label (semantic hints)
 */
function _detect_from_attributes(attributes: Record<string, string>): [string, string | null] | null {
	// Check 'type' attribute first (HTML5 input types)
	const input_type = (attributes.type || '').toLowerCase();
	if (input_type === 'email') {
		return ['email', 'email'];
	} else if (input_type === 'tel') {
		return ['phone', 'phone'];
	} else if (input_type === 'date') {
		return ['date', 'date'];
	} else if (input_type === 'number') {
		return ['number', 'number'];
	} else if (input_type === 'url') {
		return ['url', 'url'];
	}

	// Combine semantic attributes for keyword matching
	const semantic_attrs = [
		attributes.id || '',
		attributes.name || '',
		attributes.placeholder || '',
		attributes['aria-label'] || '',
	];

	const combined_text = semantic_attrs.join(' ').toLowerCase();

	// Address detection
	if (['address', 'street', 'addr'].some((keyword) => combined_text.includes(keyword))) {
		if (combined_text.includes('billing')) {
			return ['billing_address', null];
		} else if (combined_text.includes('shipping')) {
			return ['shipping_address', null];
		} else {
			return ['address', null];
		}
	}

	// Comment/Note detection
	if (['comment', 'note', 'message', 'description'].some((keyword) => combined_text.includes(keyword))) {
		return ['comment', null];
	}

	// Email detection
	if (combined_text.includes('email') || combined_text.includes('e-mail')) {
		return ['email', 'email'];
	}

	// Phone detection
	if (['phone', 'tel', 'mobile', 'cell'].some((keyword) => combined_text.includes(keyword))) {
		return ['phone', 'phone'];
	}

	// Name detection (order matters - check specific before general)
	if (combined_text.includes('first') && combined_text.includes('name')) {
		return ['first_name', null];
	} else if (combined_text.includes('last') && combined_text.includes('name')) {
		return ['last_name', null];
	} else if (combined_text.includes('full') && combined_text.includes('name')) {
		return ['full_name', null];
	} else if (combined_text.includes('name')) {
		return ['name', null];
	}

	// Date detection
	if (['date', 'dob', 'birth'].some((keyword) => combined_text.includes(keyword))) {
		return ['date', 'date'];
	}

	// City detection
	if (combined_text.includes('city')) {
		return ['city', null];
	}

	// State/Province detection
	if (combined_text.includes('state') || combined_text.includes('province')) {
		return ['state', null];
	}

	// Country detection
	if (combined_text.includes('country')) {
		return ['country', null];
	}

	// Zip code detection
	if (['zip', 'postal', 'postcode'].some((keyword) => combined_text.includes(keyword))) {
		return ['zip_code', 'postal_code'];
	}

	// Company detection
	if (combined_text.includes('company') || combined_text.includes('organization')) {
		return ['company', null];
	}

	return null;
}

/**
 * Detect variable type from value pattern (fallback when no element context).
 *
 * Patterns:
 * - Email: contains @ and . with valid format
 * - Phone: digits with separators, 10+ chars
 * - Date: YYYY-MM-DD format
 * - Name: Capitalized word(s), 2-30 chars, letters only
 * - Number: Pure digits, 1-9 chars
 */
function _detect_from_value_pattern(value: string): [string, string | null] | null {
	// Email detection - most specific first
	if (value.includes('@') && value.includes('.')) {
		// Basic email validation
		const emailRegex = /^[\w\.-]+@[\w\.-]+\.\w+$/;
		if (emailRegex.test(value)) {
			return ['email', 'email'];
		}
	}

	// Phone detection (digits with separators, 10+ chars)
	const phoneRegex = /^[\d\s\-\(\)\+]+$/;
	if (phoneRegex.test(value)) {
		// Remove separators and check length
		const digits_only = value.replace(/[\s\-\(\)\+]/g, '');
		if (digits_only.length >= 10) {
			return ['phone', 'phone'];
		}
	}

	// Date detection (YYYY-MM-DD or similar)
	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (dateRegex.test(value)) {
		return ['date', 'date'];
	}

	// Name detection (capitalized, only letters/spaces, 2-30 chars)
	if (
		value &&
		value[0] &&
		value[0] === value[0].toUpperCase() &&
		value.replace(/[\s\-]/g, '').match(/^[a-zA-Z]+$/) &&
		2 <= value.length &&
		value.length <= 30
	) {
		const words = value.split(' ');
		if (words.length === 1) {
			return ['first_name', null];
		} else if (words.length === 2) {
			return ['full_name', null];
		} else {
			return ['name', null];
		}
	}

	// Number detection (pure digits, not phone length)
	if (/^\d+$/.test(value) && 1 <= value.length && value.length <= 9) {
		return ['number', 'number'];
	}

	return null;
}

/**
 * Ensure variable name is unique by adding suffix if needed.
 *
 * Examples:
 * 	first_name → first_name
 * 	first_name (exists) → first_name_2
 * 	first_name_2 (exists) → first_name_3
 */
function _ensure_unique_name(base_name: string, existing: Record<string, DetectedVariable>): string {
	if (!(base_name in existing)) {
		return base_name;
	}

	// Add numeric suffix
	let counter = 2;
	while (`${base_name}_${counter}` in existing) {
		counter++;
	}

	return `${base_name}_${counter}`;
}
