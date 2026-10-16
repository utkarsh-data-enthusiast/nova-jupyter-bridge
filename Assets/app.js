/*
 * Nova Jupyter Bridge — Notebook Studio
 * Copyright (c) PatriotEver Lab
 * SPDX-License-Identifier: MIT
 *
 * Local interactive Jupyter notebook frontend.
 * No telemetry, advertising, or third-party services.
 */

'use strict';

/* =========================================================
   HELPERS
========================================================= */

const $ = id => document.getElementById(id);

const clone = value =>
    JSON.parse(JSON.stringify(value));

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

function textOf(cell) {
    const source = cell.source || '';

    return Array.isArray(source)
        ? source.join('')
        : String(source);
}

function el(tag, className = '', text) {
    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined) {
        node.textContent = String(text);
    }

    return node;
}

function button(label, callback, className = '') {
    const node = el('button', className, label);

    node.type = 'button';
    node.addEventListener('click', callback);

    return node;
}

function toast(message) {
    const node = $('toast');

    if (!node) return;

    node.textContent = String(message);
    node.classList.add('visible');

    clearTimeout(node._timer);

    node._timer = setTimeout(() => {
        node.classList.remove('visible');
    }, 4000);
}

function filename(path) {
    return String(path || '')
        .split('/')
        .pop() || 'Notebook.ipynb';
}

function newId() {
    if (globalThis.crypto?.randomUUID) {
        return crypto.randomUUID()
            .replace(/-/g, '')
            .slice(0, 12);
    }

    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);

    return Array.from(bytes, value =>
        value.toString(16).padStart(2, '0')
    ).join('').slice(0, 12);
}

async function request(path, data) {
    const options = data === undefined
        ? {
            credentials: 'same-origin'
        }
        : {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Notebook-Request': '1'
            },
            body: JSON.stringify(data)
        };

    const response = await fetch(path, options);

    let result;

    try {
        result = await response.json();
    } catch (_) {
        throw new Error(
            `Server returned HTTP ${response.status}`
        );
    }

    if (!response.ok) {
        throw new Error(
            result.error || `HTTP ${response.status}`
        );
    }

    return result;
}

/* =========================================================
   STATE
========================================================= */

let notebook = null;
let fileHash = null;

let dirty = false;
let saving = false;
let busy = false;
let startingExecution = false;
let runningAll = false;
let cancelRunAll = false;

let latestState = null;
let currentKernel = null;

let lastChanged = null;
let lastError = '';
let lastDebugOutcome = '';

let pollTimer = null;
let polling = false;

let debugRequested = false;
let debuggerDismissed = false;
let stepPending = false;
let debuggerStopping = false;

let currentDebugLocation = null;
let lastLocationKey = null;
let lastPauseSignature = null;

let variableRequestId = 0;
let variableLoading = false;

const editorMap = new Map();
const gutterMap = new Map();
const overlayMap = new Map();

let initialized = false;

/* =========================================================
   AUTHENTICATION
========================================================= */

// Authentication is established by the local server cookie.
// Remove the private query parameter from browser history.

try {
    if (window.location.search.includes('key=')) {
        window.history.replaceState(
            null,
            document.title,
            window.location.pathname
        );
    }
} catch (_) {}

/* =========================================================
   NOTEBOOK UTILITIES
========================================================= */

function cells() {
    return notebook?.cells || [];
}

function cellById(id) {
    return cells().find(cell => cell.id === id);
}

function cellElement(id) {
    return Array.from(
        document.querySelectorAll('.cell[data-cell-id]')
    ).find(card => card.dataset.cellId === String(id)) || null;
}

function syncEditors() {
    if (!notebook) return;

    for (const cell of cells()) {
        const editor = editorMap.get(cell.id);

        if (editor) {
            cell.source = editor.value;
        }
    }
}

function createCell(type = 'code') {
    const cell = {
        id: newId(),
        cell_type: type,
        metadata: {},
        source: ''
    };

    if (type === 'code') {
        cell.outputs = [];
        cell.execution_count = null;
    }

    return cell;
}

function setDirty() {
    dirty = true;
    updateSaveState();
}

function updateSaveState() {
    const node = $('saveState');

    if (!node) return;

    node.textContent = saving
        ? 'Saving…'
        : dirty
            ? '● Unsaved'
            : 'Saved';

    node.classList.toggle(
        'is-unsaved',
        dirty
    );

    node.classList.toggle(
        'is-saving',
        saving
    );
}

/* =========================================================
   BREAKPOINT MANAGEMENT
========================================================= */

function breakpointsOf(cell) {
    if (!cell || cell.cell_type !== 'code') {
        return [];
    }

    const values =
        cell.metadata?.novaStudioBreakpoints || [];

    return Array.from(new Set(values))
        .filter(value =>
            Number.isInteger(value) && value > 0
        )
        .sort((a, b) => a - b);
}

function toggleBreakpoint(cell, line) {
    if (busy || latestState?.debugPaused) {
        toast(
            'Finish or stop debugging before changing breakpoints.'
        );

        return;
    }

    const existing = breakpointsOf(cell);

    cell.metadata ||= {};

    cell.metadata.novaStudioBreakpoints =
        existing.includes(line)
            ? existing.filter(number => number !== line)
            : [...existing, line].sort((a, b) => a - b);

    const editor = editorMap.get(cell.id);

    if (editor) {
        buildLines(cell, editor);
    }

    setDirty();
}

/* =========================================================
   GUTTER AND EXECUTION-LINE ELEMENTS
========================================================= */

/*
 * The breakpoint marker, line number and execution highlight
 * are separate DOM elements.
 *
 * app.css supplies their positioning and appearance.
 *
 * No inline CSS is injected, because the local HTTP server's
 * Content Security Policy forbids inline styles.
 */

function buildLines(cell, textarea) {
    const gutter = gutterMap.get(cell.id);
    const overlay = overlayMap.get(cell.id);

    if (!gutter || !overlay) return;

    gutter.replaceChildren();
    overlay.replaceChildren();

    if (cell.cell_type !== 'code') {
        return;
    }

    const lineCount = Math.max(
        1,
        textarea.value.split('\n').length
    );

    const breakpoints = breakpointsOf(cell);

    const gutterFragment =
        document.createDocumentFragment();

    const overlayFragment =
        document.createDocumentFragment();

    for (let line = 1; line <= lineCount; line++) {
        // Breakpoint gutter row.
        const row = el('div', 'nb-gutter-row');

        row.dataset.line = String(line);
        row.setAttribute('role', 'button');
        row.tabIndex = 0;

        const active = breakpoints.includes(line);

        row.setAttribute(
            'aria-label',
            `${active ? 'Remove' : 'Set'} breakpoint at line ${line}`
        );

        row.title =
            `${active ? 'Remove' : 'Set'} breakpoint at line ${line}`;

        // Separate marker: never replace the line number.
        if (active) {
            const marker = el(
                'span',
                'nb-breakpoint-marker'
            );

            marker.setAttribute(
                'aria-hidden',
                'true'
            );

            row.appendChild(marker);
        }

        const number = el(
            'span',
            'nb-line-number',
            line
        );

        row.appendChild(number);

        row.addEventListener('click', () => {
            toggleBreakpoint(cell, line);
        });

        row.addEventListener('keydown', event => {
            if (
                event.key === 'Enter' ||
                event.key === ' '
            ) {
                event.preventDefault();

                toggleBreakpoint(cell, line);
            }
        });

        gutterFragment.appendChild(row);

        // Highlight row behind the code editor.
        const highlight = el(
            'div',
            'nb-execution-row'
        );

        highlight.dataset.line = String(line);

        highlight.setAttribute(
            'aria-hidden',
            'true'
        );

        overlayFragment.appendChild(highlight);
    }

    gutter.appendChild(gutterFragment);
    overlay.appendChild(overlayFragment);

    paintExecutionLine(false);
}

/* =========================================================
   CURRENT DEBUG EXECUTION LOCATION
========================================================= */

function clearExecutionLine() {
    document.querySelectorAll(
        '.nb-execution-row.is-current'
    ).forEach(node => {
        node.classList.remove('is-current');
    });

    document.querySelectorAll(
        '.nb-gutter-row.is-current'
    ).forEach(node => {
        node.classList.remove('is-current');
    });

    document.querySelectorAll(
        '.cell.is-debug-current'
    ).forEach(node => {
        node.classList.remove('is-debug-current');
    });
}

function setCurrentRow(container, line) {
    if (!container) return;

    const row = Array.from(container.children)
        .find(node =>
            Number(node.dataset.line) === line
        );

    row?.classList.add('is-current');
}

function paintExecutionLine(scrollIntoView = false) {
    clearExecutionLine();

    if (
        !latestState?.debugPaused ||
        !currentDebugLocation
    ) {
        return;
    }

    const location = currentDebugLocation;
    const line = Number(location.line);

    if (!Number.isInteger(line) || line < 1) {
        return;
    }

    const card = cellElement(location.cellId);
    const editor = editorMap.get(location.cellId);

    if (!card || !editor) {
        return;
    }

    const count = editor.value.split('\n').length;

    if (line > count) {
        return;
    }

    card.classList.add('is-debug-current');

    setCurrentRow(
        gutterMap.get(location.cellId),
        line
    );

    setCurrentRow(
        overlayMap.get(location.cellId),
        line
    );

    // Keep the overlay's vertical position aligned with
    // the scroll position of the corresponding textarea.
    const overlay = overlayMap.get(location.cellId);

    if (overlay) {
        overlay.scrollTop = editor.scrollTop;
        overlay.scrollLeft = editor.scrollLeft;
    }

    if (scrollIntoView) {
        card.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });

        const lineHeight = 22;
        const targetTop = (line - 1) * lineHeight;

        if (
            targetTop < editor.scrollTop ||
            targetTop + lineHeight >
                editor.scrollTop + editor.clientHeight
        ) {
            editor.scrollTop = Math.max(
                0,
                targetTop - editor.clientHeight / 3
            );

            if (overlay) {
                overlay.scrollTop = editor.scrollTop;
            }
        }
    }
}

function updateDebugLocation(state) {
    const location = state.debugPaused
        ? state.debugLocation || null
        : null;

    currentDebugLocation = location;

    const key = location
        ? [
            location.cellId,
            location.line,
            state.debugPauseRevision
        ].join(':')
        : null;

    const changed = key !== lastLocationKey;

    lastLocationKey = key;

    paintExecutionLine(
        changed && Boolean(location)
    );
}

/* =========================================================
   OUTPUT RENDERING
========================================================= */

function appendTextOutput(area, content, error = false) {
    const node = el(
        'pre',
        error ? 'out-error' : 'out-stream',
        content
    );

    area.appendChild(node);
}

function outputText(value) {
    return Array.isArray(value)
        ? value.join('')
        : String(value ?? '');
}

function renderOutputs(cell, container) {
    if (!container) return;

    container.replaceChildren();

    for (const output of cell.outputs || []) {
        const row = el('div', 'output-row');

        if (output.output_type === 'stream') {
            appendTextOutput(
                row,
                outputText(output.text)
            );

        } else if (output.output_type === 'error') {
            appendTextOutput(
                row,
                [
                    `${output.ename || 'Error'}: ${output.evalue || ''}`,
                    ...(output.traceback || [])
                ].join('\n'),
                true
            );

        } else if (output.data) {
            const data = output.data;

            if (data['image/png']) {
                const image = el('img');

                image.alt = 'Notebook image output';

                image.src =
                    'data:image/png;base64,' +
                    outputText(data['image/png']);

                row.appendChild(image);

            } else if (data['image/svg+xml']) {
                const frame = el('iframe');

                frame.title = 'SVG notebook output';
                frame.setAttribute('sandbox', '');

                frame.srcdoc = outputText(
                    data['image/svg+xml']
                );

                row.appendChild(frame);

            } else if (data['text/html']) {
                const frame = el('iframe');

                frame.title = 'HTML notebook output';
                frame.setAttribute('sandbox', '');

                frame.srcdoc = outputText(
                    data['text/html']
                );

                row.appendChild(frame);

            } else if (data['text/plain']) {
                appendTextOutput(
                    row,
                    outputText(data['text/plain'])
                );
            }
        }

        container.appendChild(row);
    }
}

function syncServerOutputs(state) {
    if (!notebook || !state.notebook) {
        return;
    }

    for (const remote of state.notebook.cells || []) {
        const local = cellById(remote.id);

        if (
            !local ||
            local.cell_type !== 'code'
        ) {
            continue;
        }

        local.outputs = clone(
            remote.outputs || []
        );

        local.execution_count =
            remote.execution_count ?? null;

        const card = cellElement(local.id);

        if (!card) continue;

        renderOutputs(
            local,
            card.querySelector('.cell-output')
        );

        const count = card.querySelector(
            '.cell-count'
        );

        if (count) {
            count.textContent =
                local.execution_count == null
                    ? '[ ]'
                    : `[${local.execution_count}]`;
        }
    }
}

/* =========================================================
   MARKDOWN PREVIEW
========================================================= */

function previewMarkdown(card, cell) {
    const container = card.querySelector(
        '.cell-output'
    );

    if (container.childNodes.length) {
        container.replaceChildren();
        return;
    }

    let codeBlock = null;
    let fenced = false;

    for (const line of textOf(cell).split('\n')) {
        if (line.trim().startsWith('```')) {
            fenced = !fenced;

            if (fenced) {
                codeBlock = el(
                    'pre',
                    'markdown-code'
                );

                container.appendChild(codeBlock);
            }

            continue;
        }

        if (fenced) {
            codeBlock.textContent += line + '\n';
            continue;
        }

        const heading = line.match(
            /^(#{1,6})\s+(.*)$/
        );

        if (heading) {
            container.appendChild(
                el(
                    `h${heading[1].length}`,
                    'md-header',
                    heading[2]
                )
            );

            continue;
        }

        const bullet = line.match(
            /^\s*[-*+]\s+(.*)$/
        );

        if (bullet) {
            container.appendChild(
                el(
                    'div',
                    'md-bullet',
                    '• ' + bullet[1]
                )
            );

            continue;
        }

        if (!line.trim()) {
            container.appendChild(
                el('div', 'md-spacer')
            );

            continue;
        }

        container.appendChild(
            el(
                'p',
                'md-paragraph',
                line
            )
        );
    }
}

/* =========================================================
   NOTEBOOK RENDERING
========================================================= */

function render() {
    if (!notebook) return;

    editorMap.clear();
    gutterMap.clear();
    overlayMap.clear();

    const container = $('cells');
    const outline = $('cellOutline');

    container.replaceChildren();
    outline.replaceChildren();

    $('notebookTitle').textContent =
        filename($('fileLabel').textContent)
            .replace(/\.ipynb$/i, '');

    cells().forEach((cell, index) => {
        const card = el(
            'section',
            `cell ${cell.cell_type}`
        );

        card.dataset.cellId = cell.id;

        /* -------------------------------------------------
           CELL TOOLBAR
        ------------------------------------------------- */

        const bar = el('div', 'cellbar');

        bar.appendChild(
            el(
                'span',
                'celltype',
                cell.cell_type.toUpperCase()
            )
        );

        const count = el(
            'span',
            'cell-count',
            cell.execution_count == null
                ? '[ ]'
                : `[${cell.execution_count}]`
        );

        bar.appendChild(count);

        if (cell.cell_type === 'code') {
            bar.appendChild(
                button(
                    '▶ Run',
                    () => runCell(cell.id),
                    'run'
                )
            );

            bar.appendChild(
                button(
                    '◆ Debug',
                    () => runCell(cell.id, true),
                    'debug'
                )
            );

        } else if (cell.cell_type === 'markdown') {
            bar.appendChild(
                button(
                    'Preview',
                    () => previewMarkdown(card, cell),
                    'run'
                )
            );
        }

        bar.appendChild(
            el('span', 'spacer')
        );

        bar.appendChild(
            button(
                '↑',
                () => moveCell(index, -1)
            )
        );

        bar.appendChild(
            button(
                '↓',
                () => moveCell(index, 1)
            )
        );

        bar.appendChild(
            button(
                '+',
                () => addCell(index + 1, 'code')
            )
        );

        bar.appendChild(
            button(
                '⧉',
                () => duplicateCell(index)
            )
        );

        bar.appendChild(
            button(
                '⋯',
                () => changeCellType(index)
            )
        );

        bar.appendChild(
            button(
                '×',
                () => deleteCell(index)
            )
        );

        card.appendChild(bar);

        /* -------------------------------------------------
           CELL EDITOR
        ------------------------------------------------- */

        const editorArea = el(
            'div',
            'cell-editor'
        );

        const gutter = el(
            'div',
            'gutter nb-gutter'
        );

        gutterMap.set(
            cell.id,
            gutter
        );

        editorArea.appendChild(gutter);

        const editorWrap = el(
            'div',
            'nb-editor-wrap'
        );

        const overlay = el(
            'div',
            'nb-highlight-overlay'
        );

        overlay.setAttribute(
            'aria-hidden',
            'true'
        );

        overlayMap.set(
            cell.id,
            overlay
        );

        const textarea = el(
            'textarea',
            'code nb-code-editor'
        );

        textarea.value = textOf(cell);
        textarea.spellcheck = false;

        textarea.rows = Math.max(
            2,
            textarea.value.split('\n').length
        );

        textarea.setAttribute(
            'aria-label',
            `${cell.cell_type} cell ${index + 1}`
        );

        editorMap.set(
            cell.id,
            textarea
        );

        textarea.addEventListener(
            'input',
            () => {
                cell.source = textarea.value;

                textarea.rows = Math.max(
                    2,
                    textarea.value.split('\n').length
                );

                buildLines(cell, textarea);

                setDirty();
            }
        );

        textarea.addEventListener(
            'scroll',
            () => {
                overlay.scrollTop = textarea.scrollTop;
                overlay.scrollLeft = textarea.scrollLeft;
            }
        );

        textarea.addEventListener(
            'keydown',
            event => {
                if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === 'Enter'
                ) {
                    event.preventDefault();

                    runCell(cell.id);
                    return;
                }

                if (
                    event.shiftKey &&
                    event.key === 'Enter'
                ) {
                    event.preventDefault();

                    runCell(
                        cell.id,
                        false,
                        true
                    );

                    return;
                }

                if (event.key === 'Tab') {
                    event.preventDefault();

                    const start =
                        textarea.selectionStart;

                    const end =
                        textarea.selectionEnd;

                    textarea.setRangeText(
                        '    ',
                        start,
                        end,
                        'end'
                    );

                    textarea.dispatchEvent(
                        new Event('input')
                    );
                }
            }
        );

        editorWrap.appendChild(overlay);
        editorWrap.appendChild(textarea);

        editorArea.appendChild(editorWrap);
        card.appendChild(editorArea);

        /* -------------------------------------------------
           CELL OUTPUTS
        ------------------------------------------------- */

        const output = el(
            'div',
            'cell-output'
        );

        renderOutputs(cell, output);

        card.appendChild(output);

        container.appendChild(card);

        buildLines(cell, textarea);

        /* -------------------------------------------------
           NOTEBOOK OUTLINE
        ------------------------------------------------- */

        const outlineItem = el(
            'div',
            'outline-item'
        );

        outlineItem.appendChild(
            el(
                'small',
                '',
                String(index + 1).padStart(2, '0')
            )
        );

        outlineItem.appendChild(
            el(
                'span',
                '',
                (
                    textOf(cell).split('\n')[0].trim() ||
                    `Empty ${cell.cell_type}`
                ).slice(0, 35)
            )
        );

        outlineItem.addEventListener(
            'click',
            () => {
                card.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        );

        outline.appendChild(outlineItem);
    });

    paintExecutionLine(false);
}

/* =========================================================
   CELL MANAGEMENT
========================================================= */

function addCell(index, type) {
    if (busy) {
        toast('Finish execution before adding cells');
        return;
    }

    syncEditors();

    const cell = createCell(type);

    notebook.cells.splice(
        index,
        0,
        cell
    );

    render();
    setDirty();

    editorMap.get(cell.id)?.focus();
}

function duplicateCell(index) {
    if (busy) return;

    syncEditors();

    const duplicate = clone(
        notebook.cells[index]
    );

    duplicate.id = newId();

    if (duplicate.cell_type === 'code') {
        duplicate.execution_count = null;
        duplicate.outputs = [];
    }

    notebook.cells.splice(
        index + 1,
        0,
        duplicate
    );

    render();
    setDirty();
}

function moveCell(index, direction) {
    if (busy) return;

    const next = index + direction;

    if (
        next < 0 ||
        next >= notebook.cells.length
    ) {
        return;
    }

    syncEditors();

    [
        notebook.cells[index],
        notebook.cells[next]
    ] = [
        notebook.cells[next],
        notebook.cells[index]
    ];

    render();
    setDirty();
}

function changeCellType(index) {
    if (busy) return;

    const cell = notebook.cells[index];

    const type = prompt(
        'Cell type: code, markdown or raw',
        cell.cell_type
    );

    if (!type) return;

    if (
        !['code', 'markdown', 'raw'].includes(type)
    ) {
        toast('Invalid cell type');
        return;
    }

    syncEditors();

    cell.cell_type = type;

    if (type === 'code') {
        cell.outputs ||= [];
        cell.execution_count ??= null;

    } else {
        delete cell.outputs;
        delete cell.execution_count;
    }

    render();
    setDirty();
}

function deleteCell(index) {
    if (busy) return;

    if (notebook.cells.length <= 1) {
        toast('A notebook must contain at least one cell');
        return;
    }

    if (!confirm('Delete this cell?')) {
        return;
    }

    syncEditors();

    notebook.cells.splice(index, 1);

    render();
    setDirty();
}

/* =========================================================
   SAVE NOTEBOOK
========================================================= */

async function save(silent = false) {
    if (!notebook) return false;

    if (saving || busy) {
        if (!silent) {
            toast('Wait until execution finishes');
        }

        return false;
    }

    syncEditors();

    if (!dirty && fileHash !== null) {
        if (!silent) {
            toast('Notebook already saved');
        }

        return true;
    }

    saving = true;
    updateSaveState();

    try {
        const response = await request(
            '/api/save',
            {
                notebook,
                fileHash
            }
        );

        fileHash = response.fileHash;
        dirty = false;

        if (!silent) {
            toast('Notebook saved');
        }

        return true;

    } catch (error) {
        toast('Save failed: ' + error.message);
        return false;

    } finally {
        saving = false;
        updateSaveState();
    }
}

/* =========================================================
   CLEAR OUTPUTS
========================================================= */

async function clearOutputs() {
    if (!notebook) return;

    if (
        busy ||
        startingExecution ||
        latestState?.busy
    ) {
        toast(
            'Stop the running cell before clearing outputs.'
        );

        return;
    }

    if (!confirm('Clear all cell outputs?')) {
        return;
    }

    // Save unsaved code before changing the notebook file.
    if (!await save(true)) {
        return;
    }

    try {
        const response = await request(
            '/api/clear_outputs',
            {}
        );

        fileHash = response.fileHash;

        for (const cell of cells()) {
            if (cell.cell_type !== 'code') {
                continue;
            }

            cell.outputs = [];
            cell.execution_count = null;

            const card = cellElement(cell.id);

            if (!card) continue;

            card.querySelector(
                '.cell-output'
            )?.replaceChildren();

            const count = card.querySelector(
                '.cell-count'
            );

            if (count) {
                count.textContent = '[ ]';
            }
        }

        dirty = false;
        updateSaveState();

        toast('Outputs cleared and saved');

        schedulePoll(0);

    } catch (error) {
        toast(
            'Clear Outputs failed: ' + error.message
        );
    }
}

/* =========================================================
   RUN / DEBUG ONE CELL
========================================================= */

async function runCell(
    cellId,
    debug = false,
    focusNext = false,
    fromRunAll = false
) {
    if (
        busy ||
        startingExecution ||
        saving ||
        (runningAll && !fromRunAll)
    ) {
        toast('Kernel busy — wait for the current cell');
        return false;
    }

    const cell = cellById(cellId);

    if (
        !cell ||
        cell.cell_type !== 'code'
    ) {
        toast('Select a Python code cell');
        return false;
    }

    startingExecution = true;

    try {
        syncEditors();

        if (!await save(true)) {
            return false;
        }

        const breakpoints = breakpointsOf(cell);

        if (debug) {
            debuggerDismissed = false;
            debugRequested = true;

            lastPauseSignature = null;
            variableRequestId++;

        } else {
            debugRequested = false;
        }

        const response = await request(
            '/api/run',
            {
                cellId,
                debug,
                breakpoints
            }
        );

        if (!response.started) {
            throw new Error(
                'Kernel did not start execution'
            );
        }

        busy = true;

        clearExecutionLine();

        currentDebugLocation = null;
        lastLocationKey = null;

        if (debug) {
            toast('Starting debugger…');

            updateFloatingDebugger({
                ...(latestState || {}),
                busy: true,
                debugStarting: true
            });

        } else {
            toast('Running cell…');
        }

        schedulePoll(0);

        if (focusNext) {
            const index = cells().findIndex(
                item => item.id === cellId
            );

            let next = cells()[index + 1];

            if (!next) {
                next = createCell('code');

                notebook.cells.push(next);

                render();
                setDirty();
            }

            editorMap.get(next.id)?.focus();
        }

        return true;

    } catch (error) {
        debugRequested = false;

        toast(
            'Execution failed: ' + error.message
        );

        return false;

    } finally {
        startingExecution = false;
    }
}

/* =========================================================
   RUN ALL CELLS
========================================================= */

async function waitUntilIdle() {
    const deadline = Date.now() + 24 * 3600 * 1000;

    while (Date.now() < deadline) {
        if (cancelRunAll) {
            return false;
        }

        await sleep(200);

        let state;

        try {
            state = await request('/api/state');
        } catch (error) {
            toast(error.message);
            return false;
        }

        applyServerState(state);

        if (!state.busy) {
            return !state.error;
        }
    }

    toast('Run All timed out');
    return false;
}

async function runAllCells() {
    if (
        runningAll ||
        busy ||
        startingExecution ||
        !notebook
    ) {
        return;
    }

    runningAll = true;
    cancelRunAll = false;

    $('runAllBtn').disabled = true;

    try {
        const ids = cells()
            .filter(cell => cell.cell_type === 'code')
            .map(cell => cell.id);

        for (const id of ids) {
            if (cancelRunAll) break;

            const started = await runCell(
                id,
                false,
                false,
                true
            );

            if (!started) break;

            const completed = await waitUntilIdle();

            if (!completed) break;
        }

    } finally {
        runningAll = false;
        cancelRunAll = false;

        $('runAllBtn').disabled = false;

        schedulePoll(0);
    }
}

/* =========================================================
   DEBUGGER VARIABLES
========================================================= */

async function refreshVariables() {
    const sidebar = $('debuggerSidebar');

    if (
        !sidebar ||
        sidebar.hidden ||
        variableLoading
    ) {
        return;
    }

    variableLoading = true;

    const requestId = ++variableRequestId;

    try {
        const response = await request(
            '/api/variables'
        );

        if (requestId !== variableRequestId) {
            return;
        }

        const container = $('variables');

        container.replaceChildren();

        const variables = response.variables || [];

        if (!variables.length) {
            container.textContent =
                'No user variables reported.';

            return;
        }

        for (const variable of variables.slice(0, 80)) {
            const row = el('div', 'var-row');

            row.appendChild(
                el(
                    'strong',
                    '',
                    variable.name || 'Variable'
                )
            );

            row.appendChild(
                el(
                    'span',
                    '',
                    variable.value ??
                    variable.type ??
                    ''
                )
            );

            container.appendChild(row);
        }

    } catch (error) {
        if (requestId === variableRequestId) {
            $('variables').textContent =
                'Variables unavailable: ' +
                error.message;
        }

    } finally {
        variableLoading = false;
    }
}

/* =========================================================
   DEBUGGER STEPPING
========================================================= */

async function step(command) {
    if (stepPending) {
        return;
    }

    if (!latestState?.debugPaused) {
        toast('Debugger is not paused');
        return;
    }

    stepPending = true;

    updateFloatingDebugger(latestState);

    try {
        await request(
            '/api/step',
            {command}
        );

        currentDebugLocation = null;
        lastLocationKey = null;
        lastPauseSignature = null;

        variableRequestId++;

        clearExecutionLine();

        schedulePoll(0);

    } catch (error) {
        toast(
            'Debugger command failed: ' +
            error.message
        );

    } finally {
        stepPending = false;

        schedulePoll(0);
    }
}

async function pauseDebugger() {
    if (
        stepPending ||
        !latestState?.busy ||
        latestState.debugPaused ||
        !latestState.debugActive
    ) {
        return;
    }

    stepPending = true;

    try {
        await request(
            '/api/step',
            {command: 'pause'}
        );

        toast('Pause requested');

    } catch (error) {
        toast(
            'Pause failed: ' + error.message
        );

    } finally {
        stepPending = false;
        schedulePoll(0);
    }
}

/* =========================================================
   STOP DEBUGGER
========================================================= */

async function stopDebugger() {
    if (debuggerStopping) {
        return;
    }

    debuggerStopping = true;
    cancelRunAll = true;

    try {
        await request(
            '/api/stop_debug',
            {}
        );

        toast(
            'Stopping debugger. Recovery may restart the kernel.'
        );

        schedulePoll(0);

    } catch (error) {
        toast(
            'Could not stop debugger: ' +
            error.message
        );

    } finally {
        debuggerStopping = false;
        schedulePoll(0);
    }
}

/* =========================================================
   FLOATING DEBUGGER
========================================================= */

function showFloatingDebugger(show) {
    const toolbar = $('floatingDebugger');

    if (!toolbar) return;

    toolbar.hidden = !show;

    toolbar.setAttribute(
        'aria-hidden',
        String(!show)
    );
}

function updateFloatingDebugger(state) {
    const toolbar = $('floatingDebugger');

    if (!toolbar) return;

    const paused = Boolean(state.debugPaused);
    const starting = Boolean(state.debugStarting);

    const debugging =
        debugRequested && Boolean(state.busy);

    const visible =
        !debuggerDismissed &&
        (
            paused ||
            starting ||
            debugging
        );

    showFloatingDebugger(visible);

    toolbar.classList.toggle(
        'is-paused',
        paused
    );

    toolbar.classList.toggle(
        'is-starting',
        starting && !paused
    );

    toolbar.classList.toggle(
        'is-running',
        visible && !paused && !starting
    );

    const indicator = $('floatingDebugIndicator');
    const status = $('floatingDebugStatus');

    if (indicator && status) {
        if (paused) {
            indicator.textContent = '●';

            status.textContent =
                currentDebugLocation
                    ? `Paused in Debugger · Line ${currentDebugLocation.line}`
                    : 'Paused in Debugger · Resolving line…';

        } else if (starting) {
            indicator.textContent = '◉';
            status.textContent = 'Starting Debugger…';

        } else if (debugging) {
            indicator.textContent = '●';
            status.textContent = 'Debugging…';

        } else {
            status.textContent = 'Debugger';
        }
    }

    const canStep =
        paused &&
        !stepPending &&
        !debuggerStopping &&
        !state.stopPending;

    const canPause =
        !paused &&
        Boolean(state.busy) &&
        Boolean(state.debugActive) &&
        !starting &&
        !stepPending &&
        !state.stopPending;

    const canStop =
        Boolean(state.busy) &&
        !debuggerStopping &&
        !state.stopPending;

    const controls = {
        floatingContinueBtn: canStep,
        floatingStepOverBtn: canStep,
        floatingStepIntoBtn: canStep,
        floatingStepOutBtn: canStep,
        floatingPauseBtn: canPause,
        floatingStopBtn: canStop
    };

    for (const [id, enabled] of Object.entries(controls)) {
        if ($(id)) {
            $(id).disabled = !enabled;
        }
    }
}

function initializeFloatingDebugger() {
    showFloatingDebugger(false);

    const actions = {
        floatingContinueBtn:
            () => step('continue'),

        floatingStepOverBtn:
            () => step('next'),

        floatingStepIntoBtn:
            () => step('stepIn'),

        floatingStepOutBtn:
            () => step('stepOut'),

        floatingPauseBtn:
            pauseDebugger,

        floatingStopBtn:
            stopDebugger,

        floatingCloseBtn:
            () => {
                debuggerDismissed = true;
                showFloatingDebugger(false);
            }
    };

    for (const [id, action] of Object.entries(actions)) {
        const control = $(id);

        if (control) {
            control.onclick = action;
        }
    }
}

/* =========================================================
   BREAKPOINT VERIFICATION STATUS
========================================================= */

function updateBreakpointStatus(state) {
    const container = $('bpStatus');

    if (!container) return;

    container.replaceChildren();

    for (const breakpoint of (
        state.debugBreakpointStatus || []
    )) {
        const label = breakpoint.verified
            ? '✓ Verified'
            : '✕ Rejected';

        const requested = breakpoint.requestedLine;
        const actual = breakpoint.actualLine;

        const moved =
            actual && actual !== requested
                ? ` → ${actual}`
                : '';

        const automatic =
            breakpoint.automatic
                ? ' (automatic)'
                : '';

        const row = el(
            'div',
            breakpoint.verified
                ? 'bp-ok'
                : 'bp-fail',
            `${label}: line ${requested}${moved}${automatic}`
        );

        if (breakpoint.message) {
            row.title = breakpoint.message;
        }

        container.appendChild(row);
    }
}

/* =========================================================
   APPLY BACKEND STATE
========================================================= */

function applyServerState(state) {
    const previouslyBusy = busy;

    latestState = state;
    busy = Boolean(state.busy);

    const completed =
        previouslyBusy && !state.busy;

    /* -----------------------------------------------------
       SYNCHRONIZE OUTPUTS
    ----------------------------------------------------- */

    if (
        state.changed !== lastChanged ||
        completed
    ) {
        syncServerOutputs(state);

        // Do not overwrite a new local file hash while
        // a notebook save is in progress.
        if (!saving) {
            fileHash = state.fileHash;
        }

        lastChanged = state.changed;
    }

    /* -----------------------------------------------------
       CELL EXECUTION STATUS
    ----------------------------------------------------- */

    for (const card of document.querySelectorAll('.cell')) {
        card.classList.toggle(
            'running',
            state.busy &&
            state.running === card.dataset.cellId
        );
    }

    if (completed) {
        debugRequested = false;
        debuggerStopping = false;

        if (!$('debuggerSidebar')?.hidden) {
            refreshVariables();
        }
    }

    /* -----------------------------------------------------
       KERNEL STATUS
    ----------------------------------------------------- */

    const status = $('kernelStatus');

    if (status) {
        status.textContent = state.stopPending
            ? '◉ Stopping…'
            : state.busy
                ? '◉ Executing'
                : state.kernelReady
                    ? `● ${state.kernel} ready`
                    : `○ ${state.kernel} idle`;

        status.classList.toggle(
            'online',
            Boolean(state.kernelReady)
        );
    }

    if (
        state.kernel &&
        state.kernel !== currentKernel
    ) {
        currentKernel = state.kernel;

        if ($('kernelSelect')) {
            $('kernelSelect').value = state.kernel;
        }
    }

    /* -----------------------------------------------------
       DEBUGGER STATUS
    ----------------------------------------------------- */

    const debugState = $('debugState');

    if (debugState) {
        debugState.textContent =
            state.debugPaused
                ? 'PAUSED'
                : state.debugStarting
                    ? 'Starting…'
                    : state.debugActive
                        ? 'Connected'
                        : state.debugSupported
                            ? 'Supported'
                            : 'Unavailable';
    }

    const canStep =
        Boolean(state.debugPaused) &&
        !stepPending &&
        !debuggerStopping &&
        !state.stopPending;

    for (const id of [
        'continueBtn',
        'stepOverBtn',
        'stepIntoBtn',
        'stepOutBtn'
    ]) {
        if ($(id)) {
            $(id).disabled = !canStep;
        }
    }

    /* -----------------------------------------------------
       ACTUAL DEBUG LOCATION
    ----------------------------------------------------- */

    updateDebugLocation(state);

    /* -----------------------------------------------------
       FLOATING DEBUGGER
    ----------------------------------------------------- */

    updateFloatingDebugger(state);

    /* -----------------------------------------------------
       BREAKPOINT STATUS
    ----------------------------------------------------- */

    updateBreakpointStatus(state);

    /* -----------------------------------------------------
       VARIABLES
    ----------------------------------------------------- */

    if (state.debugPaused) {
        const signature = [
            state.debugPauseRevision,
            state.debugLocation?.cellId,
            state.debugLocation?.line
        ].join(':');

        if (signature !== lastPauseSignature) {
            lastPauseSignature = signature;

            if (!$('debuggerSidebar')?.hidden) {
                refreshVariables();
            }
        }

    } else {
        lastPauseSignature = null;
    }

    /* -----------------------------------------------------
       DEBUG EVENTS
    ----------------------------------------------------- */

    if (state.debugEvent?.event && $('events')) {
        const value = JSON.stringify(
            state.debugEvent,
            null,
            2
        ).slice(0, 1800);

        if ($('events').textContent !== value) {
            $('events').textContent = value;
        }
    }

    /* -----------------------------------------------------
       DEBUG OUTCOME
    ----------------------------------------------------- */

    if (
        state.debugLastOutcome &&
        state.debugLastOutcome !== lastDebugOutcome
    ) {
        lastDebugOutcome = state.debugLastOutcome;

        toast(state.debugLastOutcome);
    }

    /* -----------------------------------------------------
       RECOVERY MESSAGES
    ----------------------------------------------------- */

    if (state.recoveryNotice) {
        if (state.recoveryNotice !== lastDebugOutcome) {
            lastDebugOutcome = state.recoveryNotice;
            toast(state.recoveryNotice);
        }
    }

    /* -----------------------------------------------------
       ERRORS
    ----------------------------------------------------- */

    if (
        state.error &&
        state.error !== lastError
    ) {
        lastError = state.error;

        toast(
            'Kernel: ' + state.error
        );
    }

    updateSaveState();
}

/* =========================================================
   ADAPTIVE POLLING
========================================================= */

function pollDelay() {
    if (
        busy ||
        latestState?.debugPaused ||
        latestState?.stopPending
    ) {
        return 200;
    }

    return 750;
}

function schedulePoll(delay = null) {
    clearTimeout(pollTimer);

    pollTimer = setTimeout(
        poll,
        delay ?? pollDelay()
    );
}

async function poll() {
    if (polling) {
        schedulePoll(150);
        return;
    }

    polling = true;

    try {
        const state = await request('/api/state');

        applyServerState(state);

    } catch (error) {
        if ($('kernelStatus')) {
            $('kernelStatus').textContent =
                'Disconnected';
        }

        if (error.message !== lastError) {
            lastError = error.message;
            toast(error.message);
        }

    } finally {
        polling = false;
        schedulePoll();
    }
}

/* =========================================================
   COLLAPSIBLE SIDEBARS
========================================================= */

function setSidebar(which, open) {
    const outline = which === 'outline';

    const layout = $('studioLayout');

    const sidebar = $(
        outline
            ? 'notebookSidebar'
            : 'debuggerSidebar'
    );

    const toggle = $(
        outline
            ? 'toggleOutlineBtn'
            : 'toggleInspectorBtn'
    );

    if (!layout || !sidebar || !toggle) {
        return;
    }

    layout.classList.toggle(
        outline
            ? 'show-outline'
            : 'show-inspector',
        open
    );

    sidebar.hidden = !open;

    toggle.setAttribute(
        'aria-expanded',
        String(open)
    );

    const label = outline
        ? 'notebook sidebar'
        : 'debugger panel';

    toggle.title =
        (open ? 'Hide ' : 'Show ') + label;

    toggle.setAttribute(
        'aria-label',
        toggle.title
    );

    if (
        open &&
        !outline &&
        latestState?.debugSupported
    ) {
        refreshVariables();
    }
}

function initializeSidebars() {
    setSidebar('outline', false);
    setSidebar('inspector', false);

    if ($('toggleOutlineBtn')) {
        $('toggleOutlineBtn').onclick = () => {
            setSidebar(
                'outline',
                $('notebookSidebar').hidden
            );
        };
    }

    if ($('toggleInspectorBtn')) {
        $('toggleInspectorBtn').onclick = () => {
            setSidebar(
                'inspector',
                $('debuggerSidebar').hidden
            );
        };
    }
}

/* =========================================================
   KERNEL CONTROLS
========================================================= */

async function interruptKernel() {
    cancelRunAll = true;

    try {
        const response = await request(
            '/api/interrupt',
            {}
        );

        toast(
            response.interrupted
                ? 'Stopping kernel execution…'
                : 'Kernel is already idle'
        );

        schedulePoll(0);

    } catch (error) {
        toast(
            'Stop failed: ' + error.message
        );
    }
}

async function restartKernel(kernelName = null) {
    if (
        !confirm(
            'Restart the Python kernel? ' +
            'All in-memory variables will be lost.'
        )
    ) {
        if ($('kernelSelect')) {
            $('kernelSelect').value = currentKernel;
        }

        return;
    }

    cancelRunAll = true;

    try {
        await request(
            '/api/restart',
            {
                kernel: kernelName
            }
        );

        currentDebugLocation = null;
        lastLocationKey = null;

        debugRequested = false;
        debuggerDismissed = false;

        clearExecutionLine();
        showFloatingDebugger(false);

        if (kernelName) {
            currentKernel = kernelName;
        }

        toast('Kernel restarted');

        schedulePoll(0);

    } catch (error) {
        if ($('kernelSelect')) {
            $('kernelSelect').value = currentKernel;
        }

        toast(
            'Restart failed: ' + error.message
        );
    }
}

/* =========================================================
   INITIALIZATION
========================================================= */

async function init() {
    if (initialized) {
        return;
    }

    initialized = true;

    try {
        const state = await request('/api/state');

        notebook = state.notebook;
        fileHash = state.fileHash;

        latestState = state;
        lastChanged = state.changed;

        busy = Boolean(state.busy);
        currentKernel = state.kernel;

        $('filename').textContent =
            filename(state.path);

        $('fileLabel').textContent =
            state.path;

        const response = await request(
            '/api/kernels'
        );

        const select = $('kernelSelect');

        select.replaceChildren();

        const kernelNames =
            response.kernels || [];

        if (!kernelNames.includes(state.kernel)) {
            kernelNames.push(state.kernel);
        }

        for (const name of kernelNames) {
            const option = el(
                'option',
                '',
                name
            );

            option.value = name;

            select.appendChild(option);
        }

        select.value = state.kernel;

        select.addEventListener(
            'change',
            () => {
                const selected = select.value;

                restartKernel(selected);
            }
        );

        render();
        updateSaveState();

        if (state.recoveryWarning) {
            toast(state.recoveryWarning);
        }

        applyServerState(state);

        schedulePoll(0);

    } catch (error) {
        initialized = false;

        toast(
            'Notebook initialization failed: ' +
            error.message
        );
    }
}

/* =========================================================
   TOOLBAR
========================================================= */

function initializeToolbar() {
    $('saveBtn').onclick = () => save();

    $('clearBtn').onclick = clearOutputs;

    $('runAllBtn').onclick = runAllCells;

    $('addCodeBtn').onclick = () => {
        if (notebook) {
            addCell(cells().length, 'code');
        }
    };

    $('addMarkdownBtn').onclick = () => {
        if (notebook) {
            addCell(cells().length, 'markdown');
        }
    };

    $('addRawBtn').onclick = () => {
        if (notebook) {
            addCell(cells().length, 'raw');
        }
    };

    $('refreshVars').onclick = refreshVariables;

    $('interruptBtn').onclick =
        interruptKernel;

    $('restartBtn').onclick =
        () => restartKernel();

    $('continueBtn').onclick =
        () => step('continue');

    $('stepOverBtn').onclick =
        () => step('next');

    $('stepIntoBtn').onclick =
        () => step('stepIn');

    $('stepOutBtn').onclick =
        () => step('stepOut');
}

/* =========================================================
   KEYBOARD SHORTCUTS
========================================================= */

document.addEventListener(
    'keydown',
    event => {
        if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 's'
        ) {
            event.preventDefault();

            save();
        }
    }
);

/* =========================================================
   UNSAVED CHANGES
========================================================= */

window.addEventListener(
    'beforeunload',
    event => {
        if (dirty) {
            event.preventDefault();

            event.returnValue = '';
        }
    }
);

/* =========================================================
   START
========================================================= */

initializeSidebars();
initializeFloatingDebugger();
initializeToolbar();
init();