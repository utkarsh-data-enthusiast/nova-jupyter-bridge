# Nova Jupyter Bridge

**A free, open-source Jupyter notebook integration for Panic Nova.**

Developed by **PatriotEver Lab**.

Nova Jupyter Bridge brings interactive Jupyter notebooks into Nova through two independent interfaces:

- **Jupyter Notebook Studio** — a custom notebook editor with Python execution and debugging.
- **JupyterLab** — the official JupyterLab interface, accessible through Nova Preview.

The extension is designed for local development, privacy, and integration with an existing Python environment.

**Version:** 2.2.0  
**License:** MIT  
**Platform:** macOS  
**Editor:** Panic Nova

---

## Features

### Jupyter Notebook Studio

Notebook Studio provides a custom interface for working with `.ipynb` notebooks.

Features include:

- Individual code-cell execution
- Individual code-cell debugging
- Python breakpoints
- Breakpoint verification
- Automatic first-statement breakpoints
- Continue execution
- Pause debugging
- Step Over
- Step Into
- Step Out
- Stop debugging
- Current execution-line highlighting
- Variable inspection
- Floating debugger toolbar
- Kernel selection
- Kernel interruption
- Kernel restart
- Run All Cells
- Clear Outputs
- Notebook saving
- Markdown cells
- Raw cells
- Notebook cell management
- Collapsible notebook sidebar
- Collapsible debugger sidebar
- Full-width notebook editor

Notebook Studio saves notebooks in the standard `.ipynb` format.

**Development status:** Some advanced debugger interactions, including cross-cell source mapping, execution-line highlighting, and recovery from interrupted sessions, may require further refinement.

### Official JupyterLab

Nova Jupyter Bridge can also start the official JupyterLab application.

Features include:

- Official JupyterLab interface
- Native notebook execution
- Native notebook debugging with compatible kernels
- Markdown editing
- Rich notebook outputs
- Variable inspection through supported Jupyter features
- Notebook file management
- Access through Nova Preview

JupyterLab must already be installed in the configured Python environment.

The extension does not download or install JupyterLab automatically.

### Nova Task Integration

The extension adds two tasks to Nova:

1. **Jupyter Notebook Studio**
2. **JupyterLab**

Select the desired task from Nova's task menu and use the Run command.

Both tasks also expose Build actions.

### Privacy and Security

Nova Jupyter Bridge is designed to minimize unnecessary data collection and external dependencies.

The extension:

- Contains no advertising SDK
- Contains no analytics integration
- Contains no intentional telemetry
- Requires no extension-specific online account
- Uses local notebook servers
- Binds its managed notebook servers to `127.0.0.1`
- Uses authentication for local notebook interfaces
- Does not automatically upload notebook contents to a remote service
- Does not automatically install Python packages
- Does not automatically create Python environments

Notebook Studio uses local authentication and HTTP request restrictions.

JupyterLab uses the authentication features provided by Jupyter Server.

**Security note:** The extension has not undergone an independent security audit. Code executed in a notebook has the privileges of the selected Python environment. Installing additional Jupyter extensions or packages may introduce their own dependencies and network behavior.

---

## Requirements

- macOS
- Panic Nova
- Python 3.10 or later recommended
- `jupyter_client`
- `ipykernel`
- JupyterLab, for the official JupyterLab task
- A Python kernel supporting the Jupyter debugger protocol, for debugging features

A modern `ipykernel` installation is recommended.

The Python interpreter used to launch Notebook Studio must have access to the required Jupyter packages.

---

## Installation

### Install from Nova's Extension Library

Once the extension is accepted into Nova's Extension Library:

1. Open Nova.
2. Open the Extension Library.
3. Search for **Nova Jupyter Bridge**.
4. Install the extension.
5. Open your coding project.
6. Configure the Python executable if necessary.

### Install manually

1. Download the extension from GitHub.
2. Locate `Nova Jupyter Bridge.novaextension`.
3. Open the extension bundle with Nova.
4. Follow Nova's installation instructions.
5. Open your coding project.

### Development installation

To test the extension directly from its source:

1. Open `Nova Jupyter Bridge.novaextension` as a project in Nova.
2. Select **Extensions → Activate Project as Extension**.
3. Open your coding project.
4. Select the required Jupyter task.

---

## Configuration

Open your project's Nova extension settings.

### Python executable

Setting:

`jupyterbridge.python`

Specify the Python executable containing your existing Jupyter installation.

Example:

```text
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12
```

This is only an example. Use the actual Python executable installed on your Mac.

The same configured Python executable is used to start Notebook Studio and JupyterLab.

### Kernel override

Setting:

`jupyterbridge.kernelOverride`

Optionally specify an installed Jupyter kernel name.

Leave this setting empty to use the kernel specified by the notebook.

### Automatic Nova Preview

Setting:

`jupyterbridge.autoPreview`

When enabled, Nova Jupyter Bridge attempts to open the selected notebook interface inside Nova Preview.

Automatic Preview navigation uses optional macOS automation.

Depending on your macOS settings, you may need to grant Nova permission to control System Events or use Accessibility features.

If automatic navigation fails, the extension provides a manual fallback using a local URL copied to the clipboard.

**Important:** Automatic Preview navigation is best-effort and may vary between Nova versions.

---

## Usage

### Open Notebook Studio

1. Open a Nova project.
2. Open or select an `.ipynb` notebook.
3. Select the **Jupyter Notebook Studio** task.
4. Click Nova's Run button.
5. Open the notebook in Nova Preview.

### Run Python code

Each code cell provides a **Run** button.

Click Run to execute the selected cell.

Use **Run All** to execute the notebook's code cells sequentially.

### Debug Python code

1. Open Notebook Studio.
2. Select a Python code cell.
3. Click beside a line number to set a breakpoint.
4. Click the cell's **Debug** button.
5. Use the floating debugger controls to navigate execution.

Supported debugger commands include:

| Control | Action |
|---|---|
| ▶ | Continue |
| ⏸ | Pause |
| ↷ | Step Over |
| ↓ | Step Into |
| ↑ | Step Out |
| ■ | Stop |

The debugger requires a compatible Jupyter kernel.

Advanced debugging behavior depends on the kernel's debugger implementation.

### Clear Outputs

Click **Clear Outputs** to remove saved execution results from notebook code cells.

The extension updates the notebook file to preserve the cleared state.

### Restart the kernel

Click **Restart** to restart the selected Python kernel.

Restarting removes in-memory Python variables.

---

## Using JupyterLab

1. Open your Nova project.
2. Open or select an `.ipynb` notebook.
3. Select the **JupyterLab** task.
4. Click Nova's Run button.
5. Open the JupyterLab interface through Nova Preview.

The extension attempts to launch JupyterLab using your configured Python executable.

It does not automatically install missing dependencies.

Notebook Studio and JupyterLab can access the same notebook files, but they do not automatically share live kernel sessions.

Avoid editing the same notebook simultaneously in both interfaces without saving and reloading appropriately.

---

## Project Structure

```text
Nova Jupyter Bridge.novaextension/
│
├── Assets/
│   ├── app.css
│   ├── app.js
│   └── index.html
│
├── Scripts/
│   ├── main.js
│   └── server.py
│
├── extension.json
├── extension.png
├── extension@2x.png
├── LICENSE
├── README.md
└── CHANGELOG.md
```

`CHANGELOG.md` records changes introduced in each release.

---

## Privacy

The extension's source code is publicly available for inspection.

Nova Jupyter Bridge does not intentionally collect or transmit usage analytics, advertising identifiers, or notebook contents to an extension-operated remote service.

The managed notebook interfaces communicate locally.

Users remain responsible for evaluating any additional Python packages, Jupyter kernels, or extensions they install.

---

## Known Limitations

- Automatic Nova Preview navigation may require macOS Automation and Accessibility permissions.
- Notebook debugging requires a compatible kernel.
- Some advanced debugger features may require additional improvements.
- Notebook Studio and JupyterLab do not automatically share kernel sessions.
- External Jupyter servers are not supported by the current task launcher.
- The extension does not provide a native Nova SQL debugger.
- The extension does not automatically install dependencies.

These limitations may be addressed or documented further in subsequent releases.

---

## Development

Contributions, bug reports, and suggestions are welcome.

GitHub repository:

https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge

Bug reports:

https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge/issues

When reporting an issue, include:

- macOS version
- Nova version
- Python version
- JupyterLab version, if relevant
- Steps to reproduce
- Relevant error messages

Do not include authentication tokens, passwords, private notebook contents, or other sensitive information in public bug reports.

---

## Roadmap

Planned improvements may include:

- More reliable debugger state management
- Improved cross-cell debugging
- Better execution-line tracking
- Improved breakpoint behavior
- Better kernel recovery
- Additional Notebook Studio usability improvements
- Expanded automated testing
- Further privacy and security hardening

Roadmap items are not guarantees of future functionality.

---

## License

Nova Jupyter Bridge is licensed under the **MIT License**.

Copyright (c) 2026 PatriotEver Lab.

See [LICENSE](LICENSE) for the complete license text.

---

## Author

**PatriotEver Lab**

GitHub:

https://github.com/utkarsh-data-enthusiast

---

**Nova Jupyter Bridge — Open Source. Local Development. Privacy by Design.**