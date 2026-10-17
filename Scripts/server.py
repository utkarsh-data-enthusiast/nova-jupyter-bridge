#!/usr/bin/env python3
"""
Nova Jupyter Bridge — Notebook Studio Server
Copyright (c) PatriotEver Lab
SPDX-License-Identifier: MIT

Compatibility entry point for the existing Python notebook debugger,
with standalone, local MySQL execution support.

- Existing notebook and debugger endpoints remain in server_core.py.
- SQL is executed by mysql_executor.py using MySQL login paths.
- Neither SQL nor credentials are sent to a third-party service.
"""

from __future__ import annotations

import json
from urllib.parse import urlsplit

import server_core
from mysql_executor import MAX_SQL_BYTES, MySQLExecutor


class StudioServer(server_core.Server):
    """Existing notebook server with a local MySQL executor."""

    def __init__(self, root, notebook, kernel, port):
        self.sql_executor = MySQLExecutor()
        super().__init__(root, notebook, kernel, port)

    def close(self):
        # Stop an outstanding SQL client before shutting down the kernel.
        self.sql_executor.cancel()
        super().close()


class StudioHandler(server_core.Handler):
    """Add SQL endpoints without changing the Python debugger routes."""

    def do_POST(self):
        endpoint = urlsplit(self.path).path

        if endpoint not in (
            "/api/sql/run",
            "/api/sql/cancel"
        ):
            return super().do_POST()

        # Preserve the original authentication,
        # same-origin checks, and required request header.

        if not self.check(post=True):
            return

        try:
            raw_length = self.headers.get(
                "Content-Length",
                ""
            )

            if (
                not raw_length.isascii()
                or not raw_length.isdecimal()
            ):
                raise ValueError(
                    "Invalid SQL request length."
                )

            length = int(raw_length)

            if not 0 < length <= MAX_SQL_BYTES + 8192:
                raise ValueError(
                    "SQL request is too large or empty."
                )

            body = json.loads(
                self.rfile.read(length)
            )

            if not isinstance(body, dict):
                raise ValueError(
                    "Expected a JSON object."
                )

            # ----------------------------------------
            # CANCEL SQL EXECUTION
            # ----------------------------------------

            if endpoint == "/api/sql/cancel":
                self.json_response({
                    "cancelled": (
                        self.server.sql_executor.cancel()
                    )
                })

                return

            # ----------------------------------------
            # EXECUTE SQL
            # ----------------------------------------

            result = self.server.sql_executor.execute(
                sql=body.get("sql"),
                login_path=body.get(
                    "loginPath",
                    "nova"
                ),
                timeout=body.get(
                    "timeout",
                    45
                )
            )

            self.json_response(result)

        except (
            ValueError,
            RuntimeError,
            TimeoutError
        ) as error:

            self.json_response(
                {
                    "error": str(error)
                },
                400
            )

        except (
            UnicodeError,
            json.JSONDecodeError
        ) as error:

            self.json_response(
                {
                    "error": (
                        "Invalid JSON: "
                        + str(error)
                    )
                },
                400
            )

        except Exception:
            # Do not expose internal tracebacks or
            # potentially sensitive environment details.

            self.json_response(
                {
                    "error": "MySQL execution failed."
                },
                500
            )


def main():
    """
    Reuse the existing authenticated server startup.

    Keep all existing Python execution,
    debugger, notebook, and kernel APIs intact.
    """

    server_core.Handler = StudioHandler
    server_core.Server = StudioServer

    return server_core.main()


if __name__ == "__main__":
    raise SystemExit(main())