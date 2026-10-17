'use strict';

const CONFIG_PY = 'jupyterbridge.python';
const CONFIG_KERNEL = 'jupyterbridge.kernelOverride';
const CONFIG_AUTOPREVIEW = 'jupyterbridge.autoPreview';

const TASK_IDENTIFIER = 'jupyterbridge.notebookStudioTasks';
const STUDIO_COMMAND = 'jupyterbridge.openStudio';
const LAB_COMMAND = 'jupyterbridge.openLab';

let studioProcess = null;
let studioURL = null;
let studioNotebook = null;
let studioReady = false;
let studioOutput = '';

let labProcess = null;
let labURL = null;
let labNotebook = null;
let labReady = false;
let labPort = null;
let labToken = null;
let labOutput = '';
let labStartupError = '';
let labStartupTimer = null;

let previewProcess = null;
let lastNotebookPath = null;
let taskAssistantDisposable = null;

function python() {
    return (
        nova.workspace.config.get(
            CONFIG_PY,
            'string'
        ) || 'python3'
    );
}

function kernel() {
    return (
        nova.workspace.config.get(
            CONFIG_KERNEL,
            'string'
        ) || ''
    );
}

function project() {
    return nova.workspace.path;
}

function autoPreviewEnabled() {
    return (
        nova.workspace.config.get(
            CONFIG_AUTOPREVIEW,
            'boolean'
        ) !== false
    );
}

function extensionScript(filename) {
    return nova.path.join(
        nova.extension.path,
        'Scripts',
        filename
    );
}

function isNotebook(path) {
    return (
        typeof path === 'string' &&
        path.toLowerCase().endsWith('.ipynb')
    );
}

function notebookInProject(path) {
    return (
        isNotebook(path) &&
        Boolean(project()) &&
        nova.workspace.contains(path)
    );
}

function currentNotebook() {
    const document =
        nova.workspace.activeTextEditor?.document;

    if (
        document &&
        notebookInProject(document.path)
    ) {
        return document.path;
    }

    return null;
}

function selectNotebook(callback) {
    const current = currentNotebook();

    if (current) {
        lastNotebookPath = current;
        callback(current);
        return;
    }

    if (
        lastNotebookPath &&
        notebookInProject(lastNotebookPath)
    ) {
        callback(lastNotebookPath);
        return;
    }

    nova.workspace.showFileChooser(
        'Select a Jupyter notebook (.ipynb) in this project',
        {
            allowFiles: true,
            allowFolders: false,
            filetype: ['ipynb']
        },
        paths => {
            if (
                !paths ||
                !paths.length
            ) {
                return;
            }

            const selected = paths[0];

            if (!notebookInProject(selected)) {
                nova.workspace.showErrorMessage(
                    'Select an .ipynb notebook inside ' +
                    'the current Nova project.'
                );
                return;
            }

            lastNotebookPath = selected;
            callback(selected);
        }
    );
}

function validStudioURL(value) {
    if (typeof value !== 'string') {
        return false;
    }

    const match = value.match(
        /^http:\/\/127\.0\.0\.1:(\d{1,5})\/\?key=[A-Za-z0-9_-]+$/
    );

    if (!match) {
        return false;
    }

    const port = Number(match[1]);

    return port > 0 && port <= 65535;
}

function validLabURL(value) {
    if (typeof value !== 'string') {
        return false;
    }

    const match = value.match(
        /^http:\/\/127\.0\.0\.1:(\d{1,5})\/lab(?:\/tree\/[A-Za-z0-9._~%/-]+)?\?token=[A-Za-z0-9._~%-]+$/
    );

    if (!match) {
        return false;
    }

    const port = Number(match[1]);

    return port > 0 && port <= 65535;
}

function validLocalURL(value) {
    return (
        validStudioURL(value) ||
        validLabURL(value)
    );
}

function copyPrivateURL(url) {
    if (!validLocalURL(url)) {
        return Promise.reject(
            new Error(
                'Invalid local notebook URL.'
            )
        );
    }

    return nova.clipboard.writeText(url);
}

function showManualPreviewInstructions(
    name,
    reason
) {
    console.warn(
        name +
        ': automatic Preview unavailable (' +
        reason +
        ').'
    );

    nova.workspace.showInformativeMessage(
        name +
        ' is ready. Its private local URL has ' +
        'been copied to the clipboard.\n\n' +

        'To open it in Nova Preview:\n\n' +

        '1. Open Nova Preview.\n' +
        '2. Focus the Preview address bar.\n' +
        '3. Paste the copied URL.\n' +
        '4. Press Return.\n\n' +

        'Automatic Preview navigation is optional ' +
        'and depends on Nova and macOS permissions.'
    );
}

const PREVIEW_APPLESCRIPT = String.raw`
on run
    tell application "Nova" to activate
    delay 0.25

    tell application "System Events"
        tell process "Nova"
            set frontmost to true
            keystroke "4" using {control down, command down}
            delay 0.7

            repeat with attemptNumber from 1 to 12
                set addressFocused to false

                try
                    keystroke "l" using {command down}
                    delay 0.12
                    set targetElement to focused UI element
                    set targetRole to role of targetElement as text

                    if targetRole is "AXTextField" or targetRole is "AXComboBox" or targetRole is "AXSearchField" or targetRole is "AXWebTextField" then
                        set targetSize to size of targetElement
                        set targetPosition to position of targetElement
                        set windowPosition to position of front window

                        if (item 1 of targetSize) > 240 and (item 2 of targetPosition) > ((item 2 of windowPosition) + 30) and (item 2 of targetPosition) < ((item 2 of windowPosition) + 220) then
                            set addressFocused to true
                        end if
                    end if
                end try

                if not addressFocused then
                    try
                        set windowPosition to position of front window
                        set candidates to entire contents of front window

                        repeat with candidate in candidates
                            try
                                set candidateRole to role of candidate as text

                                if candidateRole is "AXTextField" or candidateRole is "AXComboBox" or candidateRole is "AXSearchField" or candidateRole is "AXWebTextField" then
                                    set candidateSize to size of candidate
                                    set candidatePosition to position of candidate

                                    if (item 1 of candidateSize) > 240 and (item 2 of candidatePosition) > ((item 2 of windowPosition) + 30) and (item 2 of candidatePosition) < ((item 2 of windowPosition) + 220) then
                                        set candidateValue to ""

                                        try
                                            set candidateValue to value of candidate as text
                                        end try

                                        if candidateValue contains "localhost:" or candidateValue contains "127.0.0.1:" then
                                            click candidate
                                            delay 0.15
                                            set addressFocused to true
                                            exit repeat
                                        end if
                                    end if
                                end if
                            end try
                        end repeat
                    end try
                end if

                if not addressFocused then
                    try
                        set windowPosition to position of front window
                        set windowSize to size of front window

                        if (item 1 of windowSize) > 760 then
                            set clickX to ((item 1 of windowPosition) + ((item 1 of windowSize) * 0.44)) as integer
                            set clickY to ((item 2 of windowPosition) + 81) as integer
                            click at {clickX, clickY}
                            delay 0.15
                            set targetElement to focused UI element
                            set targetRole to role of targetElement as text

                            if targetRole is "AXTextField" or targetRole is "AXComboBox" or targetRole is "AXSearchField" or targetRole is "AXWebTextField" then
                                set targetSize to size of targetElement
                                set targetPosition to position of targetElement

                                if (item 1 of targetSize) > 240 and (item 2 of targetPosition) < ((item 2 of windowPosition) + 220) then
                                    set addressFocused to true
                                end if
                            end if
                        end if
                    end try
                end if

                if addressFocused then
                    keystroke "a" using {command down}
                    keystroke "v" using {command down}
                    key code 36

                    return "OPENED"
                end if

                delay 0.25
            end repeat
        end tell
    end tell

    error "Preview address bar could not be safely focused" number 1001
end run
`;

function cancelPreviewProcess() {
    if (!previewProcess) {
        return;
    }

    try {
        previewProcess.terminate();
    } catch (_) {}

    previewProcess = null;
}

function triggerAutomaticPreview(
    name,
    stillCurrent
) {
    if (!stillCurrent()) {
        return;
    }

    cancelPreviewProcess();

    let child;

    try {
        child = new Process(
            '/usr/bin/osascript',
            {
                args: [
                    '-e',
                    PREVIEW_APPLESCRIPT
                ],
                stdio: 'pipe'
            }
        );

        previewProcess = child;

        let output = '';
        let errors = '';

        child.onStdout(chunk => {
            output += String(chunk);
        });

        child.onStderr(chunk => {
            errors += String(chunk);
        });

        child.onDidExit(code => {
            if (previewProcess !== child) {
                return;
            }

            previewProcess = null;

            if (!stillCurrent()) {
                return;
            }

            if (
                code === 0 &&
                output.includes('OPENED')
            ) {
                return;
            }

            const denied = (
                /not allowed|not authorized|accessibility|assistive access|1743|1719/i
            ).test(errors);

            showManualPreviewInstructions(
                name,
                denied
                    ? 'macOS automation permission denied'
                    : 'Preview address field was not safely accessible'
            );
        });

        child.start();

    } catch (_) {
        if (previewProcess === child) {
            previewProcess = null;
        }

        showManualPreviewInstructions(
            name,
            'automatic Preview process could not start'
        );
    }
}

function openInPreview(name, url, stillCurrent) {
    if (!validLocalURL(url)) {
        nova.workspace.showErrorMessage(
            name + ' returned an invalid authenticated local URL.'
        );
        return;
    }

    nova.workspace.showActionPanel(
        name +
        ' is ready. Choose where to open it. ' +
        'The URL is private and local.',
        {
            buttons: [
                'Open in Browser',
                'Open in Nova Preview',
                'Cancel'
            ]
        },
        choice => {
            if (!stillCurrent()) {
                return;
            }

            if (choice === 0) {
                nova.openURL(url, success => {
                    if (!success && stillCurrent()) {
                        nova.workspace.showErrorMessage(
                            name +
                            ': The default browser could not open the notebook.'
                        );
                    }
                });

            } else if (choice === 1) {
                copyPrivateURL(url).then(
                    () => {
                        if (!stillCurrent()) {
                            return;
                        }

                        if (autoPreviewEnabled()) {
                            triggerAutomaticPreview(
                                name,
                                stillCurrent
                            );
                        } else {
                            showManualPreviewInstructions(
                                name,
                                'automatic Preview navigation disabled'
                            );
                        }
                    },
                    () => {
                        if (stillCurrent()) {
                            nova.workspace.showErrorMessage(
                                name +
                                ': The private URL could not be copied.'
                            );
                        }
                    }
                );
            }
        }
    );
}

function stopStudio() {
    if (studioProcess) {
        try {
            studioProcess.terminate();
        } catch (_) {}
    }

    studioProcess = null;
    studioURL = null;
    studioNotebook = null;
    studioReady = false;
    studioOutput = '';
}

function launchStudio(path) {
    if (!project()) {
        nova.workspace.showErrorMessage(
            'Open a local Nova project first.'
        );
        return;
    }

    if (!notebookInProject(path)) {
        nova.workspace.showErrorMessage(
            'Select an .ipynb file in this project.'
        );
        return;
    }

    if (
        studioReady &&
        studioProcess &&
        studioNotebook === path &&
        studioURL
    ) {
        const session = studioProcess;

        openInPreview(
            'Jupyter Notebook Studio',
            studioURL,
            () => studioProcess === session
        );

        return;
    }

    stopStudio();

    lastNotebookPath = path;
    studioNotebook = path;

    const args = [
        extensionScript('server.py'),
        '--root',
        project(),
        '--notebook',
        path
    ];

    if (kernel()) {
        args.push(
            '--kernel',
            kernel()
        );
    }

    let child;

    try {
        child = new Process(
            '/usr/bin/env',
            {
                args: [
                    python(),
                    ...args
                ],
                cwd: project(),
                stdio: 'pipe'
            }
        );

        studioProcess = child;

        child.onStdout(chunk => {
            if (studioProcess !== child) {
                return;
            }

            studioOutput += String(chunk);

            if (studioOutput.length > 16000) {
                studioOutput = studioOutput.slice(-16000);
            }

            for (;;) {
                const index =
                    studioOutput.indexOf('\n');

                if (index < 0) {
                    break;
                }

                const line = studioOutput
                    .slice(0, index)
                    .trim();

                studioOutput =
                    studioOutput.slice(index + 1);

                if (line.startsWith('READY ')) {
                    if (studioReady) {
                        continue;
                    }

                    const url =
                        line.slice(6).trim();

                    if (!validStudioURL(url)) {
                        nova.workspace.showErrorMessage(
                            'Notebook Studio returned ' +
                            'an invalid local URL.'
                        );
                        return;
                    }

                    studioURL = url;
                    studioReady = true;

                    openInPreview(
                        'Jupyter Notebook Studio',
                        url,
                        () => studioProcess === child
                    );

                } else if (line.startsWith('ERROR ')) {
                    nova.workspace.showErrorMessage(
                        'Notebook Studio: ' +
                        line.slice(6)
                    );
                }
            }
        });

        child.onStderr(chunk => {
            if (
                studioProcess !== child ||
                studioReady
            ) {
                return;
            }

            const message = String(chunk);

            if (/No module named/i.test(message)) {
                nova.workspace.showErrorMessage(
                    'Notebook Studio requires jupyter_client ' +
                    'and ipykernel in the configured Python environment.'
                );
            }
        });

        child.onDidExit(() => {
            if (studioProcess !== child) {
                return;
            }

            const wasReady = studioReady;

            studioProcess = null;
            studioURL = null;
            studioReady = false;

            if (!wasReady) {
                nova.workspace.showErrorMessage(
                    'Notebook Studio stopped before startup. ' +
                    'Check the configured Python environment.'
                );
            }
        });

        child.start();

    } catch (error) {
        studioProcess = null;
        studioReady = false;

        nova.workspace.showErrorMessage(
            'Could not start Notebook Studio: ' +
            String(error)
        );
    }
}

function openStudio() {
    if (!project()) {
        nova.workspace.showErrorMessage(
            'Open a local project folder first.'
        );
        return;
    }

    selectNotebook(launchStudio);
}

function createNotebook() {
    if (!project()) {
        nova.workspace.showErrorMessage(
            'Open a local project folder first.'
        );
        return;
    }

    nova.workspace.showInputPalette(
        'New notebook filename relative to this project',
        {
            placeholder: 'Jupyter/NewNotebook.ipynb',
            value: 'Jupyter/NewNotebook.ipynb'
        },
        name => {
            if (!name) {
                return;
            }

            if (
                !/^[\w\-./ ]+\.ipynb$/i.test(name) ||
                name.startsWith('/') ||
                name.split('/').includes('..')
            ) {
                nova.workspace.showErrorMessage(
                    'Choose a safe relative .ipynb filename.'
                );
                return;
            }

            launchStudio(
                nova.path.join(
                    project(),
                    name
                )
            );
        }
    );
}

function labNotebookURL(path) {
    if (
        !notebookInProject(path) ||
        !labPort ||
        !labToken
    ) {
        throw new Error(
            'JupyterLab notebook URL is unavailable.'
        );
    }

    const relative =
        nova.workspace.relativizePath(path);

    const pieces = relative.split('/');

    if (
        !pieces.length ||
        pieces.some(piece =>
            !piece ||
            piece === '.' ||
            piece === '..'
        )
    ) {
        throw new Error(
            'Invalid notebook path.'
        );
    }

    const encoded = pieces
        .map(piece => encodeURIComponent(piece))
        .join('/');

    const url =
        'http://127.0.0.1:' +
        String(labPort) +
        '/lab/tree/' +
        encoded +
        '?token=' +
        labToken;

    if (!validLabURL(url)) {
        throw new Error(
            'Invalid authenticated JupyterLab URL.'
        );
    }

    return url;
}

function handleLabOutput(
    child,
    chunk
) {
    if (labProcess !== child) {
        return;
    }

    const text = String(chunk);

    labOutput += text;

    if (labOutput.length > 32000) {
        labOutput = labOutput.slice(-32000);
    }

    const cleaned = labOutput.replace(
        /\x1b\[[0-9;]*m/g,
        ''
    );

    if (
        /No module named ['"]?jupyterlab|ModuleNotFoundError.*jupyterlab/i
            .test(cleaned)
    ) {
        labStartupError = (
            'JupyterLab is not installed in the Python ' +
            'environment selected in Nova Jupyter Bridge. ' +
            'Select the existing Python environment ' +
            'that contains JupyterLab.'
        );
    }

    if (labReady) {
        return;
    }

    const matches = cleaned.matchAll(
        /http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})\/lab\/?\?token=([A-Za-z0-9._~%-]+)/g
    );

    for (const match of matches) {
        const port = Number(match[1]);

        if (
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65535
        ) {
            continue;
        }

        const token = match[2];

        if (!token) {
            continue;
        }

        labPort = port;
        labToken = token;
        labReady = true;

        if (labStartupTimer) {
            clearTimeout(labStartupTimer);
            labStartupTimer = null;
        }

        try {
            labURL = labNotebookURL(
                labNotebook
            );
        } catch (error) {
            labReady = false;

            nova.workspace.showErrorMessage(
                'JupyterLab: ' +
                error.message
            );
            return;
        }

        openInPreview(
            'JupyterLab',
            labURL,
            () => labProcess === child
        );

        return;
    }
}

function stopLab() {
    if (labProcess) {
        try {
            labProcess.terminate();
        } catch (_) {}
    }

    labProcess = null;
    labReady = false;
    labURL = null;
    labNotebook = null;
    labPort = null;
    labToken = null;
    labOutput = '';
    labStartupError = '';

    if (labStartupTimer) {
        clearTimeout(labStartupTimer);
        labStartupTimer = null;
    }
}

function launchLab(path) {
    if (!project()) {
        nova.workspace.showErrorMessage(
            'Open a local Nova project first.'
        );
        return;
    }

    if (!notebookInProject(path)) {
        nova.workspace.showErrorMessage(
            'Select an .ipynb file inside this project.'
        );
        return;
    }

    lastNotebookPath = path;
    labNotebook = path;

    if (
        labProcess &&
        labReady &&
        labPort &&
        labToken
    ) {
        try {
            labURL = labNotebookURL(path);

            const session = labProcess;

            openInPreview(
                'JupyterLab',
                labURL,
                () => labProcess === session
            );
        } catch (error) {
            nova.workspace.showErrorMessage(
                'JupyterLab: ' +
                error.message
            );
        }

        return;
    }

    if (labProcess && !labReady) {
        return;
    }

    stopLab();

    labNotebook = path;

    // Choose a real loopback port and generate a fresh token.
    // The token is not included in the OS process arguments.
    const bootstrap = [
        'import secrets, socket, sys',
        'from jupyterlab.labapp import main',
        'with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:',
        '    sock.bind(("127.0.0.1", 0))',
        '    port = sock.getsockname()[1]',
        'token = secrets.token_urlsafe(32)',
        'sys.argv = [',
        '    "jupyter-lab",',
        '    "--no-browser",',
        '    "--ServerApp.ip=127.0.0.1",',
        '    "--ServerApp.port=" + str(port),',
        '    "--ServerApp.port_retries=20",',
        '    "--ServerApp.open_browser=False",',
        '    "--ServerApp.allow_remote_access=False",',
        '    "--IdentityProvider.token=" + token,',
        '    "--ServerApp.root_dir=" + sys.argv[1],',
        ']',
        'raise SystemExit(main())'
    ].join('\n');

    const args = [
        python(),
        '-u',
        '-c',
        bootstrap,
        project()
    ];

    let child;

    try {
        child = new Process(
            '/usr/bin/env',
            {
                args,
                cwd: project(),
                stdio: 'pipe'
            }
        );

        labProcess = child;

        child.onStdout(chunk => {
            handleLabOutput(
                child,
                chunk
            );
        });

        child.onStderr(chunk => {
            handleLabOutput(
                child,
                chunk
            );
        });

        child.onDidExit(code => {
            if (labProcess !== child) {
                return;
            }

            const wasReady = labReady;
            const startupError = labStartupError;

            stopLab();

            if (!wasReady) {
                nova.workspace.showErrorMessage(
                    startupError ||
                    (
                        'JupyterLab exited before it became ready ' +
                        '(exit code ' +
                        String(code) +
                        '). Check that JupyterLab is available ' +
                        'in the configured Python environment.'
                    )
                );
            }
        });

        child.start();

        labStartupTimer = setTimeout(() => {
            if (labProcess === child && !labReady) {
                labStartupError =
                    'JupyterLab did not report an authenticated local URL. ' +
                    'Check that the configured Python has JupyterLab installed.';

                try {
                    child.terminate();
                } catch (_) {}
            }
        }, 30000);

    } catch (error) {
        stopLab();

        nova.workspace.showErrorMessage(
            'Could not launch JupyterLab: ' +
            String(error)
        );
    }
}

function openLab() {
    if (!project()) {
        nova.workspace.showErrorMessage(
            'Open a local project folder first.'
        );
        return;
    }

    selectNotebook(launchLab);
}

function copyStudioURL() {
    if (!studioURL) {
        nova.workspace.showInformativeMessage(
            'Open Jupyter Notebook Studio first.'
        );
        return;
    }

    copyPrivateURL(studioURL).then(
        () => {
            nova.workspace.showInformativeMessage(
                'Notebook Studio URL copied. ' +
                'Paste it into Nova Preview.'
            );
        },
        () => {
            nova.workspace.showErrorMessage(
                'Unable to copy Notebook Studio URL.'
            );
        }
    );
}

function copyLabURL() {
    if (!labURL) {
        nova.workspace.showInformativeMessage(
            'Open JupyterLab first.'
        );
        return;
    }

    copyPrivateURL(labURL).then(
        () => {
            nova.workspace.showInformativeMessage(
                'JupyterLab URL copied. ' +
                'Paste it into Nova Preview.'
            );
        },
        () => {
            nova.workspace.showErrorMessage(
                'Unable to copy JupyterLab URL.'
            );
        }
    );
}

class JupyterBridgeTaskAssistant {
    provideTasks() {
        const studio = new Task(
            'Jupyter Notebook Studio'
        );

        studio.setAction(
            Task.Run,
            new TaskCommandAction(
                STUDIO_COMMAND
            )
        );

        studio.setAction(
            Task.Build,
            new TaskCommandAction(
                STUDIO_COMMAND
            )
        );

        studio.buildBeforeRunning = false;

        const lab = new Task(
            'JupyterLab'
        );

        lab.setAction(
            Task.Run,
            new TaskCommandAction(
                LAB_COMMAND
            )
        );

        lab.setAction(
            Task.Build,
            new TaskCommandAction(
                LAB_COMMAND
            )
        );

        lab.buildBeforeRunning = false;

        return [
            studio,
            lab
        ];
    }
}

exports.activate = function () {
    nova.commands.register(
        STUDIO_COMMAND,
        openStudio
    );

    nova.commands.register(
        'jupyterbridge.newStudio',
        createNotebook
    );

    nova.commands.register(
        'jupyterbridge.copyStudio',
        copyStudioURL
    );

    nova.commands.register(
        'jupyterbridge.stopStudio',
        () => {
            stopStudio();

            nova.workspace.showInformativeMessage(
                'Notebook Studio stopped. ' +
                'Its Python kernel was shut down.'
            );
        }
    );

    nova.commands.register(
        LAB_COMMAND,
        openLab
    );

    nova.commands.register(
        'jupyterbridge.copyLab',
        copyLabURL
    );

    nova.commands.register(
        'jupyterbridge.stopLab',
        () => {
            stopLab();

            nova.workspace.showInformativeMessage(
                'JupyterLab stopped.'
            );
        }
    );

    nova.commands.register(
        'jupyterbridge.settings',
        () => nova.workspace.openConfig()
    );

    taskAssistantDisposable =
        nova.assistants.registerTaskAssistant(
            new JupyterBridgeTaskAssistant(),
            {
                identifier: TASK_IDENTIFIER,
                name: 'Nova Jupyter Bridge'
            }
        );

    nova.workspace.reloadTasks(
        TASK_IDENTIFIER
    );
};

exports.deactivate = function () {
    cancelPreviewProcess();

    stopStudio();
    stopLab();

    if (taskAssistantDisposable) {
        taskAssistantDisposable.dispose();
        taskAssistantDisposable = null;
    }
};