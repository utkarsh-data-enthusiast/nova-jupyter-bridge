# Changelog

All notable changes to **Nova Jupyter Bridge** are documented in this file.

Nova Jupyter Bridge is developed by **PatriotEver Lab** and distributed under the MIT License.

This changelog follows the principles of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

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

## [2.2.0] - 2026-10-16

### Added

#### Two Independent Jupyter Interfaces

- Added **Jupyter Notebook Studio** as a Nova task.
- Added **JupyterLab** as a separate Nova task.
- Added Run and Build actions for both tasks.
- Added commands for opening and stopping JupyterLab.
- Added a command for copying the JupyterLab Preview URL.
- Added support for launching JupyterLab using the configured Python executable.
- Added support for opening a selected `.ipynb` notebook in JupyterLab.

#### Debugger Improvements

- Added backend tracking of the debugger's current execution location.
- Added execution-line information to the Notebook Studio state API.
- Added frontend support for highlighting the currently paused Python statement.
- Added separate visual elements for breakpoint markers and line numbers.
- Added source mapping for debugging notebook cells.
- Added breakpoint verification status reporting.
- Added debugger state and pause revision tracking.

#### Debugger Controls

- Added or refined support for:
  - Continue
  - Pause
  - Step Over
  - Step Into
  - Step Out
  - Stop

- Updated the floating debugger toolbar's state handling.
- Improved debugger button availability based on execution state.
- Added backend support for stopping debugging through a dedicated endpoint.

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

- Corrected AppleScript comment syntax in the automatic Preview navigation script.
- Updated frontend and backend communication for debugger location tracking.
- Updated breakpoint marker rendering to avoid replacing line-number text.
- Updated the Clear Outputs workflow to persist changes in the notebook file.

### Known Limitations

- Advanced cross-cell debugging requires further testing.
- Execution-line highlighting may require additional refinements.
- Automatic Nova Preview navigation depends on macOS permissions and Nova's interface.
- JupyterLab debugging requires a compatible kernel.
- Notebook Studio and JupyterLab do not automatically share live kernel sessions.
- Some debugger recovery scenarios may require further improvements.

**Release status:** Functionality has been implemented for this version, but not every feature has undergone comprehensive end-to-end testing.

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

Version 2.1.0 served as the development baseline for the improvements introduced in version 2.2.0.

A complete historical change-by-change record for this earlier development version is not available.

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

---

[Unreleased]: https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/utkarsh-data-enthusiast/nova-jupyter-bridge/releases/tag/v2.2.0