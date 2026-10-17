"""
Nova Jupyter Bridge — Standalone MySQL Executor
Copyright (c) PatriotEver Lab
SPDX-License-Identifier: MIT

Local MySQL execution without JupySQL, IPython SQL magics,
SQLAlchemy, or additional Python database packages.

Credentials are loaded from MySQL's existing login-path store.
No passwords are stored in extension source code.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading

from pathlib import Path


MAX_SQL_BYTES = 1_000_000
MAX_CAPTURE_BYTES = 2_000_000

LOGIN_PATH_PATTERN = re.compile(
	r"^[A-Za-z0-9_-]{1,64}$"
)


def _mysql_binary() -> str:
	"""Find the installed MySQL client without installing anything."""

	locations = (
		"/usr/local/mysql/bin/mysql",
		"/opt/homebrew/bin/mysql",
		"/usr/local/bin/mysql",
	)

	for location in locations:
		path = Path(location)

		if path.is_file() and os.access(path, os.X_OK):
			return str(path)

	result = shutil.which("mysql")

	if result:
		return result

	raise RuntimeError(
		"MySQL client not found. Configure the mysql command "
		"before executing SQL cells."
	)


def _check_input(sql: str, login_path: str) -> None:
	"""Validate SQL input and the login-path identifier."""

	if not isinstance(sql, str):
		raise ValueError(
			"SQL source must be text."
		)

	if not sql.strip():
		raise ValueError(
			"SQL cell is empty. Type a query before running it."
		)

	if len(sql.encode("utf-8")) > MAX_SQL_BYTES:
		raise ValueError(
			"SQL cell exceeds the 1 MB limit."
		)

	if (
		not isinstance(login_path, str)
		or not LOGIN_PATH_PATTERN.fullmatch(login_path)
	):
		raise ValueError(
			"Invalid MySQL login-path name."
		)


class MySQLExecutor:
	"""Execute and cancel local MySQL queries."""

	def __init__(self):
		self._lock = threading.Lock()
		self._process = None

	def execute(
		self,
		sql: str,
		login_path: str = "nova",
		timeout: int = 45,
	) -> dict:
		"""
		Execute SQL directly through the installed MySQL client.

		SQL is supplied through standard input rather than
		shell commands or command-line SQL arguments.
		"""

		_check_input(sql, login_path)

		if (
			not isinstance(timeout, int)
			or not 1 <= timeout <= 300
		):
			raise ValueError(
				"MySQL execution timeout must be 1–300 seconds."
			)

		command = [
			_mysql_binary(),
			"--no-defaults",
			f"--login-path={login_path}",
			"--host=127.0.0.1",
			"--protocol=TCP",
			"--connect-timeout=5",
			"--default-character-set=utf8mb4",
			"--binary-mode",
			"--local-infile=0",
			"--table",
		]

		# Do not accept passwords or alternate login files
		# supplied through environment variables.

		env = os.environ.copy()

		env.pop("MYSQL_PWD", None)
		env.pop("MYSQL_TEST_LOGIN_FILE", None)

		with self._lock:

			if (
				self._process is not None
				and self._process.poll() is None
			):
				raise RuntimeError(
					"A MySQL query is already running."
				)

			try:
				process = subprocess.Popen(
					command,
					stdin=subprocess.PIPE,
					stdout=subprocess.PIPE,
					stderr=subprocess.PIPE,
					env=env,
					shell=False,
				)

			except OSError as error:
				raise RuntimeError(
					f"Could not launch MySQL: {error}"
				) from error

			self._process = process

		try:
			try:
				stdout, stderr = process.communicate(
					input=sql.encode("utf-8"),
					timeout=timeout,
				)

			except subprocess.TimeoutExpired:
				self._terminate(process)

				process.communicate()

				raise TimeoutError(
					f"MySQL query exceeded {timeout} seconds."
				)

			out = stdout[:MAX_CAPTURE_BYTES].decode(
				"utf-8",
				errors="replace",
			)

			err = stderr[:MAX_CAPTURE_BYTES].decode(
				"utf-8",
				errors="replace",
			)

			if len(stdout) > MAX_CAPTURE_BYTES:
				out += "\n[Output truncated after 2 MB]"

			if len(stderr) > MAX_CAPTURE_BYTES:
				err += "\n[Error output truncated after 2 MB]"

			if process.returncode:
				return {
					"ok": False,
					"output": out,
					"error": (
						err.strip()
						or f"MySQL exited with code {process.returncode}."
					),
				}

			return {
				"ok": True,
				"output": out,
				"error": err.strip(),
			}

		finally:
			with self._lock:
				if self._process is process:
					self._process = None

	@staticmethod
	def _terminate(process) -> None:
		"""Terminate an executing MySQL client."""

		if process.poll() is not None:
			return

		process.terminate()

		try:
			process.wait(timeout=2)

		except subprocess.TimeoutExpired:
			process.kill()
			process.wait(timeout=2)

	def cancel(self) -> bool:
		"""Cancel the currently running MySQL client."""

		with self._lock:
			process = self._process

		if process is None or process.poll() is not None:
			return False

		self._terminate(process)

		return True