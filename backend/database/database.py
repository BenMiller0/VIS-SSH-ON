"""
database/database.py

Thin SQLite access layer.
All queries go through query_all() / execute() so the connection
lifecycle is handled in one place.
"""

import sqlite3
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
DB_PATH  = BASE_DIR / "tests.db"


# ── Core helpers ──────────────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def query_all(query: str, params: tuple = ()) -> list[sqlite3.Row]:
    conn = get_connection()
    try:
        rows = conn.execute(query, params).fetchall()
    finally:
        conn.close()
    return rows


def execute(query: str, params: tuple = ()) -> int:
    conn = get_connection()
    try:
        cursor = conn.execute(query, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def execute_many(query: str, params: list[tuple]) -> None:
    conn = get_connection()
    try:
        conn.executemany(query, params)
        conn.commit()
    finally:
        conn.close()


def initialize_database() -> None:
    conn = get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS test_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                type TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS test_parameters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_config_id INTEGER,
                key TEXT,
                value TEXT,
                FOREIGN KEY (test_config_id) REFERENCES test_configs(id)
            );

            CREATE TABLE IF NOT EXISTS test_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_config_id INTEGER,
                start_time DATETIME,
                end_time DATETIME,
                status TEXT DEFAULT 'running',
                failure_reason TEXT,
                FOREIGN KEY (test_config_id) REFERENCES test_configs(id)
            );

            CREATE TABLE IF NOT EXISTS test_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_run_id INTEGER,
                metric TEXT,
                value TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (test_run_id) REFERENCES test_runs(id)
            );

            CREATE TABLE IF NOT EXISTS test_run_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_run_id INTEGER,
                event_type TEXT NOT NULL,
                message TEXT,
                payload TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (test_run_id) REFERENCES test_runs(id)
            );

            CREATE TABLE IF NOT EXISTS test_run_artifacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_run_id INTEGER,
                artifact_type TEXT NOT NULL,
                path TEXT NOT NULL,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (test_run_id) REFERENCES test_runs(id)
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


# ── Test runs ─────────────────────────────────────────────────────────────────

def create_test_run(test_config_id: int, start_time) -> int:
    return execute(
        "INSERT INTO test_runs (test_config_id, start_time, status) VALUES (?, ?, ?)",
        (test_config_id, start_time, "running"),
    )


def update_test_run(run_id: int, end_time, status: str, failure_reason: str | None):
    execute(
        "UPDATE test_runs SET end_time = ?, status = ?, failure_reason = ? WHERE id = ?",
        (end_time, status, failure_reason, run_id),
    )


def get_test_runs() -> list[sqlite3.Row]:
    return query_all("SELECT * FROM test_runs ORDER BY id DESC")


def get_test_run_by_id(run_id: int) -> sqlite3.Row | None:
    rows = query_all("SELECT * FROM test_runs WHERE id = ?", (run_id,))
    return rows[0] if rows else None


def delete_test_run(run_id: int):
    execute("DELETE FROM test_run_artifacts WHERE test_run_id = ?", (run_id,))
    execute("DELETE FROM test_run_events WHERE test_run_id = ?", (run_id,))
    execute("DELETE FROM test_results WHERE test_run_id = ?", (run_id,))
    execute("DELETE FROM test_runs WHERE id = ?", (run_id,))


# ── Test results ──────────────────────────────────────────────────────────────

def insert_result(run_id: int, metric: str, value: str):
    execute(
        "INSERT INTO test_results (test_run_id, metric, value) VALUES (?, ?, ?)",
        (run_id, metric, value),
    )


def get_results_for_run(run_id: int) -> list[sqlite3.Row]:
    return query_all(
        "SELECT metric, value, timestamp FROM test_results WHERE test_run_id = ? ORDER BY id",
        (run_id,),
    )

def insert_event(run_id: int, event_type: str, message: str | None = None, payload: str | None = None):
    execute(
        "INSERT INTO test_run_events (test_run_id, event_type, message, payload) VALUES (?, ?, ?, ?)",
        (run_id, event_type, message, payload),
    )


def get_events_for_run(run_id: int) -> list[sqlite3.Row]:
    return query_all(
        "SELECT event_type, message, payload, timestamp FROM test_run_events WHERE test_run_id = ? ORDER BY id",
        (run_id,),
    )


def insert_artifact(run_id: int, artifact_type: str, path: str, metadata: str | None = None) -> int:
    return execute(
        "INSERT INTO test_run_artifacts (test_run_id, artifact_type, path, metadata) VALUES (?, ?, ?, ?)",
        (run_id, artifact_type, path, metadata),
    )


def get_artifacts_for_run(run_id: int) -> list[sqlite3.Row]:
    return query_all(
        "SELECT id, artifact_type, path, metadata, created_at FROM test_run_artifacts WHERE test_run_id = ? ORDER BY id",
        (run_id,),
    )


# ── Test configs ──────────────────────────────────────────────────────────────

def create_test_config(name: str, description: str | None, type_: str) -> int:
    return execute(
        "INSERT INTO test_configs (name, description, type) VALUES (?, ?, ?)",
        (name, description, type_),
    )


def get_all_configs() -> list[sqlite3.Row]:
    return query_all("SELECT * FROM test_configs ORDER BY id DESC")


def get_config_by_id(config_id: int) -> sqlite3.Row | None:
    rows = query_all("SELECT * FROM test_configs WHERE id = ?", (config_id,))
    return rows[0] if rows else None


def update_test_config(config_id: int, name: str, description: str | None, type_: str):
    execute(
        "UPDATE test_configs SET name = ?, description = ?, type = ? WHERE id = ?",
        (name, description, type_, config_id),
    )


def delete_test_config(config_id: int):
    execute("DELETE FROM test_parameters WHERE test_config_id = ?", (config_id,))
    execute("DELETE FROM test_configs WHERE id = ?", (config_id,))


# ── Test parameters ───────────────────────────────────────────────────────────

def insert_test_parameter(test_config_id: int, key: str, value: str):
    execute(
        "INSERT INTO test_parameters (test_config_id, key, value) VALUES (?, ?, ?)",
        (test_config_id, key, value),
    )


def get_test_parameters(test_config_id: int) -> dict[str, str]:
    rows = query_all(
        "SELECT key, value FROM test_parameters WHERE test_config_id = ?",
        (test_config_id,),
    )
    return {row["key"]: row["value"] for row in rows}


def replace_test_parameters(test_config_id: int, parameters: dict[str, Any]):
    execute("DELETE FROM test_parameters WHERE test_config_id = ?", (test_config_id,))
    rows = [(test_config_id, key, str(value)) for key, value in parameters.items()]
    if rows:
        execute_many(
            "INSERT INTO test_parameters (test_config_id, key, value) VALUES (?, ?, ?)",
            rows,
        )


initialize_database()