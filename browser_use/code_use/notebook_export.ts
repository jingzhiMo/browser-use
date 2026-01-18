/**
 * TypeScript implementation of notebook export
 * Converted from browser_use/code_use/notebook_export.py
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CodeAgent } from './service';
import { CellType, NotebookExport } from './views';

/**
 * Export a NotebookSession to a Jupyter notebook (.ipynb) file.
 * Now includes JavaScript code blocks that were stored in the namespace.
 *
 * @param agent - CodeAgent instance to access namespace for JavaScript blocks
 * @param output_path - Path where to save the notebook file
 * @returns Path to the saved notebook file
 */
export function export_to_ipynb(agent: CodeAgent, output_path: string | path.PlatformPath): path.PlatformPath {
	const outputPathObj = typeof output_path === 'string' ? path.resolve(output_path) : output_path;

	// Create notebook structure
	const notebook = new NotebookExport({
		metadata: {
			kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
			language_info: {
				name: 'python',
				version: '3.11.0',
				mimetype: 'text/x-python',
				codemirror_mode: { name: 'ipython', version: 3 },
				pygments_lexer: 'ipython3',
				nbconvert_exporter: 'python',
				file_extension: '.py',
			},
		},
	});

	// Add setup cell at the beginning with proper type hints
	const setup_code = `import asyncio
import json
from typing import Any
from browser_use import BrowserSession
from browser_use.code_use import create_namespace

# Initialize browser and namespace
browser = BrowserSession()
await browser.start()

# Create namespace with all browser control functions
namespace: dict[str, Any] = create_namespace(browser)

# Import all functions into the current namespace
globals().update(namespace)

# Type hints for better IDE support (these are now available globally)
# navigate, click, input, evaluate, search, extract, scroll, done, etc.

print("Browser-use environment initialized!")
print("Available functions: navigate, click, input, evaluate, search, extract, done, etc.")`;

	const setup_cell = {
		cell_type: 'code',
		metadata: {},
		source: setup_code.split('\n'),
		execution_count: null,
		outputs: [],
	};
	notebook.cells.push(setup_cell);

	// Add JavaScript code blocks as variables FIRST
	if (agent.namespace && agent.namespace['_code_block_vars']) {
		// Look for JavaScript variables in the namespace
		const code_block_vars = agent.namespace['_code_block_vars'] as Set<string>;

		for (const var_name of Array.from(code_block_vars).sort()) {
			const var_value = agent.namespace[var_name];
			if (typeof var_value === 'string' && var_value.trim()) {
				// Check if this looks like JavaScript code
				// Look for common JS patterns
				const js_patterns = [
					/function\s+\w+\s*\(/,
					/\(\s*function\s*\(\)/,
					/=>\s*{/,
					/document\./,
					/Array\.from\(/,
					/\.querySelector/,
					/\.textContent/,
					/\.innerHTML/,
					/return\s+/,
					/console\.log/,
					/window\./,
					/\.map\(/,
					/\.filter\(/,
					/\.forEach\(/,
				];

				const is_js = js_patterns.some((pattern) => pattern.test(var_value));

				if (is_js) {
					// Create a code cell with the JavaScript variable
					const js_cell = {
						cell_type: 'code',
						metadata: {},
						source: [`# JavaScript Code Block: ${var_name}\n`, `${var_name} = """${var_value}"""`],
						execution_count: null,
						outputs: [],
					};
					notebook.cells.push(js_cell);
				}
			}
		}
	}

	// Convert cells
	let python_cell_count = 0;
	for (const cell of agent.session.cells) {
		const notebook_cell: Record<string, any> = {
			cell_type: cell.cell_type,
			metadata: {},
			source: cell.source.split(/\r?\n/),
		};

		if (cell.cell_type === CellType.CODE) {
			python_cell_count++;
			notebook_cell['execution_count'] = cell.execution_count;
			notebook_cell['outputs'] = [];

			// Add output if available
			if (cell.output) {
				notebook_cell['outputs'].push({
					output_type: 'stream',
					name: 'stdout',
					text: cell.output.split('\n'),
				});
			}

			// Add error if available
			if (cell.error) {
				notebook_cell['outputs'].push({
					output_type: 'error',
					ename: 'Error',
					evalue: cell.error.split('\n')[0] || '',
					traceback: cell.error.split('\n'),
				});
			}

			// Add browser state as a separate output
			if (cell.browser_state) {
				notebook_cell['outputs'].push({
					output_type: 'stream',
					name: 'stdout',
					text: [`Browser State:\n${cell.browser_state}`],
				});
			}
		}

		notebook.cells.push(notebook_cell);
	}

	// Write to file
	const dir = path.dirname(outputPathObj);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(outputPathObj, JSON.stringify(notebook.model_dump(), null, 2), 'utf-8');

	return outputPathObj;
}

/**
 * Convert a CodeAgent session to a Python script.
 * Now includes JavaScript code blocks that were stored in the namespace.
 *
 * @param agent - The CodeAgent instance to convert
 * @returns Python script as a string
 */
export function session_to_python_script(agent: CodeAgent): string {
	const lines: string[] = [];

	lines.push('# Generated from browser-use code-use session\n');
	lines.push('import asyncio\n');
	lines.push('import json\n');
	lines.push('from browser_use import BrowserSession\n');
	lines.push('from browser_use.code_use import create_namespace\n\n');

	lines.push('async def main():\n');
	lines.push('\t# Initialize browser and namespace\n');
	lines.push('\tbrowser = BrowserSession()\n');
	lines.push('\tawait browser.start()\n\n');
	lines.push('\t# Create namespace with all browser control functions\n');
	lines.push('\tnamespace = create_namespace(browser)\n\n');
	lines.push('\t# Extract functions from namespace for direct access\n');
	lines.push('\tnavigate = namespace["navigate"]\n');
	lines.push('\tclick = namespace["click"]\n');
	lines.push('\tinput_text = namespace["input"]\n');
	lines.push('\tevaluate = namespace["evaluate"]\n');
	lines.push('\tsearch = namespace["search"]\n');
	lines.push('\textract = namespace["extract"]\n');
	lines.push('\tscroll = namespace["scroll"]\n');
	lines.push('\tdone = namespace["done"]\n');
	lines.push('\tgo_back = namespace["go_back"]\n');
	lines.push('\twait = namespace["wait"]\n');
	lines.push('\tscreenshot = namespace["screenshot"]\n');
	lines.push('\tfind_text = namespace["find_text"]\n');
	lines.push('\tswitch_tab = namespace["switch"]\n');
	lines.push('\tclose_tab = namespace["close"]\n');
	lines.push('\tdropdown_options = namespace["dropdown_options"]\n');
	lines.push('\tselect_dropdown = namespace["select_dropdown"]\n');
	lines.push('\tupload_file = namespace["upload_file"]\n');
	lines.push('\tsend_keys = namespace["send_keys"]\n\n');

	// Add JavaScript code blocks as variables FIRST
	if (agent.namespace && agent.namespace['_code_block_vars']) {
		const code_block_vars = agent.namespace['_code_block_vars'] as Set<string>;

		for (const var_name of Array.from(code_block_vars).sort()) {
			const var_value = agent.namespace[var_name];
			if (typeof var_value === 'string' && var_value.trim()) {
				// Check if this looks like JavaScript code
				const js_patterns = [
					/function\s+\w+\s*\(/,
					/\(\s*function\s*\(\)/,
					/=>\s*{/,
					/document\./,
					/Array\.from\(/,
					/\.querySelector/,
					/\.textContent/,
					/\.innerHTML/,
					/return\s+/,
					/console\.log/,
					/window\./,
					/\.map\(/,
					/\.filter\(/,
					/\.forEach\(/,
				];

				const is_js = js_patterns.some((pattern) => pattern.test(var_value));

				if (is_js) {
					lines.push(`\t# JavaScript Code Block: ${var_name}\n`);
					lines.push(`\t${var_name} = """${var_value}"""\n\n`);
				}
			}
		}
	}

	for (let i = 0; i < agent.session.cells.length; i++) {
		const cell = agent.session.cells[i];
		if (cell.cell_type === CellType.CODE) {
			lines.push(`\t# Cell ${i + 1}\n`);

			// Indent each line of source
			const source_lines = cell.source.split('\n');
			for (const line of source_lines) {
				if (line.trim()) {
					// Only add non-empty lines
					lines.push(`\t${line}\n`);
				}
			}

			lines.push('\n');
		}
	}

	lines.push('\tawait browser.stop()\n\n');
	lines.push("if __name__ == '__main__':\n");
	lines.push('\tasyncio.run(main())\n');

	return lines.join('');
}
