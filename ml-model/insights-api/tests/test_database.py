import psycopg2
import pytest

import database


class FakeCursor:
    def __init__(self, execute_error=None):
        self.execute_error = execute_error
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        self.executed.append((query, params))
        if self.execute_error is not None:
            raise self.execute_error

    def fetchone(self):
        return None

    def fetchall(self):
        return []


class FakeConnection:
    def __init__(self, execute_error=None):
        self.execute_error = execute_error
        self.closed = False
        self.committed = False
        self.rolled_back = False
        self.cursors = []

    def cursor(self):
        cursor = FakeCursor(execute_error=self.execute_error)
        self.cursors.append(cursor)
        return cursor

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def test_get_conn_uses_latest_database_url(monkeypatch):
    calls = []

    def fake_connect(dsn, cursor_factory=None, connect_timeout=None):
        calls.append(
            {
                "dsn": dsn,
                "cursor_factory": cursor_factory,
                "connect_timeout": connect_timeout,
            }
        )
        return object()

    monkeypatch.setattr(database.psycopg2, "connect", fake_connect)
    monkeypatch.setenv("DATABASE_URL", "postgres://example-1")

    database._get_conn()

    monkeypatch.setenv("DATABASE_URL", "postgres://example-2")
    database._get_conn()

    assert [call["dsn"] for call in calls] == [
        "postgres://example-1",
        "postgres://example-2",
    ]
    assert all(call["connect_timeout"] == 10 for call in calls)


def test_update_run_status_retries_after_transient_disconnect(monkeypatch):
    first_conn = FakeConnection(
        execute_error=psycopg2.OperationalError("server closed the connection unexpectedly")
    )
    second_conn = FakeConnection()
    connections = iter([first_conn, second_conn])

    monkeypatch.setattr(database, "_get_conn", lambda: next(connections))
    monkeypatch.setattr(database, "_SCHEMA_READY", True)

    database.update_run_status("run-123", "detecting", 40)

    assert first_conn.rolled_back is True
    assert first_conn.closed is True
    assert first_conn.committed is False

    assert second_conn.committed is True
    assert second_conn.closed is True
    assert second_conn.cursors[0].executed[0][1] == ("detecting", 40, None, "run-123")


def test_get_conn_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(RuntimeError, match="DATABASE_URL not set"):
        database._get_conn()
