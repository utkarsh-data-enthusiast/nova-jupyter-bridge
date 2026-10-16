#!/usr/bin/env python3
# Copyright (c) PatriotEver Lab.
# SPDX-License-Identifier: MIT

"""
Nova Jupyter Bridge — Notebook Studio Backend

Local Python/Jupyter notebook execution and debugging.

Features:
- Standard .ipynb notebook loading and saving
- Individual code-cell execution
- Jupyter Debug Adapter Protocol integration
- Breakpoints and stepping
- Paused execution location across notebook cells
- Variable inspection
- Kernel interruption and recovery
- Restart even when debugging is paused
- Persistent Clear Outputs
- Local authentication and restricted HTTP access
- No telemetry or third-party services
"""

from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import hmac
import json
import os
import queue
import secrets
import signal
import threading
import time
import uuid

from contextlib import suppress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


MAX_REQUEST = 32 * 1024 * 1024
ASSETS = Path(__file__).resolve().parent.parent / "Assets"


# ============================================================
# NOTEBOOK UTILITIES
# ============================================================

def notebook_path(root, value):
    root = Path(root).expanduser().resolve()
    path = Path(value).expanduser().resolve()

    if not path.is_relative_to(root):
        raise ValueError(
            "The notebook must be inside the Nova project."
        )

    if path.suffix.lower() != ".ipynb":
        raise ValueError(
            "Select a file with the .ipynb extension."
        )

    return path


def normalize(document):
    if (
        not isinstance(document, dict)
        or not isinstance(document.get("cells"), list)
    ):
        raise ValueError(
            "Invalid notebook: expected a cells array."
        )

    metadata = document.get("metadata", {})

    if not isinstance(metadata, dict):
        raise ValueError("Invalid notebook metadata.")

    document.setdefault("metadata", {})
    document.setdefault("nbformat", 4)
    document.setdefault("nbformat_minor", 5)

    seen_ids = set()

    for cell in document["cells"]:
        if (
            not isinstance(cell, dict)
            or cell.get("cell_type")
            not in ("code", "markdown", "raw")
        ):
            raise ValueError("Invalid notebook cell.")

        cell_id = cell.get("id")

        if (
            not isinstance(cell_id, str)
            or not cell_id
            or cell_id in seen_ids
        ):
            cell_id = uuid.uuid4().hex[:12]

        cell["id"] = cell_id
        seen_ids.add(cell_id)

        if not isinstance(cell.get("metadata", {}), dict):
            raise ValueError("Invalid cell metadata.")

        cell.setdefault("metadata", {})

        source = cell.get("source", "")

        if isinstance(source, list):
            source = "".join(source)

        cell["source"] = str(source)

        if cell["cell_type"] == "code":
            cell.setdefault("outputs", [])
            cell.setdefault("execution_count", None)

    return document


def blank_notebook(kernel_name):
    return normalize({
        "cells": [
            {
                "cell_type": "code",
                "metadata": {},
                "source": "",
                "outputs": [],
                "execution_count": None
            }
        ],
        "metadata": {
            "kernelspec": {
                "name": kernel_name,
                "display_name": kernel_name,
                "language": "python"
            }
        },
        "nbformat": 4,
        "nbformat_minor": 5
    })


def fingerprint(path):
    if not path.exists():
        return None

    return hashlib.sha256(
        path.read_bytes()
    ).hexdigest()


def first_executable_line(code):
    try:
        statements = ast.parse(code).body

        if statements:
            return statements[0].lineno

    except SyntaxError:
        pass

    for number, line in enumerate(
        code.splitlines(),
        start=1
    ):
        text = line.strip()

        if text and not text.startswith("#"):
            return number

    return None


def normalized_source_path(value):
    return os.path.normcase(
        os.path.normpath(value or "")
    )


# ============================================================
# NOTEBOOK STATE
# ============================================================

class NotebookState:

    def __init__(
        self,
        root,
        filename,
        kernel_override=None
    ):
        self.root = Path(root).expanduser().resolve()
        self.path = notebook_path(self.root, filename)

        self.lock = threading.RLock()
        self.kernel_lock = threading.RLock()
        self.debug_lock = threading.Lock()

        self.kernel = None
        self.client = None

        self.generation = 0

        self.recovery_original = None
        self.recovery_warning = None
        self.recovery_notice = None

        # ----------------------------------------------------
        # LOAD NOTEBOOK
        # ----------------------------------------------------

        if self.path.exists():
            original_text = self.path.read_text(
                encoding="utf-8"
            )

            try:
                self.note = normalize(
                    json.loads(original_text)
                )

            except json.JSONDecodeError:
                self.note = blank_notebook(
                    kernel_override or "python3"
                )

                self.note["cells"][0]["source"] = (
                    original_text
                )

                self.recovery_original = (
                    original_text.encode("utf-8")
                )

                self.recovery_warning = (
                    "This .ipynb file contained Python text "
                    "instead of valid notebook JSON. "
                    "Its text has been recovered into a code "
                    "cell. Saving will create a standard "
                    "notebook and retain a backup."
                )

        else:
            self.note = blank_notebook(
                kernel_override or "python3"
            )

        self.file_hash = fingerprint(self.path)

        self.kernel_name = (
            kernel_override
            or self.note["metadata"].get(
                "kernelspec", {}
            ).get("name")
            or "python3"
        )

        # ----------------------------------------------------
        # EXECUTION STATE
        # ----------------------------------------------------

        self.busy = False
        self.running = None
        self.error = None
        self.kernel_ready = False

        self.stop_pending = False

        # ----------------------------------------------------
        # DEBUGGER STATE
        # ----------------------------------------------------

        self.debug_supported = False
        self.debug_active = False
        self.debug_paused = False
        self.debug_starting = False
        self.debug_ever_paused = False

        self.debug_event = {}
        self.debug_location = None
        self.debug_pause_revision = 0

        self.debug_breakpoint_status = []
        self.debug_last_outcome = None

        self.breakpoints = {}

        # Maps debugger source paths to notebook cell IDs.
        self.debug_sources = {}

        # Cache generated debugger source paths.
        self.source_cache = {}

        # Tracks sources with configured breakpoints.
        self.active_breakpoint_paths = set()

        self.debug_seq = 0

        self._variable_cache = None
        self._variable_revision = -1

        self.changed = time.time()

    # ========================================================
    # KERNEL DISCOVERY
    # ========================================================

    def kernelnames(self):
        from jupyter_client.kernelspec import KernelSpecManager

        manager = KernelSpecManager()

        return sorted(
            manager.find_kernel_specs().keys()
        )

    # ========================================================
    # START KERNEL
    # ========================================================

    def ensure_kernel(self):
        with self.kernel_lock:

            with self.lock:
                if self.client is not None:
                    return

                name = self.kernel_name

            from jupyter_client import KernelManager

            manager = KernelManager(
                kernel_name=name
            )

            manager.start_kernel(
                cwd=str(self.root)
            )

            client = manager.client()
            client.start_channels()

            try:
                client.wait_for_ready(timeout=30)

                message_id = client.kernel_info()

                info = {}
                deadline = time.monotonic() + 6

                while time.monotonic() < deadline:
                    message = client.get_shell_msg(
                        timeout=1
                    )

                    if (
                        message.get(
                            "parent_header", {}
                        ).get("msg_id") == message_id
                    ):
                        info = message.get("content", {})
                        break

                supported = bool(
                    info.get("debugger")
                    or "debugger" in info.get(
                        "supported_features", []
                    )
                )

            except Exception:
                with suppress(Exception):
                    client.stop_channels()

                with suppress(Exception):
                    manager.shutdown_kernel(now=True)

                raise

            with self.lock:
                self.kernel = manager
                self.client = client

                self.kernel_ready = True
                self.debug_supported = supported

                self.changed = time.time()

    # ========================================================
    # SHUT DOWN KERNEL
    # ========================================================

    def _drop_kernel(self):
        with self.kernel_lock:

            with self.lock:
                manager = self.kernel
                client = self.client

                self.kernel = None
                self.client = None

                # Invalidate all work belonging to the
                # previous kernel session.
                self.generation += 1

                self.kernel_ready = False
                self.busy = False
                self.running = None
                self.stop_pending = False

                self.debug_supported = False
                self.debug_active = False
                self.debug_paused = False
                self.debug_starting = False

                self.debug_event = {}
                self.debug_location = None

                self.debug_pause_revision += 1

                self.debug_breakpoint_status = []

                self.debug_sources.clear()
                self.source_cache.clear()
                self.active_breakpoint_paths.clear()

                self.breakpoints.clear()

                self._variable_cache = None
                self._variable_revision = -1

                self.changed = time.time()

            if client is not None:
                with suppress(Exception):
                    client.stop_channels()

            if manager is not None:
                with suppress(Exception):
                    manager.shutdown_kernel(now=True)

    def close_kernel(self):
        self._drop_kernel()

    # ========================================================
    # RESTART KERNEL
    # ========================================================

    def restart(self, kernel_name=None):
        """
        Restart even if execution is paused or stuck.

        Any running execution is invalidated before the
        replacement kernel is started.
        """

        with self.kernel_lock:

            if (
                kernel_name
                and kernel_name not in self.kernelnames()
            ):
                raise ValueError(
                    "Requested kernel is not installed."
                )

            self._drop_kernel()

            with self.lock:
                if kernel_name:
                    self.kernel_name = kernel_name

                    self.note["metadata"].setdefault(
                        "kernelspec", {}
                    )["name"] = kernel_name

                self.error = None
                self.debug_last_outcome = (
                    "Kernel restarted."
                )

            self.ensure_kernel()

    # ========================================================
    # WRITE NOTEBOOK
    # ========================================================

    def _write(self):
        self.path.parent.mkdir(
            parents=True,
            exist_ok=True
        )

        if self.recovery_original is not None:
            digest = hashlib.sha256(
                self.recovery_original
            ).hexdigest()[:12]

            backup = self.path.with_name(
                self.path.name
                + ".original-"
                + digest
                + ".txt"
            )

            if not backup.exists():
                with open(backup, "xb") as output:
                    os.chmod(backup, 0o600)

                    output.write(
                        self.recovery_original
                    )

                    output.flush()
                    os.fsync(output.fileno())

        temporary = self.path.with_name(
            "."
            + self.path.name
            + "."
            + secrets.token_hex(6)
            + ".tmp"
        )

        try:
            with open(
                temporary,
                "x",
                encoding="utf-8"
            ) as output:

                os.chmod(temporary, 0o600)

                json.dump(
                    self.note,
                    output,
                    ensure_ascii=False,
                    indent=1
                )

                output.write("\n")
                output.flush()
                os.fsync(output.fileno())

            os.replace(
                temporary,
                self.path
            )

        finally:
            with suppress(FileNotFoundError):
                temporary.unlink()

        self.file_hash = fingerprint(self.path)

        self.recovery_original = None
        self.recovery_warning = None

        self.changed = time.time()

    # ========================================================
    # SAVE NOTEBOOK
    # ========================================================

    def save(self, proposed, expected_hash):
        with self.lock:

            if self.busy:
                raise RuntimeError(
                    "Wait for execution to finish before saving."
                )

            if (
                expected_hash != self.file_hash
                or fingerprint(self.path) != self.file_hash
            ):
                raise FileExistsError(
                    "Notebook changed on disk. "
                    "Reload before saving."
                )

            proposed = normalize(
                copy.deepcopy(proposed)
            )

            size = len(
                json.dumps(proposed).encode("utf-8")
            )

            if size > MAX_REQUEST:
                raise ValueError(
                    "Notebook exceeds the 32 MB limit."
                )

            self.note = proposed

            self.note["metadata"].setdefault(
                "kernelspec", {}
            )["name"] = self.kernel_name

            self._write()

            return self.file_hash

    # ========================================================
    # CLEAR OUTPUTS
    # ========================================================

    def clear_outputs(self):
        with self.lock:

            if self.busy:
                raise RuntimeError(
                    "Stop execution before clearing outputs."
                )

            if fingerprint(self.path) != self.file_hash:
                raise FileExistsError(
                    "Notebook changed on disk. "
                    "Reload before clearing outputs."
                )

            for cell in self.note["cells"]:
                if cell["cell_type"] == "code":
                    cell["outputs"] = []
                    cell["execution_count"] = None

            self._write()

            return self.file_hash

    # ========================================================
    # SNAPSHOT FOR FRONTEND
    # ========================================================

    def snapshot(self):
        with self.lock:
            return {
                "notebook": copy.deepcopy(self.note),
                "fileHash": self.file_hash,
                "path": str(
                    self.path.relative_to(self.root)
                ),

                "busy": self.busy,
                "running": self.running,

                "kernel": self.kernel_name,
                "kernelReady": self.kernel_ready,

                "error": self.error,

                "debugSupported": self.debug_supported,
                "debugActive": self.debug_active,
                "debugPaused": self.debug_paused,
                "debugStarting": self.debug_starting,

                "debugEvent": copy.deepcopy(
                    self.debug_event
                ),

                "debugLocation": copy.deepcopy(
                    self.debug_location
                ),

                "debugPauseRevision": (
                    self.debug_pause_revision
                ),

                "debugBreakpointStatus": copy.deepcopy(
                    self.debug_breakpoint_status
                ),

                "debugLastOutcome": (
                    self.debug_last_outcome
                ),

                "recoveryWarning": (
                    self.recovery_warning
                ),

                "recoveryNotice": (
                    self.recovery_notice
                ),

                "stopPending": self.stop_pending,

                "changed": self.changed
            }

    # ========================================================
    # FIND CELL
    # ========================================================

    def _cell(self, cell_id):
        return next(
            (
                cell
                for cell in self.note["cells"]
                if cell["id"] == cell_id
            ),
            None
        )

    # ========================================================
    # START EXECUTION
    # ========================================================

    def run(
        self,
        cell_id,
        debug=False,
        lines=None
    ):
        self.ensure_kernel()

        with self.lock:

            if self.busy or self.stop_pending:
                raise RuntimeError(
                    "A notebook cell is already running."
                )

            cell = self._cell(cell_id)

            if (
                cell is None
                or cell["cell_type"] != "code"
            ):
                raise ValueError(
                    "Select a valid Python code cell."
                )

            if debug and not self.debug_supported:
                raise RuntimeError(
                    "The selected kernel does not support "
                    "the Jupyter debugger."
                )

            code = cell["source"]

            requested = [
                number
                for number in (lines or [])
                if type(number) is int and number > 0
            ]

            self.breakpoints[cell_id] = list(
                dict.fromkeys(requested)
            )

            self.generation += 1
            generation = self.generation

            client = self.client

            self.busy = True
            self.running = cell_id
            self.stop_pending = False

            self.error = None
            self.recovery_notice = None

            self.debug_ever_paused = False
            self.debug_paused = False
            self.debug_starting = bool(debug)

            self.debug_location = None
            self.debug_event = {}

            self.debug_pause_revision += 1

            self.debug_last_outcome = None
            self.debug_breakpoint_status = []

            self._variable_cache = None
            self._variable_revision = -1

            cell["outputs"] = []
            cell["execution_count"] = None

            self.changed = time.time()

        worker = threading.Thread(
            target=self._execute,
            args=(
                generation,
                client,
                cell_id,
                code,
                debug
            ),
            daemon=True
        )

        worker.start()

    # ========================================================
    # DEBUG ADAPTER REQUESTS
    # ========================================================

    def _debug_request(
        self,
        command,
        arguments=None,
        timeout=10
    ):
        with self.debug_lock:

            with self.lock:
                client = self.client
                supported = self.debug_supported

                self.debug_seq += 1
                sequence = self.debug_seq

            if client is None or not supported:
                raise RuntimeError(
                    "Debugger is not connected."
                )

            content = {
                "seq": sequence,
                "type": "request",
                "command": command,
                "arguments": arguments or {}
            }

            message = client.session.send(
                client.control_channel.socket,
                "debug_request",
                content
            )

            message_id = message["msg_id"]

            deadline = time.monotonic() + timeout

            while time.monotonic() < deadline:

                try:
                    reply = client.get_control_msg(
                        timeout=min(
                            1,
                            max(
                                0.1,
                                deadline - time.monotonic()
                            )
                        )
                    )

                except queue.Empty:
                    continue

                if (
                    reply.get(
                        "header", {}
                    ).get("msg_type") != "debug_reply"
                ):
                    continue

                if (
                    reply.get(
                        "parent_header", {}
                    ).get("msg_id") != message_id
                ):
                    continue

                result = reply.get("content", {})

                if not result.get("success", True):
                    raise RuntimeError(
                        result.get(
                            "message",
                            command + " failed"
                        )
                    )

                return result

            raise TimeoutError(
                "Debugger did not answer "
                + command
                + "."
            )

    # ========================================================
    # ATTACH DEBUGGER
    # ========================================================

    def _attach(self):
        if self.debug_active:
            return

        self._debug_request(
            "initialize",
            {
                "clientID": "nova-notebook-studio",
                "clientName": "Nova Notebook Studio",
                "adapterID": "python",
                "pathFormat": "path",
                "linesStartAt1": True,
                "columnsStartAt1": True,
                "supportsVariableType": True
            }
        )

        self._debug_request(
            "attach",
            {}
        )

        self._debug_request(
            "setExceptionBreakpoints",
            {"filters": []}
        )

        with self.lock:
            self.debug_active = True

    # ========================================================
    # REGISTER DEBUGGER SOURCES
    # ========================================================

    def _prepare_debug(
        self,
        generation,
        cell_id,
        code
    ):
        self._attach()

        with self.lock:
            cells = [
                (
                    cell["id"],
                    cell["source"]
                )
                for cell in self.note["cells"]
                if cell["cell_type"] == "code"
            ]

            requested = list(
                self.breakpoints.get(cell_id, [])
            )

        if not requested:
            first = first_executable_line(code)

            if first is not None:
                requested = [first]

        paths = {}

        # Register each cell with the Jupyter debugger,
        # reusing unchanged source mappings.
        for current_id, source in cells:

            if not source.strip():
                continue

            digest = hashlib.sha256(
                source.encode("utf-8")
            ).hexdigest()

            cached = self.source_cache.get(
                current_id
            )

            if cached and cached[0] == digest:
                paths[current_id] = cached[1]
                continue

            dumped = self._debug_request(
                "dumpCell",
                {"code": source}
            )

            source_path = dumped.get(
                "body", {}
            ).get("sourcePath")

            if source_path:
                paths[current_id] = source_path

                self.source_cache[current_id] = (
                    digest,
                    source_path
                )

        if cell_id not in paths:
            raise RuntimeError(
                "Debugger did not return a source "
                "path for the selected code cell."
            )

        current_path = paths[cell_id]

        # Clear breakpoints left by earlier debugging runs.
        old_paths = set(
            self.active_breakpoint_paths
        )

        for old_path in old_paths:
            if old_path == current_path:
                continue

            self._debug_request(
                "setBreakpoints",
                {
                    "source": {
                        "path": old_path
                    },
                    "breakpoints": [],
                    "sourceModified": False
                }
            )

        request = {
            "source": {
                "path": current_path
            },

            "breakpoints": [
                {"line": line}
                for line in requested
            ],

            "sourceModified": False
        }

        reply = self._debug_request(
            "setBreakpoints",
            request
        )

        received = reply.get(
            "body", {}
        ).get("breakpoints", [])

        statuses = []

        for index, requested_line in enumerate(requested):

            actual = (
                received[index]
                if index < len(received)
                else {}
            )

            statuses.append({
                "requestedLine": requested_line,
                "actualLine": actual.get("line"),
                "verified": bool(
                    actual.get("verified")
                ),
                "message": actual.get("message", ""),
                "automatic": not self.breakpoints.get(
                    cell_id
                )
            })

        with self.lock:

            if generation != self.generation:
                return

            # All known code-cell source paths.
            self.debug_sources = {
                path: current_id
                for current_id, path in paths.items()
            }

            self.debug_breakpoint_status = statuses

            self.active_breakpoint_paths = {
                current_path
            }

            self.changed = time.time()

        rejected = [
            item
            for item in statuses
            if not item["verified"]
        ]

        if rejected:
            raise RuntimeError(
                "Unverified breakpoint(s): "
                + ", ".join(
                    str(item["requestedLine"])
                    for item in rejected
                )
            )

    # ========================================================
    # FIND CURRENT DEBUG EXECUTION LINE
    # ========================================================

    def _resolve_location(
        self,
        generation,
        revision,
        thread_id
    ):
        try:
            reply = self._debug_request(
                "stackTrace",
                {
                    "threadId": thread_id,
                    "startFrame": 0,
                    "levels": 40
                },
                timeout=6
            )

            frames = reply.get(
                "body", {}
            ).get("stackFrames", [])

        except Exception:
            return

        with self.lock:
            sources = dict(
                self.debug_sources
            )

        lookup = {
            normalized_source_path(path): cell_id
            for path, cell_id in sources.items()
        }

        location = None

        for frame in frames:
            source = frame.get("source") or {}

            path = source.get("path", "")

            cell_id = lookup.get(
                normalized_source_path(path)
            )

            line = frame.get("line")

            if (
                cell_id is None
                or type(line) is not int
                or line < 1
            ):
                continue

            location = {
                "cellId": cell_id,
                "line": line,
                "column": frame.get("column", 1),
                "functionName": frame.get("name", ""),
                "sourcePath": path
            }

            break

        with self.lock:

            if (
                generation == self.generation
                and self.debug_paused
                and revision == self.debug_pause_revision
            ):
                self.debug_location = location
                self.changed = time.time()

    # ========================================================
    # EXECUTE PYTHON CODE
    # ========================================================

    def _execute(
        self,
        generation,
        client,
        cell_id,
        code,
        debug
    ):
        reply_received = False
        idle_received = False

        try:
            if debug:
                self._prepare_debug(
                    generation,
                    cell_id,
                    code
                )

                with self.lock:

                    if generation != self.generation:
                        return

                    self.debug_starting = False
                    self.changed = time.time()

            message_id = client.execute(
                code,
                store_history=True,
                allow_stdin=False,
                stop_on_error=False
            )

            deadline = (
                time.monotonic() + 24 * 3600
            )

            while time.monotonic() < deadline:

                with self.lock:
                    if generation != self.generation:
                        return

                # --------------------------------------------
                # SHELL REPLY
                # --------------------------------------------

                try:
                    reply = client.get_shell_msg(
                        timeout=0.01
                    )

                    if (
                        reply.get(
                            "header", {}
                        ).get("msg_type") == "execute_reply"
                        and reply.get(
                            "parent_header", {}
                        ).get("msg_id") == message_id
                    ):
                        reply_received = True

                except queue.Empty:
                    pass

                if reply_received and idle_received:
                    break

                # --------------------------------------------
                # IOPUB MESSAGES
                # --------------------------------------------

                try:
                    message = client.get_iopub_msg(
                        timeout=0.20
                    )

                except queue.Empty:
                    continue

                kind = message.get(
                    "header", {}
                ).get("msg_type")

                content = message.get(
                    "content", {}
                )

                # --------------------------------------------
                # DEBUG EVENTS
                # --------------------------------------------

                if kind == "debug_event":

                    with self.lock:

                        if generation != self.generation:
                            return

                        self.debug_event = copy.deepcopy(
                            content
                        )

                        event = content.get("event")

                        if event == "stopped":
                            self.debug_paused = True
                            self.debug_ever_paused = True

                        elif event in (
                            "continued",
                            "terminated",
                            "exited"
                        ):
                            self.debug_paused = False

                        self.debug_pause_revision += 1

                        revision = (
                            self.debug_pause_revision
                        )

                        self.debug_location = None

                        self._variable_cache = None
                        self._variable_revision = -1

                        self.changed = time.time()

                    if event == "stopped":
                        thread_id = content.get(
                            "body", {}
                        ).get("threadId", 1)

                        threading.Thread(
                            target=self._resolve_location,
                            args=(
                                generation,
                                revision,
                                thread_id
                            ),
                            daemon=True
                        ).start()

                    continue

                # Ignore unrelated kernel messages.
                if (
                    message.get(
                        "parent_header", {}
                    ).get("msg_id") != message_id
                ):
                    continue

                # --------------------------------------------
                # OUTPUTS
                # --------------------------------------------

                with self.lock:

                    if generation != self.generation:
                        return

                    cell = self._cell(cell_id)

                    if cell is None:
                        continue

                    if kind == "stream":
                        cell["outputs"].append({
                            "output_type": "stream",
                            "name": content.get(
                                "name", "stdout"
                            ),
                            "text": content.get(
                                "text", ""
                            )
                        })

                    elif kind in (
                        "display_data",
                        "execute_result"
                    ):
                        output = {
                            "output_type": kind,
                            "data": content.get(
                                "data", {}
                            ),
                            "metadata": content.get(
                                "metadata", {}
                            )
                        }

                        if kind == "execute_result":
                            output["execution_count"] = (
                                content.get(
                                    "execution_count"
                                )
                            )

                        cell["outputs"].append(output)

                    elif kind == "error":
                        cell["outputs"].append({
                            "output_type": "error",
                            "ename": content.get(
                                "ename", "Error"
                            ),
                            "evalue": content.get(
                                "evalue", ""
                            ),
                            "traceback": content.get(
                                "traceback", []
                            )
                        })

                    elif kind == "clear_output":
                        cell["outputs"] = []

                    elif kind == "execute_input":
                        cell["execution_count"] = (
                            content.get(
                                "execution_count"
                            )
                        )

                    elif kind == "status":
                        idle_received = (
                            content.get(
                                "execution_state"
                            ) == "idle"
                        )

                    self.changed = time.time()

            else:
                raise TimeoutError(
                    "Cell execution exceeded 24 hours."
                )

            if debug:
                with self.lock:

                    if generation == self.generation:
                        if self.debug_ever_paused:
                            outcome = (
                                "Debug session completed after "
                                "pausing at a breakpoint."
                            )

                        else:
                            outcome = (
                                "Debug completed without stopping "
                                "at a breakpoint."
                            )

                        self.debug_last_outcome = outcome

        except Exception as error:
            with self.lock:

                if generation == self.generation:
                    self.error = str(error)

                    if debug:
                        self.debug_last_outcome = (
                            "Debug failed: " + str(error)
                        )

        finally:
            with self.lock:

                if generation == self.generation:

                    self.busy = False
                    self.running = None
                    self.stop_pending = False

                    self.debug_paused = False
                    self.debug_starting = False

                    self.debug_location = None
                    self.debug_pause_revision += 1

                    self.changed = time.time()

                    # Persist outputs only if the file
                    # has not changed externally.
                    if (
                        self.recovery_original is None
                        and fingerprint(self.path)
                        == self.file_hash
                    ):
                        with suppress(Exception):
                            self._write()

    # ========================================================
    # DEBUGGER STEPPING
    # ========================================================

    def step(self, command):
        valid = (
            "continue",
            "next",
            "stepIn",
            "stepOut",
            "pause",
            "disconnect"
        )

        if command not in valid:
            raise ValueError(
                "Unsupported debugger command."
            )

        with self.lock:

            if not self.debug_active:
                raise RuntimeError(
                    "Debugger is not attached."
                )

            if (
                command
                not in ("pause", "disconnect")
                and not self.debug_paused
            ):
                raise RuntimeError(
                    "Debugger is not paused."
                )

            thread_id = self.debug_event.get(
                "body", {}
            ).get("threadId", 1)

        self._debug_request(
            command,
            {"threadId": thread_id}
        )

        if command in (
            "continue",
            "next",
            "stepIn",
            "stepOut",
            "disconnect"
        ):
            with self.lock:

                self.debug_paused = False
                self.debug_location = None

                self.debug_pause_revision += 1

                self._variable_cache = None
                self._variable_revision = -1

                self.changed = time.time()

                if command == "disconnect":
                    self.debug_active = False

    # ========================================================
    # STOP EXECUTION / DEBUGGER
    # ========================================================

    def _stop_worker(self, generation):
        """
        Attempt a graceful interrupt.

        If the kernel remains stuck in a paused debugger,
        restart it so subsequent notebook executions work.

        A forced restart clears in-memory Python variables.
        """

        with self.lock:
            manager = self.kernel
            paused = self.debug_paused

            thread_id = self.debug_event.get(
                "body", {}
            ).get("threadId", 1)

        if paused:
            with suppress(Exception):
                self._debug_request(
                    "continue",
                    {"threadId": thread_id},
                    timeout=2
                )

        if manager is not None:
            with suppress(Exception):
                manager.interrupt_kernel()

        deadline = time.monotonic() + 3

        while time.monotonic() < deadline:

            with self.lock:

                if (
                    generation != self.generation
                    or not self.busy
                ):
                    self.stop_pending = False
                    return

            time.sleep(0.1)

        with self.lock:

            if (
                generation != self.generation
                or not self.busy
            ):
                return

        # Execution did not respond to interruption.
        try:
            self.restart()

            with self.lock:
                self.recovery_notice = (
                    "Execution did not stop normally. "
                    "The Python kernel was restarted to "
                    "recover Notebook Studio. "
                    "In-memory variables were cleared."
                )

                self.debug_last_outcome = (
                    self.recovery_notice
                )

        except Exception as error:
            with self.lock:
                self.error = (
                    "Unable to recover kernel: "
                    + str(error)
                )

                self.stop_pending = False

    def interrupt(self):
        with self.lock:

            if not self.busy:
                return False

            if self.stop_pending:
                return True

            self.stop_pending = True
            generation = self.generation

        threading.Thread(
            target=self._stop_worker,
            args=(generation,),
            daemon=True
        ).start()

        return True

    # ========================================================
    # VARIABLE INSPECTION
    # ========================================================

    def variables(self):
        with self.lock:

            if (
                not self.debug_supported
                or self.stop_pending
            ):
                return []

            if self.busy and not self.debug_paused:
                return []

            paused = self.debug_paused

            revision = self.debug_pause_revision

            if (
                paused
                and self._variable_cache is not None
                and self._variable_revision == revision
            ):
                return copy.deepcopy(
                    self._variable_cache
                )

            thread_id = self.debug_event.get(
                "body", {}
            ).get("threadId", 1)

        self._attach()

        result = None

        if paused:
            with suppress(Exception):

                frames = self._debug_request(
                    "stackTrace",
                    {
                        "threadId": thread_id,
                        "startFrame": 0,
                        "levels": 1
                    }
                ).get(
                    "body", {}
                ).get("stackFrames", [])

                if frames:
                    scopes = self._debug_request(
                        "scopes",
                        {
                            "frameId": frames[0]["id"]
                        }
                    ).get(
                        "body", {}
                    ).get("scopes", [])

                    values = []

                    for scope in scopes:
                        reference = scope.get(
                            "variablesReference"
                        )

                        if reference:
                            reply = self._debug_request(
                                "variables",
                                {
                                    "variablesReference": reference,
                                    "start": 0,
                                    "count": 50
                                }
                            )

                            values.extend(
                                reply.get(
                                    "body", {}
                                ).get(
                                    "variables", []
                                )
                            )

                        if len(values) >= 80:
                            break

                    result = values[:80]

        if result is None:
            result = self._debug_request(
                "inspectVariables",
                {"mimeType": "text/plain"}
            ).get(
                "body", {}
            ).get("variables", [])

        with self.lock:

            if (
                paused
                and self.debug_paused
                and revision == self.debug_pause_revision
            ):
                self._variable_cache = copy.deepcopy(
                    result
                )

                self._variable_revision = revision

        return result

    # ========================================================
    # KERNEL AUTOCOMPLETE AND INSPECTION
    # ========================================================

    def _shell_request(
        self,
        message_id,
        result_type
    ):
        deadline = time.monotonic() + 8

        while time.monotonic() < deadline:

            try:
                message = self.client.get_shell_msg(
                    timeout=0.5
                )

            except queue.Empty:
                continue

            if (
                message.get(
                    "header", {}
                ).get("msg_type") == result_type
                and message.get(
                    "parent_header", {}
                ).get("msg_id") == message_id
            ):
                return message.get("content", {})

        raise TimeoutError(
            "Jupyter did not reply."
        )

    def complete(self, code, cursor):
        return self._introspect(
            "complete",
            code,
            cursor
        )

    def inspect(self, code, cursor):
        return self._introspect(
            "inspect",
            code,
            cursor
        )

    def _introspect(
        self,
        operation,
        code,
        cursor
    ):
        with self.lock:
            if self.busy:
                raise RuntimeError(
                    "Kernel is busy."
                )

        if (
            not isinstance(code, str)
            or len(code) > 100000
            or type(cursor) is not int
            or not 0 <= cursor <= len(code)
        ):
            raise ValueError(
                "Invalid editor request."
            )

        self.ensure_kernel()

        with self.lock:

            if operation == "complete":
                message_id = self.client.complete(
                    code,
                    cursor_pos=cursor
                )

            else:
                message_id = self.client.inspect(
                    code,
                    cursor_pos=cursor,
                    detail_level=0
                )

            return self._shell_request(
                message_id,
                operation + "_reply"
            )


# ============================================================
# LOCAL HTTP SERVER
# ============================================================

class Server(ThreadingHTTPServer):

    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        root,
        notebook,
        kernel,
        port
    ):
        self.state = NotebookState(
            root,
            notebook,
            kernel
        )

        self.secret = secrets.token_urlsafe(32)

        super().__init__(
            ("127.0.0.1", port),
            Handler
        )

        self.origin = (
            "http://127.0.0.1:"
            + str(self.server_address[1])
        )

        self.cookie = (
            "nova_nb_"
            + str(self.server_address[1])
        )

    def close(self):
        self.state.close_kernel()
        self.server_close()


# ============================================================
# HTTP REQUEST HANDLER
# ============================================================

class Handler(BaseHTTPRequestHandler):

    server: Server

    def log_message(self, *_):
        # Avoid logging private authentication URLs.
        pass

    # ========================================================
    # AUTHENTICATION
    # ========================================================

    def authorized(self):
        raw = self.headers.get(
            "Cookie", ""
        )

        for part in raw.split(";"):
            name, separator, value = (
                part.strip().partition("=")
            )

            if (
                separator
                and name == self.server.cookie
                and hmac.compare_digest(
                    value,
                    self.server.secret
                )
            ):
                return True

        return False

    def check(self, post=False):
        if not self.authorized():
            self.send_error(
                401,
                "Notebook Studio authentication required."
            )

            return False

        if post:
            origin = self.headers.get("Origin")

            if (
                origin
                and origin != self.server.origin
            ):
                self.send_error(
                    403,
                    "Cross-origin request rejected."
                )

                return False

            if (
                self.headers.get(
                    "X-Notebook-Request"
                ) != "1"
            ):
                self.send_error(
                    403,
                    "Notebook request header missing."
                )

                return False

        return True

    # ========================================================
    # RESPONSE HEADERS
    # ========================================================

    def response_headers(
        self,
        length,
        content_type,
        status=200,
        cookie=False
    ):
        self.send_response(status)

        self.send_header(
            "Content-Type",
            content_type
        )

        self.send_header(
            "Content-Length",
            str(length)
        )

        self.send_header(
            "Cache-Control",
            "no-store"
        )

        self.send_header(
            "X-Content-Type-Options",
            "nosniff"
        )

        self.send_header(
            "Referrer-Policy",
            "no-referrer"
        )

        self.send_header(
            "X-Frame-Options",
            "SAMEORIGIN"
        )

        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data: blob:; "
            "connect-src 'self'; "
            "font-src 'self'; "
            "base-uri 'none'; "
            "form-action 'none'; "
            "frame-ancestors 'self'"
        )

        if cookie:
            self.send_header(
                "Set-Cookie",
                f"{self.server.cookie}="
                f"{self.server.secret}; "
                "Path=/; HttpOnly; SameSite=Strict"
            )

        self.end_headers()

    def json_response(
        self,
        data,
        status=200
    ):
        payload = json.dumps(
            data,
            ensure_ascii=False
        ).encode("utf-8")

        self.response_headers(
            len(payload),
            "application/json; charset=utf-8",
            status
        )

        self.wfile.write(payload)

    # ========================================================
    # GET REQUESTS
    # ========================================================

    def do_GET(self):
        route = urlparse(self.path)

        # First visit authenticates the Preview session.
        if (
            route.path == "/"
            and not self.authorized()
        ):
            token = parse_qs(
                route.query
            ).get("key", [""])[0]

            if not hmac.compare_digest(
                token,
                self.server.secret
            ):
                self.send_error(
                    401,
                    "Use the private Notebook Studio URL "
                    "provided by Nova Jupyter Bridge."
                )

                return

            payload = (
                ASSETS / "index.html"
            ).read_bytes()

            self.response_headers(
                len(payload),
                "text/html; charset=utf-8",
                cookie=True
            )

            self.wfile.write(payload)
            return

        if not self.check():
            return

        state = self.server.state

        if route.path == "/api/state":
            self.json_response(
                state.snapshot()
            )

            return

        if route.path == "/api/kernels":
            try:
                self.json_response({
                    "kernels": state.kernelnames()
                })

            except Exception as error:
                self.json_response(
                    {"error": str(error)},
                    500
                )

            return

        if route.path == "/api/variables":
            try:
                self.json_response({
                    "variables": state.variables()
                })

            except Exception as error:
                self.json_response(
                    {"error": str(error)},
                    400
                )

            return

        resources = {
            "/": (
                "index.html",
                "text/html; charset=utf-8"
            ),

            "/app.js": (
                "app.js",
                "text/javascript; charset=utf-8"
            ),

            "/app.css": (
                "app.css",
                "text/css; charset=utf-8"
            )
        }

        resource = resources.get(
            route.path
        )

        if resource is None:
            self.send_error(404)
            return

        filename, content_type = resource

        payload = (
            ASSETS / filename
        ).read_bytes()

        self.response_headers(
            len(payload),
            content_type
        )

        self.wfile.write(payload)

    # ========================================================
    # POST REQUESTS
    # ========================================================

    def do_POST(self):
        if not self.check(post=True):
            return

        try:
            size = int(
                self.headers.get(
                    "Content-Length", "0"
                )
            )

            if not 0 < size <= MAX_REQUEST:
                raise ValueError(
                    "Invalid JSON request size."
                )

            data = json.loads(
                self.rfile.read(size)
            )

            if not isinstance(data, dict):
                raise ValueError(
                    "Expected a JSON object."
                )

            state = self.server.state
            route = urlparse(self.path).path

            # ------------------------------------------------
            # SAVE
            # ------------------------------------------------

            if route == "/api/save":
                result = {
                    "fileHash": state.save(
                        data["notebook"],
                        data.get("fileHash")
                    )
                }

            # ------------------------------------------------
            # CLEAR OUTPUTS
            # ------------------------------------------------

            elif route == "/api/clear_outputs":
                result = {
                    "fileHash": state.clear_outputs(),
                    "cleared": True
                }

            # ------------------------------------------------
            # RUN / DEBUG CELL
            # ------------------------------------------------

            elif route == "/api/run":
                state.run(
                    data["cellId"],
                    bool(data.get("debug", False)),
                    data.get("breakpoints", [])
                )

                result = {
                    "started": True
                }

            # ------------------------------------------------
            # INTERRUPT OR STOP DEBUGGING
            # ------------------------------------------------

            elif route in (
                "/api/interrupt",
                "/api/stop_debug"
            ):
                result = {
                    "interrupted": state.interrupt()
                }

            # ------------------------------------------------
            # RESTART KERNEL
            # ------------------------------------------------

            elif route == "/api/restart":
                state.restart(
                    data.get("kernel")
                )

                result = {
                    "restarted": True
                }

            # ------------------------------------------------
            # DEBUGGER STEPPING
            # ------------------------------------------------

            elif route == "/api/step":
                state.step(
                    data["command"]
                )

                result = {
                    "ok": True
                }

            # ------------------------------------------------
            # AUTOCOMPLETE
            # ------------------------------------------------

            elif route == "/api/complete":
                result = {
                    "completion": state.complete(
                        data["code"],
                        data["cursor"]
                    )
                }

            # ------------------------------------------------
            # INSPECT PYTHON CODE
            # ------------------------------------------------

            elif route == "/api/inspect":
                result = {
                    "inspection": state.inspect(
                        data["code"],
                        data["cursor"]
                    )
                }

            else:
                self.json_response(
                    {"error": "Unknown endpoint."},
                    404
                )

                return

            self.json_response(result)

        except FileExistsError as error:
            self.json_response(
                {"error": str(error)},
                409
            )

        except (
            KeyError,
            ValueError,
            RuntimeError,
            TimeoutError
        ) as error:
            self.json_response(
                {"error": str(error)},
                400
            )

        except Exception as error:
            self.json_response(
                {
                    "error": (
                        type(error).__name__
                        + ": "
                        + str(error)
                    )
                },
                500
            )


# ============================================================
# ENTRY POINT
# ============================================================

def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--root",
        required=True
    )

    parser.add_argument(
        "--notebook",
        required=True
    )

    parser.add_argument(
        "--kernel",
        default=None
    )

    parser.add_argument(
        "--port",
        type=int,
        default=0
    )

    args = parser.parse_args()

    try:
        import jupyter_client

        server = Server(
            args.root,
            args.notebook,
            args.kernel,
            args.port
        )

    except Exception as error:
        print(
            "ERROR " + str(error),
            flush=True
        )

        return 1

    print(
        "READY "
        + server.origin
        + "/?key="
        + server.secret,
        flush=True
    )

    def terminate(*_):
        threading.Thread(
            target=server.shutdown,
            daemon=True
        ).start()

    signal.signal(
        signal.SIGTERM,
        terminate
    )

    try:
        server.serve_forever(
            poll_interval=0.2
        )

    except KeyboardInterrupt:
        pass

    finally:
        server.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())