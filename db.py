"""Compass SQLite database: one file with people, projects, deadlines, meetings, publications and tasks."""
import os
import sqlite3
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DB_PATH = os.environ.get("DB_PATH", "/data/compass.sqlite3")
TZ = ZoneInfo(os.environ.get("TZ", "Europe/Rome") or "Europe/Rome")
SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    last_login      TEXT
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'dottorando',
    email         TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    matricola     TEXT NOT NULL DEFAULT '',
    ciclo         TEXT NOT NULL DEFAULT '',
    funding       TEXT NOT NULL DEFAULT '',
    cosupervisors TEXT NOT NULL DEFAULT '',
    topic         TEXT NOT NULL DEFAULT '',
    start         TEXT NOT NULL DEFAULT '',
    end           TEXT NOT NULL DEFAULT '',
    archived      INTEGER NOT NULL DEFAULT 0,
    folder        TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    example       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    acronym      TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT 'aziendale',
    partner      TEXT NOT NULL DEFAULT '',
    contract     TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'attivo',
    start        TEXT NOT NULL DEFAULT '',
    end          TEXT NOT NULL DEFAULT '',
    budget_cents INTEGER NOT NULL DEFAULT 0,
    folder       TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    example      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_people (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS contacts (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    example    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    item         TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'altro',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    notes        TEXT NOT NULL DEFAULT '',
    example      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deadlines (
    id         TEXT PRIMARY KEY,
    person_id  TEXT REFERENCES people(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'tappa',
    due        TEXT NOT NULL,
    done_at    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    example    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetings (
    id         TEXT PRIMARY KEY,
    person_id  TEXT REFERENCES people(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    next_steps TEXT NOT NULL DEFAULT '',
    example    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pubs (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    authors    TEXT NOT NULL DEFAULT '',
    venue      TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'conferenza',
    status     TEXT NOT NULL DEFAULT 'scrittura',
    deadline   TEXT NOT NULL DEFAULT '',
    year       TEXT NOT NULL DEFAULT '',
    link       TEXT NOT NULL DEFAULT '',
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    notes      TEXT NOT NULL DEFAULT '',
    example    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pub_people (
    pub_id    TEXT NOT NULL REFERENCES pubs(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (pub_id, person_id)
);
CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'todo',
    priority   TEXT NOT NULL DEFAULT 'normale',
    due        TEXT NOT NULL DEFAULT '',
    person_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    position   REAL NOT NULL DEFAULT 0,
    done_at    TEXT NOT NULL DEFAULT '',
    example    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deadlines_due ON deadlines(due);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due);
"""

# tabelle con i dati dell'utente (nell'ordine in cui si possono cancellare senza violare i riferimenti)
DATA_TABLES = ("pub_people", "project_people", "tasks", "meetings", "deadlines", "pubs", "expenses",
               "contacts", "projects", "people")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today_iso() -> str:
    return datetime.now(TZ).date().isoformat()


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or DB_PATH
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=15000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(path: str | None = None) -> None:
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('rev', '0')")
        conn.commit()
    finally:
        conn.close()


def get_setting(conn, key, default=""):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, str(value)))


def bump_rev(conn) -> int:
    rev = int(get_setting(conn, "rev", "0")) + 1
    set_setting(conn, "rev", rev)
    return rev
