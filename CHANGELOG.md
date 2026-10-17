# Changelog

All notable changes to **Nova Jupyter Bridge** are documented here.

Nova Jupyter Bridge is developed by **PatriotEver Lab** and
distributed under the MIT License.

This changelog follows the principles of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Planned

- Improve debugger reliability across different Jupyter kernels.
- Refine execution-line highlighting during step-by-step debugging.
- Improve debugging of functions defined in other notebook cells.
- Improve breakpoint verification and source mapping.
- Improve kernel interruption, recovery, and restart behavior.
- Expand automated testing.
- Improve accessibility and keyboard navigation.
- Continue privacy and security reviews.

Planned features are subject to change.

---

## [2.3.0] - 2026-10-17

### Added

#### SQL Integration

- Added SQL cell support to Nova Notebook Studio.
- Added controls for inserting SQL cells above and below existing cells.
- Added SQL cell creation from the notebook interface.
- Added a local MySQL execution backend.
- Added SQL query execution using the existing MySQL command-line client.
- Added SQL output display inside Notebook Studio.
- Added support for cancelling SQL execution.
- Added support for using an existing MySQL login-path configuration.
- Preserved the ability to work with Python and SQL cells in the
  same notebook interface.

#### JupyterLab Improvements

- Improved launching of official JupyterLab from Nova.
- Improved selection and opening of existing Jupyter notebooks.
- Improved handling of local JupyterLab server ports.
- Improved detection of authenticated JupyterLab startup URLs.
- Preserved separate JupyterLab and Notebook Studio tasks.
- Preserved support for Nova Run and Build actions.

#### Browser and Preview Options

- Added an opening dialog for Notebook Studio and JupyterLab.
- Added an **Open in Browser** option.
- Added an **Open in Nova Preview** option.
- Added a **Cancel** option that leaves the server running.
- Added support for opening authenticated notebook URLs using
  the system's default browser.
- Preserved automatic Nova Preview navigation when supported.
- Preserved manual Preview navigation using copied local URLs.
- Improved fallback messages when automatic Preview navigation fails.

#### Debugger Interface

- Expanded Notebook Studio debugger controls.
- Added or refined controls for inspecting variables.
- Added or refined breakpoint-management controls.
- Added additional kernel-management controls.
- Preserved the floating debugger toolbar.
- Preserved Python breakpoint and step-through debugging support.
- Preserved per-cell Run and Debug actions.

### Changed

#### Notebook Studio

- Updated the notebook interface to accommodate SQL cells.
- Updated cell controls for Python and SQL workflows.
- Improved communication between the notebook frontend and
  local execution services.
- Preserved standard Jupyter notebook compatibility.

#### Extension Architecture

- Updated `Scripts/main.js` for JupyterLab startup and opening options.
- Separated the original notebook server implementation into
  `Scripts/server_core.py`.
- Updated `Scripts/server.py` to integrate additional server functionality.
- Added `Scripts/mysql_executor.py` for local MySQL execution.
- Updated `Assets/app.js` for SQL integration and interface improvements.
- Added `.gitignore` to exclude local configuration and temporary files.

#### Privacy and Security

- Preserved local-only notebook server operation.
- Preserved authenticated notebook access.
- Preserved loopback binding to `127.0.0.1`.
- Continued using existing Python installations.
- Avoided automatic creation of Python environments.
- Avoided storing MySQL passwords in the extension source.
- Preserved the no-telemetry design.
- Preserved the MIT License.

### Fixed

- Addressed JupyterLab startup issues associated with port selection.
- Improved handling of authenticated JupyterLab URLs.
- Restored missing extension launcher functions.
- Improved browser and Preview opening workflows.
- Improved handling of automatic Preview navigation failures.

### Known Limitations

- Automatic Nova Preview navigation depends on macOS permissions
  and Nova's interface.
- SQL execution does not provide a complete MySQL statement-level
  debugger with breakpoints and variable inspection.
- Python debugging requires a compatible Jupyter kernel.
- Notebook Studio and JupyterLab do not automatically share
  the same live kernel session.
- Some advanced cross-cell debugging scenarios require further testing.
- SQL execution and cancellation require further testing across
  different MySQL versions and configurations.

### Release Notes

Version 2.3.0 expands Nova Jupyter Bridge with local SQL execution,
additional notebook controls, and improved JupyterLab integration.

Users can choose to open Notebook Studio or JupyterLab in their
default browser or inside Nova Preview.

The extension remains open source, privacy-focused, and free
of advertising and telemetry.

---

## [2.2.0] - 2026-10-16

### Added

#### Two Independent Jupyter Interfaces

- Added **Jupyter Notebook Studio** as a Nova task.
- Added **JupyterLab** as a separate Nova task.
- Added Run and Build actions for both tasks.
- Added commands for opening and stopping JupyterLab.
- Added a command for copying the JupyterLab Preview URL.
- Added support for launching JupyterLab using the configured
  Python executable.
- Added support for opening a selected `.ipynb` notebook in JupyterLab.

#### Debugger Improvements

- Added backend tracking of the debugger's current execution location.
- Added execution-line information to the Notebook Studio state API.
- Added frontend support for highlighting the currently paused
  Python statement.
- Added separate visual elements for breakpoint markers and line numbers.
- Added source mapping for debugging notebook cells.
- Added breakpoint verification status reporting.
- Added debugger state and pause revision tracking.

#### Debugger Controls

Added or refined support for:

- Continue
- Pause
- Step Over
- Step Into
- Step Out
- Stop

Additional improvements:

- Updated the floating debugger toolbar's state handling.
- Improved debugger button availability based on execution state.
- Added backend support for stopping debugging through a
  dedicated endpoint.

#### Kernel Management

- Updated Python kernel interruption handling.
- Added recovery logic for unresponsive debugging sessions.
- Improved kernel restart handling.
- Added frontend status reporting during kernel recovery.
- Improved handling of execution sessions invalidated by a kernel restart.

#### Notebook Management

- Added persistent clearing of notebook outputs.
- Added execution-count resetting when clearing outputs.
- Improved synchronization between notebook outputs and the frontend.
- Improved sequential execution handling for Run All.
- Improved notebook cell management.
- Preserved standard `.ipynb` notebook compatibility.

### Changed

#### Notebook Studio Interface

- Updated the notebook editor to support execution-line highlighting.
- Updated breakpoint positioning so markers appear beside line numbers.
- Preserved the full-width notebook editor.
- Preserved independently collapsible Notebook and Debugger sidebars.
- Preserved the floating debugger toolbar.
- Improved responsive interface styling.
- Improved accessibility labels for notebook and debugger controls.

#### Nova Integration

- Updated the task assistant to expose both Jupyter interfaces.
- Updated the extension manifest to include JupyterLab commands.
- Updated extension configuration descriptions.
- Preserved optional automatic Nova Preview navigation.
- Preserved manual Preview navigation as a fallback.

#### Privacy and Security

- Preserved local-only server binding to `127.0.0.1`.
- Preserved authentication for notebook interfaces.
- Preserved the existing no-telemetry design.
- Continued using the user's configured Python environment.
- Avoided automatic dependency installation.
- Preserved the MIT License.

### Fixed

- Corrected AppleScript comment syntax in automatic Preview navigation.
- Updated frontend and backend communication for debugger location tracking.
- Updated breakpoint marker rendering to avoid replacing line-number text.
- Updated the Clear Outputs workflow to persist changes in the notebook file.

### Known Limitations

- Advanced cross-cell debugging requires further testing.
- Execution-line highlighting may require additional refinements.
- Automatic Nova Preview navigation depends on macOS permissions
  and Nova's interface.
- JupyterLab debugging requires a compatible kernel.
- Notebook Studio and JupyterLab do not automatically share
  live kernel sessions.
- Some debugger recovery scenarios may require further improvements.

**Release status:** Not every feature has undergone comprehensive
end-to-end testing.

---

## [2.1.0] - Previous Development Version

### Available Features

The previous Notebook Studio implementation included:

- Local Jupyter notebook execution.
- Individual code-cell Run and Debug buttons.
- Python breakpoint support.
- Kernel selection.
- Kernel interruption and restart.
- Notebook saving.
- Notebook cell management.
- Markdown and raw cells.
- Notebook outline sidebar.
- Debugger sidebar.
- Floating debugger toolbar.
- Local authentication.
- Optional Nova Preview automation.

Version 2.1.0 served as the development baseline for the improvements
introduced in version 2.2.0.

A complete historical change-by-change record for this earlier
development version is not available.

---

## License

Copyright (c) 2026 PatriotEver Lab.

Licensed under the MIT License.

See [LICENSE](LICENSE) for the complete license text.

---

## Repository

**Nova Jupyter Bridge**

https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge

### Bug Reports

https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge/issues