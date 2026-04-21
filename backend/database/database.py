"""
database/database.py

Thin SQLite access layer.
All queries go through query_all() / execute() so the connection
lifecycle is handled in one place.
"""

import sqlite3
from pathlib import Path

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


def delete_test_run(run_id: int):
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
        "SELECT metric, value, timestamp FROM test_results WHERE test_run_id = ?",
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