"""Compass — local launcher (Windows).

Double-click the Compass icon (created by "Install Compass.bat"):
  * if Compass is already running, it just opens the browser;
  * otherwise it backs up the database, starts Compass on this PC (http://127.0.0.1:8797)
    and opens the browser; a small window shows that Compass is running.
Closing the window takes another backup and stops Compass. The last 30 copies are kept.

Data lives in %LOCALAPPDATA%\\Compass (database, settings, log), outside the program folder:
updating the program never touches the data. Compass only answers this PC (127.0.0.1).
Data from earlier versions (Bussola, GRiP) is picked up automatically on first start.

To try it without the window:  py compass_launcher.pyw --no-window
"""
import json
import os
import socket
import sqlite3
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

APP_NAME = "Compass"
APP_DIR = Path(__file__).resolve().parent
HOME = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".local" / "share")) / APP_NAME
DATA_DIR = HOME / "data"
DB_FILE = DATA_DIR / "compass.sqlite3"
CONFIG_FILE = HOME / "settings.json"
LOCK_FILE = HOME / "running.json"
LOG_FILE = HOME / "compass.log"
DEFAULT_PORT = 8797
KEEP_BACKUPS = 30


# ---------------------------------------------------------------- helpers

def setup_logging():
    HOME.mkdir(parents=True, exist_ok=True)
    # with pythonw there is no console: everything printed goes to the log
    if sys.stdout is None or sys.stderr is None or "--log" in sys.argv:
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > 2_000_000:
            LOG_FILE.replace(LOG_FILE.with_suffix(".log.1"))
        f = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = f
    print(f"\n--- {datetime.now():%Y-%m-%d %H:%M:%S} starting Compass from {APP_DIR}")


def load_config():
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    HOME.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def backup_dir(cfg):
    return Path(cfg.get("backup_folder") or (HOME / "backup"))


def url_for(port):
    return f"http://127.0.0.1:{port}/"


def is_compass(port, timeout=1.5):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=timeout) as r:
            return r.status == 200 and r.read().strip() == b"ok"
    except OSError:
        return False


def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if os.name != "nt":  # on Linux/macOS a just-closed port stays "busy" for a while without this option
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def pick_port(preferred):
    for p in [preferred] + list(range(DEFAULT_PORT, DEFAULT_PORT + 50)):
        if port_free(p):
            return p
    raise RuntimeError("No free port between 8797 and 8846.")


def already_running():
    try:
        info = json.loads(LOCK_FILE.read_text(encoding="utf-8"))
        port = int(info["port"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return port if is_compass(port) else None


# ---------------------------------------------------------------- dati e backup

def import_previous_version():
    """If Compass is still empty and data from an earlier version exists (Bussola, then GRiP), bring it here."""
    if DB_FILE.exists():
        return None
    for name, db in (("Bussola", "bussola.sqlite3"), ("GRiP", "grip.sqlite3")):
        old = HOME.parent / name / "data" / db
        if old.exists():
            copy_db(old, DB_FILE)
            key = old.parent / "secret_key"
            if key.exists():
                (DATA_DIR / "secret_key").write_bytes(key.read_bytes())
            print(f"data imported from {old}")
            return name
    return None


def copy_db(src, dest):
    """Consistent copy of a SQLite database, even while in use."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    s = sqlite3.connect(str(src))
    d = sqlite3.connect(str(dest))
    try:
        with d:
            s.backup(d)
    finally:
        d.close()
        s.close()


def make_backup(cfg, reason="start"):
    if not DB_FILE.exists():
        return None
    folder = backup_dir(cfg)
    dest = folder / f"compass-{datetime.now():%Y%m%d-%H%M%S}-{reason}.sqlite3"
    copy_db(DB_FILE, dest)
    # the name holds date and time (compass-YYYYMMDD-HHMMSS-…): alphabetical order is chronological
    copies = sorted((p for p in folder.glob("compass-*.sqlite3") if p != dest), key=lambda p: p.name, reverse=True)
    for old in copies[KEEP_BACKUPS - 1:]:
        try:
            old.unlink()
        except OSError:
            pass
    cfg["last_backup"] = datetime.now().isoformat(timespec="seconds")
    cfg["last_backup_file"] = str(dest)
    save_config(cfg)
    print(f"backup: {dest}")
    return dest


# ---------------------------------------------------------------- server

def start_server(port):
    os.environ["DB_PATH"] = str(DB_FILE)
    os.environ["COOKIE_SECURE"] = "0"
    os.environ.setdefault("SESSION_DAYS", "30")
    sys.path.insert(0, str(APP_DIR))
    import app as compass_app          # creates the database on first run
    from waitress import serve

    t = threading.Thread(target=serve, args=(compass_app.app,),
                         kwargs={"host": "127.0.0.1", "port": port, "threads": 6, "ident": APP_NAME,
                                 "_quiet": True},
                         daemon=True)
    t.start()
    for _ in range(100):
        if is_compass(port, timeout=0.5):
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("Compass did not start in time.")
    LOCK_FILE.write_text(json.dumps({"port": port, "pid": os.getpid(),
                                     "started": datetime.now().isoformat(timespec="seconds")}), encoding="utf-8")
    print(f"Compass running on {url_for(port)}")


def clear_lock():
    try:
        info = json.loads(LOCK_FILE.read_text(encoding="utf-8"))
        if info.get("pid") == os.getpid():
            LOCK_FILE.unlink()
    except (OSError, ValueError):
        pass


# ---------------------------------------------------------------- finestra

def run_window(port, cfg):
    import tkinter as tk
    from tkinter import filedialog, messagebox

    BLU, CHIARO, INCHIOSTRO, GRIGIO = "#0F6B66", "#F4F6F5", "#16211F", "#56635F"
    root = tk.Tk()
    root.title(APP_NAME)
    root.configure(bg=CHIARO)
    root.resizable(False, False)
    try:
        root.iconbitmap(default=str(APP_DIR / "compass.ico"))
    except tk.TclError:
        pass
    try:
        logo = tk.PhotoImage(file=str(APP_DIR / "static" / "icons" / "compass-64.png"))
        root.iconphoto(True, logo)
    except tk.TclError:
        logo = None

    pad = {"padx": 18}
    head = tk.Frame(root, bg=CHIARO)
    head.pack(fill="x", pady=(16, 6), **pad)
    if logo:
        tk.Label(head, image=logo, bg=CHIARO).pack(side="left", padx=(0, 12))
    titles = tk.Frame(head, bg=CHIARO)
    titles.pack(side="left")
    tk.Label(titles, text="Compass", font=("Segoe UI", 18, "bold"), fg=INCHIOSTRO, bg=CHIARO).pack(anchor="w")
    tk.Label(titles, text="Research and people management", font=("Segoe UI", 9), fg=GRIGIO, bg=CHIARO).pack(anchor="w")

    status = tk.Label(root, text=f"● Running on this PC — {url_for(port)}", font=("Segoe UI", 9),
                      fg="#256F45", bg=CHIARO, anchor="w")
    status.pack(fill="x", pady=(4, 10), **pad)

    def open_browser():
        webbrowser.open(url_for(port))

    tk.Button(root, text="Open Compass", command=open_browser, font=("Segoe UI", 11, "bold"),
              bg=BLU, fg="white", activebackground="#0B5450", activeforeground="white",
              relief="flat", padx=16, pady=7, cursor="hand2").pack(fill="x", **pad)

    backup_info = tk.Label(root, font=("Segoe UI", 9), fg=GRIGIO, bg=CHIARO, justify="left", anchor="w", wraplength=330)
    backup_info.pack(fill="x", pady=(14, 4), **pad)

    def refresh_backup_info():
        folder = backup_dir(cfg)
        when = cfg.get("last_backup")
        txt = f"Last backup: {datetime.fromisoformat(when):%d/%m/%Y %H:%M}" if when else "No backup yet."
        txt += f"\nFolder: {folder}"
        if str(folder).startswith(str(HOME)):
            txt += "\nNote: backups are on this same PC. Choose a network folder or your university cloud."
        backup_info.config(text=txt)

    def do_backup():
        try:
            make_backup(cfg, "manual")
            refresh_backup_info()
            messagebox.showinfo(APP_NAME, "Backup done.")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            messagebox.showerror(APP_NAME, f"Backup failed:\n{e}")

    def choose_folder():
        folder = filedialog.askdirectory(title="Choose the Compass backup folder",
                                         initialdir=str(backup_dir(cfg)), mustexist=True)
        if folder:
            cfg["backup_folder"] = folder
            save_config(cfg)
            os.environ["COMPASS_BACKUP_DIR"] = folder
            do_backup()

    def open_folder():
        folder = backup_dir(cfg)
        folder.mkdir(parents=True, exist_ok=True)
        if hasattr(os, "startfile"):
            os.startfile(str(folder))  # type: ignore[attr-defined]
        else:
            webbrowser.open(folder.as_uri())

    row = tk.Frame(root, bg=CHIARO)
    row.pack(fill="x", pady=(2, 4), **pad)
    for label, cmd in (("Back up now", do_backup), ("Choose folder…", choose_folder), ("Open folder", open_folder)):
        tk.Button(row, text=label, command=cmd, font=("Segoe UI", 9), relief="groove", padx=8, pady=3,
                  cursor="hand2").pack(side="left", padx=(0, 6))

    tk.Label(root, text="Closing this window stops Compass.", font=("Segoe UI", 8), fg=GRIGIO,
             bg=CHIARO).pack(anchor="w", pady=(10, 14), **pad)

    def on_close():
        try:
            make_backup(cfg, "close")
        except Exception:  # noqa: BLE001  — a failed closing backup must not block closing
            traceback.print_exc()
        clear_lock()
        root.destroy()
        os._exit(0)

    root.protocol("WM_DELETE_WINDOW", on_close)
    refresh_backup_info()
    root.after(300, open_browser)
    root.mainloop()


def show_error(msg):
    print(msg)
    try:
        import tkinter as tk
        from tkinter import messagebox
        r = tk.Tk()
        r.withdraw()
        messagebox.showerror(APP_NAME, msg)
        r.destroy()
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------- main

def main():
    setup_logging()
    headless = "--no-window" in sys.argv or "--senza-finestra" in sys.argv
    running = already_running()
    if running:
        print("Compass is already running: opening the browser")
        if not headless:
            webbrowser.open(url_for(running))
        return 0
    cfg = load_config()
    try:
        previous = import_previous_version()
        if previous:
            cfg["imported_from"] = previous
            save_config(cfg)
        make_backup(cfg, "start")
        os.environ["COMPASS_BACKUP_DIR"] = str(backup_dir(cfg))   # the copy taken before an import goes there too
        port = pick_port(int(cfg.get("port", DEFAULT_PORT)))
        cfg["port"] = port
        save_config(cfg)
        start_server(port)
    except ModuleNotFoundError as e:
        show_error(f"A component is missing ({e.name}). Run \"Install Compass.bat\" again from the program folder.")
        return 1
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        show_error(f"Compass did not start:\n{e}\n\nDetails in {LOG_FILE}")
        return 1
    if headless:
        print("press Ctrl+C to stop")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        clear_lock()
        return 0
    try:
        run_window(port, cfg)
    except Exception as e:  # noqa: BLE001  (e.g. Tk missing)
        traceback.print_exc()
        webbrowser.open(url_for(port))
        show_error(f"The Compass window could not open ({e}), but Compass is running on {url_for(port)}.")
        while True:
            time.sleep(3600)
    return 0


if __name__ == "__main__":
    sys.exit(main())
