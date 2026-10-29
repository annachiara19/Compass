"""Compass (research and people management): thesis and PhD students, research and industry projects, deadlines and tasks.

Applicazione Flask con database SQLite, pensata per girare sul PC di una sola persona (versione locale):
al primo avvio si crea l'utente dal browser, poi si accede con nome utente e password.
"""
import json
import os
import re
import secrets
import sqlite3
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

from flask import Blueprint, Flask, Response, current_app, g, jsonify, request, send_from_directory, session
from flask.sessions import SecureCookieSessionInterface
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

import db as dbm

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MIN_PASSWORD = 10
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9._@-]{3,60}$")
CSRF_HEADER = "X-Compass"

_DUMMY_HASH = generate_password_hash("password-fittizia-per-il-timing")

bp = Blueprint("compass", __name__)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------- entità: campi e validazione
# Ogni campo: (tipo, opzioni). Tipi: str, text, email, date, enum, money, ref, bool, num.

PERSON_KINDS = ("triennale", "magistrale", "dottorando", "postdoc", "assegnista", "visiting", "altro")
PROJECT_KINDS = ("aziendale", "europeo", "nazionale", "regionale", "interno", "altro")
PROJECT_STATUS = ("proposta", "attivo", "sospeso", "concluso")
EXPENSE_CATS = ("personale", "attrezzature", "materiali", "missioni", "servizi", "altro")
DEADLINE_KINDS = ("tappa", "deliverable", "report", "rendicontazione", "scadenza")
PUB_KINDS = ("conferenza", "rivista", "workshop", "capitolo", "tesi", "altro")
PUB_STATUS = ("idea", "scrittura", "sottomesso", "revisione", "accettato", "pubblicato", "rifiutato")
TASK_STATUS = ("todo", "doing", "done")
TASK_PRIORITY = ("alta", "normale", "bassa")

ENTITIES = {
    "people": {
        "label": "person",
        "fields": {
            "name": ("str", {"max": 120, "required": True, "label": "Full name"}),
            "kind": ("enum", {"choices": PERSON_KINDS, "default": "dottorando"}),
            "email": ("email", {}),
            "phone": ("str", {"max": 40}),
            "matricola": ("str", {"max": 40}),
            "ciclo": ("str", {"max": 20}),
            "funding": ("str", {"max": 200}),
            "cosupervisors": ("str", {"max": 200}),
            "topic": ("str", {"max": 300}),
            "start": ("date", {"label": "Start"}),
            "end": ("date", {"label": "Expected end"}),
            "archived": ("bool", {}),
            "folder": ("str", {"max": 500}),
            "notes": ("text", {"max": 5000}),
        },
    },
    "projects": {
        "label": "project",
        "fields": {
            "title": ("str", {"max": 200, "required": True, "label": "Title"}),
            "acronym": ("str", {"max": 40}),
            "kind": ("enum", {"choices": PROJECT_KINDS, "default": "aziendale"}),
            "partner": ("str", {"max": 200}),
            "contract": ("str", {"max": 200}),
            "status": ("enum", {"choices": PROJECT_STATUS, "default": "attivo"}),
            "start": ("date", {"label": "Start"}),
            "end": ("date", {"label": "End"}),
            "budget_cents": ("money", {"label": "Budget"}),
            "folder": ("str", {"max": 500}),
            "notes": ("text", {"max": 5000}),
        },
    },
    "contacts": {
        "label": "contact",
        "fields": {
            "project_id": ("ref", {"table": "projects", "required": True, "label": "Project"}),
            "name": ("str", {"max": 120, "required": True, "label": "Name"}),
            "role": ("str", {"max": 120}),
            "email": ("email", {}),
            "phone": ("str", {"max": 40}),
            "notes": ("text", {"max": 2000}),
        },
    },
    "expenses": {
        "label": "expense",
        "fields": {
            "project_id": ("ref", {"table": "projects", "required": True, "label": "Project"}),
            "date": ("date", {"required": True, "label": "Date"}),
            "item": ("str", {"max": 200, "required": True, "label": "Item"}),
            "category": ("enum", {"choices": EXPENSE_CATS, "default": "altro"}),
            "amount_cents": ("money", {"label": "Amount"}),
            "notes": ("text", {"max": 2000}),
        },
    },
    "deadlines": {
        "label": "deadline",
        "fields": {
            "person_id": ("ref", {"table": "people"}),
            "project_id": ("ref", {"table": "projects"}),
            "title": ("str", {"max": 200, "required": True, "label": "Title"}),
            "kind": ("enum", {"choices": DEADLINE_KINDS, "default": "tappa"}),
            "due": ("date", {"required": True, "label": "Date"}),
            "done": ("bool", {"virtual": True}),
            "notes": ("text", {"max": 2000}),
        },
    },
    "meetings": {
        "label": "meeting",
        "fields": {
            "person_id": ("ref", {"table": "people"}),
            "project_id": ("ref", {"table": "projects"}),
            "date": ("date", {"required": True, "label": "Date"}),
            "title": ("str", {"max": 200}),
            "notes": ("text", {"max": 10000}),
            "next_steps": ("text", {"max": 5000}),
        },
    },
    "pubs": {
        "label": "publication",
        "fields": {
            "title": ("str", {"max": 300, "required": True, "label": "Title"}),
            "authors": ("str", {"max": 500}),
            "venue": ("str", {"max": 200}),
            "kind": ("enum", {"choices": PUB_KINDS, "default": "conferenza"}),
            "status": ("enum", {"choices": PUB_STATUS, "default": "scrittura"}),
            "deadline": ("date", {"label": "Deadline"}),
            "year": ("str", {"max": 10}),
            "link": ("str", {"max": 500}),
            "project_id": ("ref", {"table": "projects"}),
            "notes": ("text", {"max": 5000}),
        },
    },
    "tasks": {
        "label": "task",
        "fields": {
            "title": ("str", {"max": 300, "required": True, "label": "Title"}),
            "notes": ("text", {"max": 5000}),
            "status": ("enum", {"choices": TASK_STATUS, "default": "todo"}),
            "priority": ("enum", {"choices": TASK_PRIORITY, "default": "normale"}),
            "due": ("date", {"label": "Deadline"}),
            "person_id": ("ref", {"table": "people"}),
            "project_id": ("ref", {"table": "projects"}),
            "position": ("num", {}),
        },
    },
}
BOOL_COLUMNS = {"archived", "example"}


def parse_money(value, label):
    """Euro to cents. Accepts numbers and text in English or Italian style:
    12,500.50 · 12500.5 · 12.500,50 · 12500,50 · € 1,250. With both separators the last one is the decimal point;
    with a single comma followed by exactly three digits (12,500) the comma separates thousands."""
    if value in (None, ""):
        return 0
    if isinstance(value, bool):
        raise ApiError(400, f"{label}: invalid amount.")
    if isinstance(value, (int, float)):
        d = Decimal(str(value))
    else:
        s = str(value).strip().replace("€", "").replace(" ", "").replace("'", "")
        if "," in s and "." in s:
            if s.rfind(",") > s.rfind("."):
                s = s.replace(".", "").replace(",", ".")
            else:
                s = s.replace(",", "")
        elif "," in s:
            parts = s.split(",")
            if len(parts) > 2 or len(parts[-1]) == 3:
                s = s.replace(",", "")
            else:
                s = s.replace(",", ".")
        elif s.count(".") > 1:
            s = s.replace(".", "")
        try:
            d = Decimal(s)
        except InvalidOperation:
            raise ApiError(400, f"{label}: invalid amount.")
    if d.is_nan() or abs(d) > Decimal("1000000000"):
        raise ApiError(400, f"{label}: invalid amount.")
    return int((d * 100).quantize(Decimal("1")))


def vdate(value, label, required=False):
    value = value.strip() if isinstance(value, str) else ""
    if not value:
        if required:
            raise ApiError(400, f"{label}: enter a date.")
        return ""
    try:
        if not DATE_RE.match(value):
            raise ValueError
        date.fromisoformat(value)
    except ValueError:
        raise ApiError(400, f"{label}: invalid date.")
    return value


def vstr(value, maxlen):
    if value is None:
        return ""
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise ApiError(400, "Invalid value.")
    return str(value).strip()[:maxlen]


def validate(entity, data, conn, partial=False):
    """Restituisce {colonna: valore} dai dati inviati. partial=True: solo i campi presenti."""
    out = {}
    for key, (kind, opt) in ENTITIES[entity]["fields"].items():
        if partial and key not in data:
            continue
        v = data.get(key)
        label = opt.get("label", key)
        if kind == "str":
            v = vstr(v, opt["max"])
            if opt.get("required") and not v:
                raise ApiError(400, f"{label}: required.")
        elif kind == "text":
            v = vstr(v, opt["max"]) if not isinstance(v, str) else v.strip()[:opt["max"]]
        elif kind == "email":
            v = vstr(v, 200)
            if v and not EMAIL_RE.match(v):
                raise ApiError(400, "Invalid email address.")
        elif kind == "date":
            v = vdate(v, label, opt.get("required", False))
        elif kind == "enum":
            v = v if v in opt["choices"] else (opt["default"] if v in (None, "") else None)
            if v is None:
                raise ApiError(400, f"Value not allowed for {label}.")
        elif kind == "money":
            v = parse_money(v, label)
        elif kind == "bool":
            v = 1 if v is True or v in (1, "1", "true") else 0
        elif kind == "num":
            try:
                v = float(v or 0)
            except (TypeError, ValueError):
                raise ApiError(400, "Invalid value.")
        elif kind == "ref":
            v = vstr(v, 40) or None
            if v and not conn.execute(f"SELECT 1 FROM {opt['table']} WHERE id = ?", (v,)).fetchone():
                raise ApiError(400, f"{label}: item not found. Reload the page.")
            if opt.get("required") and not v:
                raise ApiError(400, f"{label}: required.")
        out[key] = v
    return out


def _apply_virtual(entity, f, row=None):
    """Campi calcolati: data di completamento di scadenze e task."""
    today = dbm.today_iso()
    if entity == "deadlines" and "done" in f:
        done = f.pop("done")
        f["done_at"] = ((row["done_at"] if row and row["done_at"] else today) if done else "")
    if entity == "tasks" and "status" in f:
        if f["status"] == "done":
            f["done_at"] = row["done_at"] if row and row["done_at"] else today
        else:
            f["done_at"] = ""
    return f


def _set_links(conn, entity, item_id, data):
    """Relazioni molti-a-molti: persone di un progetto (con ruolo) e autori interni di una pubblicazione."""
    if entity == "projects" and "members" in data:
        members = data["members"]
        if not isinstance(members, list):
            raise ApiError(400, "Invalid list of people.")
        conn.execute("DELETE FROM project_people WHERE project_id = ?", (item_id,))
        for m in members[:200]:
            pid = vstr(m.get("person_id") if isinstance(m, dict) else m, 40)
            if not pid or not conn.execute("SELECT 1 FROM people WHERE id = ?", (pid,)).fetchone():
                continue
            role = vstr(m.get("role"), 120) if isinstance(m, dict) else ""
            conn.execute("INSERT OR REPLACE INTO project_people(project_id, person_id, role) VALUES (?, ?, ?)",
                         (item_id, pid, role))
    if entity == "pubs" and "person_ids" in data:
        ids = data["person_ids"]
        if not isinstance(ids, list):
            raise ApiError(400, "Invalid list of people.")
        conn.execute("DELETE FROM pub_people WHERE pub_id = ?", (item_id,))
        for pid in ids[:100]:
            pid = vstr(pid, 40)
            if pid and conn.execute("SELECT 1 FROM people WHERE id = ?", (pid,)).fetchone():
                conn.execute("INSERT OR IGNORE INTO pub_people(pub_id, person_id) VALUES (?, ?)", (item_id, pid))


def row_out(r):
    d = dict(r)
    for k in BOOL_COLUMNS & d.keys():
        d[k] = bool(d[k])
    return d


def state_payload(conn):
    st = {name: [row_out(r) for r in conn.execute(f"SELECT * FROM {name} ORDER BY created_at")]
          for name in ENTITIES}
    members = {}
    for r in conn.execute("SELECT * FROM project_people"):
        members.setdefault(r["project_id"], []).append({"person_id": r["person_id"], "role": r["role"]})
    for p in st["projects"]:
        p["members"] = members.get(p["id"], [])
    authors = {}
    for r in conn.execute("SELECT * FROM pub_people"):
        authors.setdefault(r["pub_id"], []).append(r["person_id"])
    for p in st["pubs"]:
        p["person_ids"] = authors.get(p["id"], [])
    st["today"] = dbm.today_iso()
    st["rev"] = int(dbm.get_setting(conn, "rev", "0"))
    st["examples"] = any(conn.execute(f"SELECT 1 FROM {t} WHERE example = 1 LIMIT 1").fetchone()
                         for t in ENTITIES)
    return st


def state_response(**extra):
    return jsonify(state=state_payload(get_db()), **extra)


# ---------------------------------------------------------------- infrastruttura

class AutoSecureSession(SecureCookieSessionInterface):
    def get_cookie_secure(self, app):
        mode = app.config.get("COOKIE_SECURE", "auto")
        if mode == "auto":
            try:
                return request.is_secure
            except RuntimeError:
                return False
        return mode in ("1", "true", "yes", "on")


def _load_secret(data_dir: str) -> str:
    env = os.environ.get("SECRET_KEY", "").strip()
    if env:
        return env
    path = Path(data_dir) / "secret_key"
    if path.exists():
        return path.read_text().strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(32)
    path.write_text(key)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


def create_app(db_path: str | None = None) -> Flask:
    db_path = db_path or dbm.DB_PATH
    dbm.init_db(db_path)
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DB_PATH=db_path,
        SECRET_KEY=_load_secret(os.path.dirname(os.path.abspath(db_path))),
        SESSION_COOKIE_NAME="compass_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.environ.get("SESSION_DAYS", "30"))),
        COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "auto").strip().lower(),
        MAX_CONTENT_LENGTH=2_000_000,
    )
    app.session_interface = AutoSecureSession()
    app.register_blueprint(bp)
    app.teardown_appcontext(_close_db)
    return app


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = dbm.connect(current_app.config["DB_PATH"])
    return g.db


def _close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


@contextmanager
def write_tx():
    conn = get_db()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        dbm.bump_rev(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def current_user():
    if "user" in g:
        return g.user
    user = None
    uid, ver = session.get("uid"), session.get("ver")
    if uid:
        row = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if row and row["session_version"] == ver:
            user = row
    g.user = user
    return user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            raise ApiError(401, "Sign in to continue.")
        return fn(*args, **kwargs)
    return wrapper


def body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "Invalid request: missing data.")
    return data


@bp.before_app_request
def _csrf_guard():
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.headers.get(CSRF_HEADER) != "1":
        return jsonify(error="Invalid request."), 403
    return None


@bp.after_app_request
def _security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.app_errorhandler(ApiError)
def _api_error(err):
    return jsonify(error=err.message), err.status


@bp.app_errorhandler(HTTPException)
def _http_error(err):
    if request.path.startswith("/api/"):
        messages = {404: "Not found.", 405: "Operation not allowed.", 413: "Request too large."}
        return jsonify(error=messages.get(err.code, err.description)), err.code
    return err


# ---------------------------------------------------------------- pagine statiche

@bp.get("/")
@bp.get("/index.html")
def index():
    resp = send_from_directory(STATIC_DIR, "index.html", max_age=0)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.get("/static/<path:filename>")
def static_files(filename):
    resp = send_from_directory(STATIC_DIR, filename, max_age=0)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.get("/healthz")
def healthz():
    get_db().execute("SELECT 1")
    return "ok"


# ---------------------------------------------------------------- accesso

_fails: dict[str, dict] = {}
_fails_lock = threading.Lock()


def me_out(u):
    return {"id": u["id"], "username": u["username"], "displayName": u["display_name"]}


def _local_request():
    return request.remote_addr in ("127.0.0.1", "::1")


def _setup_needed(conn):
    return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0


@bp.get("/api/setup")
def get_setup():
    return jsonify(needed=_setup_needed(get_db()))


@bp.post("/api/setup")
def do_setup():
    """First run: create the user. Only from the PC running Compass and only if there is none yet."""
    if not _local_request():
        raise ApiError(403, "The first user can only be created from the PC running Compass.")
    data = body()
    name = vstr(data.get("name"), 80)
    username = vstr(data.get("username"), 60)
    password = data.get("password") if isinstance(data.get("password"), str) else ""
    if not name:
        raise ApiError(400, "Enter your full name.")
    if not USERNAME_RE.match(username):
        raise ApiError(400, "Invalid username: 3 to 60 characters among letters, digits, dot, hyphen, @.")
    if len(password) < MIN_PASSWORD:
        raise ApiError(400, f"The password must be at least {MIN_PASSWORD} characters long.")
    with write_tx() as conn:
        if not _setup_needed(conn):
            raise ApiError(409, "Compass is already set up: sign in with your user.")
        cur = conn.execute("INSERT INTO users(username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                           (username, name, generate_password_hash(password), dbm.now_iso()))
        uid = cur.lastrowid
    row = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    session.clear()
    session.permanent = True
    session["uid"], session["ver"] = row["id"], row["session_version"]
    return jsonify(me=me_out(row))


@bp.post("/api/login")
def login():
    data = body()
    username = vstr(data.get("username"), 60)
    password = data.get("password") if isinstance(data.get("password"), str) else ""
    key = f"{username.lower()}|{request.remote_addr}"
    with _fails_lock:
        rec = _fails.get(key)
        if rec and rec["until"] > time.time():
            raise ApiError(429, "Too many failed attempts. Try again in five minutes.")
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    ok = check_password_hash(row["password_hash"] if row else _DUMMY_HASH, password) and row is not None
    if not ok:
        with _fails_lock:
            rec = _fails.setdefault(key, {"count": 0, "until": 0})
            rec["count"] += 1
            if rec["count"] >= 5:
                rec["count"], rec["until"] = 0, time.time() + 300
        raise ApiError(401, "Wrong username or password.")
    with _fails_lock:
        _fails.pop(key, None)
    session.clear()
    session.permanent = True
    session["uid"], session["ver"] = row["id"], row["session_version"]
    conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (dbm.now_iso(), row["id"]))
    conn.commit()
    return jsonify(me=me_out(row))


@bp.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@bp.get("/api/me")
@login_required
def me():
    return jsonify(me=me_out(current_user()))


@bp.post("/api/me/password")
@login_required
def change_password():
    data = body()
    user = current_user()
    if not check_password_hash(user["password_hash"], data.get("current") or ""):
        raise ApiError(400, "The current password is not correct.")
    new = data.get("new") or ""
    if len(new) < MIN_PASSWORD:
        raise ApiError(400, f"The new password must be at least {MIN_PASSWORD} characters long.")
    with write_tx() as conn:
        conn.execute("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
                     (generate_password_hash(new), user["id"]))
    session["ver"] = user["session_version"] + 1
    return jsonify(ok=True)


# ---------------------------------------------------------------- dati

@bp.get("/api/state")
@login_required
def get_state():
    return state_response()


def _entity(name):
    if name not in ENTITIES:
        raise ApiError(404, "Not found.")
    return ENTITIES[name]


@bp.post("/api/<entity>")
@login_required
def create_item(entity):
    _entity(entity)
    data = body()
    now, item_id = dbm.now_iso(), secrets.token_hex(8)
    with write_tx() as conn:
        f = _apply_virtual(entity, validate(entity, data, conn))
        if entity == "tasks" and "position" not in data:
            f["position"] = (conn.execute("SELECT MAX(position) FROM tasks").fetchone()[0] or 0) + 1
        cols = ", ".join(f)
        conn.execute(f"INSERT INTO {entity}(id, {cols}, created_at, updated_at) VALUES (?, {', '.join('?' * len(f))}, ?, ?)",
                     (item_id, *f.values(), now, now))
        _set_links(conn, entity, item_id, data)
    return state_response(id=item_id)


@bp.patch("/api/<entity>/<item_id>")
@login_required
def update_item(entity, item_id):
    _entity(entity)
    data = body()
    with write_tx() as conn:
        row = conn.execute(f"SELECT * FROM {entity} WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise ApiError(404, "Item not found: it may have been deleted. Reload the page.")
        f = _apply_virtual(entity, validate(entity, data, conn, partial=True), row)
        if f:
            sets = ", ".join(f"{k} = ?" for k in f)
            conn.execute(f"UPDATE {entity} SET {sets}, updated_at = ? WHERE id = ?", (*f.values(), dbm.now_iso(), item_id))
        _set_links(conn, entity, item_id, data)
    return state_response()


@bp.delete("/api/<entity>/<item_id>")
@login_required
def delete_item(entity, item_id):
    _entity(entity)
    with write_tx() as conn:
        if not conn.execute(f"DELETE FROM {entity} WHERE id = ?", (item_id,)).rowcount:
            raise ApiError(404, "Item not found: it may already have been deleted.")
    return state_response()


# ---------------------------------------------------------------- calendario (.ics per Outlook, Google, Apple)

def _ics_escape(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_fold(line):
    out, b = [], line.encode("utf-8")
    while len(b) > 74:
        cut = 74
        while (b[cut] & 0xC0) == 0x80:   # non spezzare un carattere UTF-8 a metà
            cut -= 1
        out.append(b[:cut].decode("utf-8"))
        b = b[cut:]
    out.append(b.decode("utf-8"))
    return "\r\n ".join(out)


@bp.get("/api/calendar.ics")
@login_required
def calendar_ics():
    """Scadenze, task e scadenze di pubblicazioni ancora aperti, come eventi di un giorno."""
    conn = get_db()
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM people")}
    projs = {r["id"]: (r["acronym"] or r["title"]) for r in conn.execute("SELECT id, title, acronym FROM projects")}
    events = []
    for r in conn.execute("SELECT * FROM deadlines WHERE done_at = ''"):
        who = " · ".join(x for x in (names.get(r["person_id"]), projs.get(r["project_id"])) if x)
        events.append((r["id"], r["due"], f"{r['title']}" + (f" ({who})" if who else ""), r["notes"]))
    for r in conn.execute("SELECT * FROM tasks WHERE status != 'done' AND due != ''"):
        who = " · ".join(x for x in (names.get(r["person_id"]), projs.get(r["project_id"])) if x)
        events.append((r["id"], r["due"], f"Task: {r['title']}" + (f" ({who})" if who else ""), r["notes"]))
    for r in conn.execute("SELECT * FROM pubs WHERE deadline != '' AND status IN ('idea', 'scrittura', 'revisione')"):
        events.append((r["id"], r["deadline"], f"Paper deadline: {r['title']}" + (f" ({r['venue']})" if r["venue"] else ""),
                       r["notes"]))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Compass//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Compass"]
    for uid, day, summary, notes in sorted(events, key=lambda e: e[1]):
        d = date.fromisoformat(day)
        lines += ["BEGIN:VEVENT", f"UID:{uid}@compass", f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{d:%Y%m%d}",
                  f"DTEND;VALUE=DATE:{d + timedelta(days=1):%Y%m%d}", _ics_fold("SUMMARY:" + _ics_escape(summary))]
        if notes:
            lines.append(_ics_fold("DESCRIPTION:" + _ics_escape(notes[:1000])))
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines) + "\r\n", mimetype="text/calendar",
                    headers={"Content-Disposition": 'attachment; filename="Compass-deadlines.ics"'})


# ---------------------------------------------------------------- dati di esempio

@bp.post("/api/examples")
@login_required
def load_examples():
    import examples
    with write_tx() as conn:
        if any(conn.execute(f"SELECT 1 FROM {t} WHERE example = 1 LIMIT 1").fetchone() for t in ENTITIES):
            raise ApiError(409, "Sample data is already loaded.")
        examples.load(conn, dbm.today_iso(), dbm.now_iso())
    return state_response()


@bp.delete("/api/examples")
@login_required
def clear_examples():
    with write_tx() as conn:
        for t in ("tasks", "meetings", "deadlines", "pubs", "expenses", "contacts", "projects", "people"):
            conn.execute(f"DELETE FROM {t} WHERE example = 1")
    return state_response()


# ---------------------------------------------------------------- stato completo: esporta e importa

ARCHIVE_MAX = 64_000_000
ARCHIVE_TABLES = ("users", "settings") + tuple(reversed(dbm.DATA_TABLES))   # ordine di inserimento
SQLITE_MAGIC = b"SQLite format 3\x00"


def _archive_copy(dest_path):
    src = get_db()
    dst = sqlite3.connect(dest_path)
    try:
        src.backup(dst)
        dst.execute("PRAGMA journal_mode=DELETE")
        dst.commit()
    finally:
        dst.close()


@bp.get("/api/archive")
@login_required
def export_archive():
    """All of Compass in one .compass file (the SQLite database): to move it to another PC or keep a copy."""
    folder = os.path.dirname(os.path.abspath(current_app.config["DB_PATH"]))
    fd, tmp = tempfile.mkstemp(suffix=".compass", dir=folder)
    os.close(fd)
    try:
        _archive_copy(tmp)
        conn = sqlite3.connect(tmp)
        try:
            for k, v in (("exported_at", dbm.now_iso()), ("exported_by", current_user()["display_name"])):
                conn.execute("INSERT INTO settings(key, value) VALUES (?, ?) "
                             "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, v))
            conn.commit()
            conn.execute("VACUUM")
        finally:
            conn.close()
        data = Path(tmp).read_bytes()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    name = f"Compass-backup-{datetime.now(dbm.TZ):%Y-%m-%d-%H%M}.compass"
    return Response(data, mimetype="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


def _check_archive(path):
    try:
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        try:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ApiError(400, "The file is damaged: try another backup.")
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if not set(ARCHIVE_TABLES) <= tables:
                raise ApiError(400, "The file is a database, but not a Compass one.")
            version = int(dbm.get_setting(conn, "schema_version", "1") or 1)
            for kind, name in conn.execute("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'view')").fetchall():
                conn.execute(f'DROP {kind.upper()} IF EXISTS "{name.replace(chr(34), chr(34) * 2)}"')
            conn.commit()
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        raise ApiError(400, "The file is damaged or not a Compass file.")
    if version > dbm.SCHEMA_VERSION:
        raise ApiError(409, "The file comes from a newer version of Compass: update Compass on this PC and try again.")
    dbm.init_db(path)
    conn = dbm.connect(path)
    try:
        conn.execute("PRAGMA journal_mode=DELETE")
        if not conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
            raise ApiError(400, "The file contains no user: you would not be able to sign in after importing it.")
        count = lambda t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]  # noqa: E731
        return {"people": count("people"), "projects": count("projects"), "tasks": count("tasks"),
                "exportedAt": dbm.get_setting(conn, "exported_at", ""),
                "exportedBy": dbm.get_setting(conn, "exported_by", "")}
    finally:
        conn.close()


def _safety_copy():
    conn = get_db()
    if not any(conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone() for t in ("people", "projects", "tasks", "pubs")):
        return None
    folder = Path(os.environ.get("COMPASS_BACKUP_DIR") or
                  Path(os.path.dirname(os.path.abspath(current_app.config["DB_PATH"]))) / "backup")
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"compass-{datetime.now(dbm.TZ):%Y%m%d-%H%M%S}-before-import.sqlite3"
    _archive_copy(str(dest))
    return dest


def _replace_all(path):
    conn = get_db()
    conn.execute("ATTACH DATABASE ? AS imp", (path,))
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("PRAGMA defer_foreign_keys = ON")
            old_rev = int(dbm.get_setting(conn, "rev", "0") or 0)
            for t in reversed(ARCHIVE_TABLES):
                conn.execute(f"DELETE FROM main.{t}")
            for t in ARCHIVE_TABLES:
                cols = ", ".join(r["name"] for r in conn.execute(f"PRAGMA main.table_info({t})"))
                conn.execute(f"INSERT INTO main.{t}({cols}) SELECT {cols} FROM imp.{t}")
            conn.execute("UPDATE users SET session_version = session_version + ?", (1000 + secrets.randbelow(10**6),))
            for k in ("exported_at", "exported_by"):
                conn.execute("DELETE FROM settings WHERE key = ?", (k,))
            dbm.set_setting(conn, "rev", max(old_rev, int(dbm.get_setting(conn, "rev", "0") or 0)) + 1)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    finally:
        conn.execute("DETACH DATABASE imp")
    key = secrets.token_hex(32)
    if not os.environ.get("SECRET_KEY", "").strip():
        (Path(os.path.dirname(os.path.abspath(current_app.config["DB_PATH"]))) / "secret_key").write_text(key)
    current_app.secret_key = key
    session.clear()


def _import_archive():
    request.max_content_length = ARCHIVE_MAX
    raw = request.get_data(cache=False)
    if not raw:
        raise ApiError(400, "The file is empty.")
    if not raw.startswith(SQLITE_MAGIC):
        raise ApiError(400, "This is neither a Compass file (.compass) nor a backup (.sqlite3).")
    folder = os.path.dirname(os.path.abspath(current_app.config["DB_PATH"]))
    fd, tmp = tempfile.mkstemp(suffix=".compass", dir=folder)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        info = _check_archive(tmp)
        backup = _safety_copy()
        _replace_all(tmp)
    finally:
        for p in (tmp, tmp + "-journal", tmp + "-wal", tmp + "-shm"):
            try:
                os.remove(p)
            except OSError:
                pass
    info["backup"] = str(backup) if backup else ""
    return jsonify(imported=info)


@bp.post("/api/archive")
@login_required
def import_archive():
    return _import_archive()


@bp.post("/api/setup/import")
def setup_import():
    """Primo avvio sul PC nuovo: si importa lo stato invece di creare l'utente."""
    if not _local_request():
        raise ApiError(403, "Importing at first run is only possible from the PC running Compass.")
    if not _setup_needed(get_db()):
        raise ApiError(409, "Compass is already set up: sign in and import from Settings.")
    return _import_archive()


app = create_app() if os.environ.get("COMPASS_NO_AUTOAPP") != "1" else None
