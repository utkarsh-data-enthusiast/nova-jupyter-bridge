# Nova Jupyter Bridge

**Privacy-focused Jupyter notebook integration for Panic Nova.**

Developed by **PatriotEver Lab**.

Nova Jupyter Bridge brings interactive Jupyter notebooks into Nova through two independent interfaces:

- **Jupyter Notebook Studio** — a custom notebook interface with Python execution, debugging, and local MySQL SQL cells.
- **JupyterLab** — the official JupyterLab interface, launched directly from Nova.

Both interfaces can be opened in your default web browser or through Nova Preview.

**Version:** 2.3.0  
**License:** MIT  
**Platform:** macOS  
**Editor:** Panic Nova

---

## Features

### Jupyter Notebook Studio

Notebook Studio provides a local, interactive interface for working with `.ipynb` notebooks.

#### Python execution

- Individual Python code-cell execution
- Run All Cells
- Cell output display
- Notebook saving
- Kernel selection
- Kernel interruption
- Kernel restart
- Standard Jupyter notebook support

#### Python debugging

- Individual code-cell debugging
- Breakpoint creation
- Breakpoint verification
- Execution-line highlighting
- Floating debugger toolbar
- Variable inspection
- Breakpoint-management controls
- Continue execution
- Pause
- Step Over
- Step Into
- Step Out
- Stop debugging

Python debugging requires a compatible Jupyter kernel.

Some advanced debugging scenarios, particularly cross-cell debugging and source mapping, require further testing.

#### Notebook interface

- Python code cells
- SQL cells
- Markdown cells
- Raw cells
- Add cells above or below existing cells
- Move cells
- Delete cells
- Notebook sidebar
- Debugger sidebar
- Floating debugger controls
- Clear Outputs
- Save notebooks as `.ipynb` files

### Local MySQL SQL Integration

Version 2.3.0 adds SQL execution inside Notebook Studio.

Features include:

- SQL cells alongside Python cells
- SQL cell insertion controls
- Local MySQL query execution
- SQL results displayed in the notebook interface
- SQL execution cancellation
- Integration with an existing MySQL installation
- Use of MySQL client login-path configuration

The SQL executor uses the local MySQL command-line client.

The current implementation is configured around the MySQL client at:

```text
/usr/local/mysql/bin/mysql
```

The executor uses a MySQL login path named:

```text
nova
```

Users may need to adjust the local MySQL configuration or source code for their own installations.

**Important:** SQL execution is not equivalent to a full MySQL debugger.

The extension does not currently provide complete SQL statement-level debugging with breakpoints, step-through execution, and stored-routine variable inspection.

The SQL backend requires additional testing across different MySQL installations and configurations.

---

## Official JupyterLab

Nova Jupyter Bridge also supports the official JupyterLab interface.

Features include:

- Launching JupyterLab directly from Nova
- Opening existing `.ipynb` notebooks
- Native JupyterLab notebook editing
- Native JupyterLab execution
- JupyterLab debugging with compatible kernels
- Rich notebook outputs
- Notebook file management
- Browser and Nova Preview opening options

JupyterLab must already be installed in the configured Python environment.

The extension does not automatically install it.

**Note:** Notebook Studio's custom floating debugger toolbar is separate from JupyterLab's native debugging interface.

---

## Open in Browser or Nova Preview

Version 2.3.0 introduces an opening dialog for both Notebook Studio and JupyterLab.

When an interface is ready, choose:

### Open in Browser

Opens the authenticated notebook in your default web browser.

If Safari is configured as your default browser, the notebook opens in Safari.

### Open in Nova Preview

Attempts to open the notebook inside Nova Preview.

If automatic Preview navigation is unavailable, the extension copies the authenticated local URL and provides manual instructions.

### Cancel

Dismisses the opening dialog without shutting down the notebook server.

### Automatic Preview navigation

Automatic navigation uses optional macOS System Events and Accessibility automation.

Depending on your macOS permissions and Nova version, automatic navigation may not succeed.

You can still open the notebook by pasting the copied URL into Nova Preview.

---

## Nova Task Integration

The extension provides two independent Nova tasks:

1. **Jupyter Notebook Studio**
2. **JupyterLab**

Both tasks support Nova's Run and Build actions.

A separate build step is not required before launching a notebook.

The extension also provides commands through Nova's Extensions menu.

---

## Privacy and Security

Nova Jupyter Bridge is designed for local development and minimal data collection.

The extension:

- Contains no advertising SDK
- Contains no analytics integration
- Contains no intentional telemetry
- Requires no extension-specific online account
- Runs its managed notebook servers locally
- Restricts managed notebook servers to `127.0.0.1`
- Uses authentication for local notebook access
- Does not automatically upload notebook contents to an extension-operated service
- Does not automatically install Python packages
- Does not automatically create Python environments
- Does not embed MySQL passwords in its source code
- Is distributed under the MIT License

### Authentication

Notebook Studio and JupyterLab use authenticated local URLs.

These URLs must be treated as sensitive because anyone who obtains a valid URL may be able to access the corresponding local notebook server.

The extension may copy an authenticated URL to the macOS clipboard for opening in Nova Preview.

Avoid sharing authentication tokens, private notebook URLs, passwords, or confidential notebook contents.

### Security limitations

This extension has not undergone an independent third-party security audit.

Python code and SQL queries execute with the privileges available to their respective local environments and database accounts.

Additional Jupyter packages, kernels, and extensions may introduce their own security or network behavior.

---

## Requirements

- macOS
- Panic Nova
- An existing Python installation
- `jupyter_client`
- `ipykernel`
- JupyterLab for the official JupyterLab interface
- A compatible debugging kernel for Python debugging

For SQL functionality:

- MySQL Server
- MySQL command-line client
- A configured MySQL login path
- Appropriate database permissions

Dependencies must be installed separately.

Nova Jupyter Bridge does not automatically install packages or create environments.

---

## Installation

### Nova Extension Library

Once the extension is accepted into Nova's Extension Library:

1. Open Nova.
2. Open the Extension Library.
3. Search for **Nova Jupyter Bridge**.
4. Install the extension.
5. Open your coding project.
6. Configure the Python executable if necessary.

### Manual installation

The source code is available on GitHub:

https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge

Download the extension bundle and install it through Nova.

### Development installation

To test the source directly:

1. Open the `.novaextension` development project in Nova.
2. Select **Extensions → Activate Project as Extension**.
3. Open your coding project.
4. Select the Notebook Studio or JupyterLab task.

---

## Configuration

Open your project's Nova extension settings and select **Nova Jupyter Bridge**.

### Python executable

Configuration key:

```text
jupyterbridge.python
```

Specify an existing Python executable containing the required Jupyter packages.

Example:

```text
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14
```

This path is an example and may differ between installations.

The configured Python executable launches both Notebook Studio and JupyterLab.

The notebook's execution kernel can use another registered Python environment.

For example, a JupyterLab server may run under one Python installation while a notebook kernel uses Python 3.12 for compatible machine-learning packages.

### Notebook Studio kernel override

Configuration key:

```text
jupyterbridge.kernelOverride
```

Optionally specify an installed Jupyter kernel.

Leave this setting empty to use the notebook's configured kernel.

### Automatic Nova Preview navigation

Configuration key:

```text
jupyterbridge.autoPreview
```

When enabled, the extension attempts automatic navigation after you select **Open in Nova Preview**.

When disabled, you can still open the notebook manually using the authenticated URL.

---

## Usage

### Open Notebook Studio

1. Open a Nova project.
2. Open or select an `.ipynb` notebook.
3. Select the **Jupyter Notebook Studio** task.
4. Click Run.
5. Choose **Open in Browser** or **Open in Nova Preview**.

### Run Python code

Each Python code cell has a Run button.

Click Run to execute the selected cell.

Use Run All to execute the notebook's code cells.

### Debug Python code

1. Open Notebook Studio.
2. Select a Python code cell.
3. Set a breakpoint beside the required line.
4. Click the cell's Debug button.
5. Use the floating debugger toolbar.

Available debugging operations include Continue, Pause, Step Over, Step Into, Step Out, and Stop.

The exact debugging capabilities depend on the selected kernel.

### Execute SQL

1. Open Notebook Studio.
2. Add an SQL cell.
3. Enter a MySQL query.
4. Run the SQL cell.
5. Inspect the returned output.

SQL execution requires a working MySQL client and login-path configuration.

### Open JupyterLab

1. Open a Nova project.
2. Open or select an `.ipynb` notebook.
3. Select the **JupyterLab** task.
4. Click Run.
5. Choose the desired opening option.

Notebook Studio and JupyterLab can access the same notebook files, but they do not automatically share live kernel sessions.

Avoid simultaneously editing the same notebook in both interfaces without coordinating saves and reloads.

---

## Project Structure

```text
nova-jupyter-bridge.novaextension/
│
├── Assets/
│   ├── app.css
│   ├── app.js
│   └── index.html
│
├── Scripts/
│   ├── main.js
│   ├── mysql_executor.py
│   ├── server.py
│   └── server_core.py
│
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── README.md
├── extension.json
├── extension.png
└── extension@2x.png
```

### Source components

**`Scripts/main.js`**

Registers Nova commands and tasks, launches the notebook interfaces, manages local JupyterLab processes, and provides browser/Preview opening options.

**`Scripts/server.py`**

Provides the Notebook Studio server entry point and integration with additional backend functionality.

**`Scripts/server_core.py`**

Contains the core Notebook Studio server implementation.

**`Scripts/mysql_executor.py`**

Provides local MySQL execution support.

**`Assets/app.js`**

Implements the interactive Notebook Studio frontend.

**`Assets/app.css`**

Defines Notebook Studio styling.

**`Assets/index.html`**

Defines the Notebook Studio HTML entry point.

---

## Known Limitations

- Automatic Nova Preview navigation is dependent on macOS permissions and Nova's interface.
- Advanced Python debugging requires additional testing.
- SQL execution is not a complete SQL debugger.
- MySQL client configuration may require manual setup.
- Notebook Studio and JupyterLab do not share live kernel sessions automatically.
- External Jupyter servers are not supported by the current launcher.
- The extension does not automatically install dependencies.
- Some SQL and debugger workflows require further end-to-end testing.

---

## Roadmap

Potential future improvements include:

- Improved cross-cell Python debugging
- More reliable debugger state management
- Improved execution-line tracking
- Expanded SQL functionality
- Improved kernel recovery
- Additional automated tests
- Improved accessibility
- Further privacy and security hardening

Roadmap items are not guaranteed features.

---

## Development and Contributions

Contributions, bug reports, and suggestions are welcome.

**Repository:**

https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge

**Bug reports:**

https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge/issues

When reporting a bug, include the relevant Nova, macOS, Python, and JupyterLab versions, along with steps to reproduce.

Do not include passwords, authentication tokens, private notebook URLs, or confidential notebook contents.

---

## License

Nova Jupyter Bridge is distributed under the **MIT License**.

Copyright (c) 2026 PatriotEver Lab.

See [LICENSE](LICENSE) for the complete license.

---

## Author

**PatriotEver Lab**

GitHub:

https://github.com/utkarsh-data-enthusiast

---

**Nova Jupyter Bridge — Open Source. Local Development. Privacy by Design.**