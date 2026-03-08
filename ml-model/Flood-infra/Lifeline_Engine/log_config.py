"""
log_config.py — Centralized logging configuration for the Lifeline Engine.

Features
--------
- Rotating file handler  (10 MB × 5 backups) → ``lifeline_engine.log``
- Human-readable console handler with colour on TTY
- JSON-structured handler for machine-readable log ingestion
  (``lifeline_engine_json.log``), enabled when ``LOG_JSON=1`` env var is set
- Per-module log-level overrides via ``LOG_LEVEL`` env var (default INFO)
- Suppresses noisy third-party library loggers

Usage
-----
Import and call ``setup_logging()`` once, as early as possible:

    from log_config import setup_logging
    setup_logging()
    import logging
    log = logging.getLogger("lifeline.mymodule")

Calling ``setup_logging()`` multiple times is safe (idempotent).
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_LOG_DIR = Path(__file__).parent
_LOG_FILE = _LOG_DIR / "lifeline_engine.log"
_JSON_LOG_FILE = _LOG_DIR / "lifeline_engine_json.log"

_DEFAULT_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
_ENABLE_JSON   = os.getenv("LOG_JSON", "0").strip() == "1"

# Third-party loggers to silence
_QUIET_LOGGERS = [
    "urllib3", "urllib3.connectionpool",
    "fiona", "fiona.ogrext",
    "pyproj",
    "shapely", "shapely.geos",
    "matplotlib", "matplotlib.font_manager",
    "asyncio",
    "httpx", "httpcore",
    "osmnx",        # OSMnx is very chatty at DEBUG — set to WARNING
]

_PLAIN_FMT  = "%(asctime)s  %(levelname)-8s  [%(name)s]  %(message)s"
_DATE_FMT   = "%Y-%m-%d %H:%M:%S"

# ANSI colour map (TTY only)
_COLOURS = {
    "DEBUG":    "\033[36m",   # cyan
    "INFO":     "\033[32m",   # green
    "WARNING":  "\033[33m",   # yellow
    "ERROR":    "\033[31m",   # red
    "CRITICAL": "\033[35m",   # magenta
}
_RESET = "\033[0m"

_setup_done = False  # guard against repeated initialisation


# ---------------------------------------------------------------------------
# Custom formatters
# ---------------------------------------------------------------------------

class _ColouredFormatter(logging.Formatter):
    """Adds ANSI colour codes to levelname when writing to a TTY."""

    def format(self, record: logging.LogRecord) -> str:
        colour = _COLOURS.get(record.levelname, "")
        record = logging.makeLogRecord(record.__dict__)
        record.levelname = f"{colour}{record.levelname:<8}{_RESET}" if colour else record.levelname
        return super().format(record)


def _make_json_formatter() -> logging.Formatter:
    """Return a JSON log formatter (requires python-json-logger)."""
    try:
        from pythonjsonlogger.json import JsonFormatter  # type: ignore[import]
        return JsonFormatter(
            fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
            datefmt=_DATE_FMT,
            rename_fields={"asctime": "timestamp", "levelname": "level"},
        )
    except ImportError:
        # Graceful fallback — use plain formatter
        return logging.Formatter(_PLAIN_FMT, datefmt=_DATE_FMT)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def setup_logging(level: str | None = None) -> None:
    """Configure the root logger with file + console (+ optional JSON) handlers.

    Parameters
    ----------
    level:
        Override log level string (``"DEBUG"``, ``"INFO"``, etc.).
        Falls back to the ``LOG_LEVEL`` environment variable, then ``INFO``.
    """
    global _setup_done
    if _setup_done:
        return

    effective_level_str = (level or _DEFAULT_LEVEL).upper()
    effective_level     = getattr(logging, effective_level_str, logging.INFO)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)  # root accepts everything; handlers filter

    # ------------------------------------------------------------------ #
    # 1. Rotating file handler — full DEBUG, plain text                   #
    # ------------------------------------------------------------------ #
    file_handler = logging.handlers.RotatingFileHandler(
        _LOG_FILE,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(_PLAIN_FMT, datefmt=_DATE_FMT))
    root.addHandler(file_handler)

    # ------------------------------------------------------------------ #
    # 2. Console handler — respects LOG_LEVEL, colour on TTY              #
    # ------------------------------------------------------------------ #
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(effective_level)
    if sys.stdout.isatty():
        console_handler.setFormatter(_ColouredFormatter(_PLAIN_FMT, datefmt=_DATE_FMT))
    else:
        console_handler.setFormatter(logging.Formatter(_PLAIN_FMT, datefmt=_DATE_FMT))
    root.addHandler(console_handler)

    # ------------------------------------------------------------------ #
    # 3. JSON file handler (opt-in via LOG_JSON=1)                        #
    # ------------------------------------------------------------------ #
    if _ENABLE_JSON:
        json_handler = logging.handlers.RotatingFileHandler(
            _JSON_LOG_FILE,
            maxBytes=10 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        json_handler.setLevel(logging.DEBUG)
        json_handler.setFormatter(_make_json_formatter())
        root.addHandler(json_handler)

    # ------------------------------------------------------------------ #
    # 4. Silence noisy third-party loggers                                #
    # ------------------------------------------------------------------ #
    for name in _QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)

    _setup_done = True

    boot_log = logging.getLogger("lifeline.log_config")
    boot_log.info(
        "Logging initialised — level=%s | file=%s | json=%s",
        effective_level_str,
        _LOG_FILE,
        "enabled" if _ENABLE_JSON else "disabled (set LOG_JSON=1 to enable)",
    )


def get_logger(name: str) -> logging.Logger:
    """Convenience wrapper: ensures setup has run then returns a named logger.

    Parameters
    ----------
    name:
        Logger name, conventionally ``\"lifeline.<module>\"``.

    Returns
    -------
    logging.Logger
    """
    setup_logging()
    return logging.getLogger(name)
