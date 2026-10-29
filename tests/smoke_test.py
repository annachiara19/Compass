"""Basic API tests for Compass: python tests/smoke_test.py (from the project folder)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["COMPASS_NO_AUTOAPP"] = "1"

import app as appmod  # noqa: E402

H = {"X-Compass": "1"}
OCT = {**H, "Content-Type": "application/octet-stream"}


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("ok  ", msg)


def main():
    tmp = tempfile.mkdtemp()
    app = appmod.create_app(os.path.join(tmp, "compass.sqlite3"))
    c = app.test_client()
    check(c.get("/api/state").status_code == 401, "senza accesso i dati non si leggono")
    check(c.get("/api/setup").json == {"needed": True}, "primo avvio richiesto")
    check(c.post("/api/setup", json={"name": "A", "username": "anna", "password": "corta"}, headers=H).status_code == 400,
          "password corta rifiutata")
    check(c.post("/api/setup", json={"name": "A", "username": "anna", "password": "password-lunga-1"}).status_code == 403,
          "senza header anti-CSRF: rifiutato")
    check(c.post("/api/setup", json={"name": "A", "username": "anna", "password": "password-lunga-1"}, headers=H,
                 environ_base={"REMOTE_ADDR": "10.1.1.1"}).status_code == 403, "primo avvio solo da questo PC")
    r = c.post("/api/setup", json={"name": "Annachiara", "username": "anna", "password": "password-lunga-1"}, headers=H)
    check(r.status_code == 200 and c.get("/api/state").status_code == 200, "primo avvio: utente creato e accesso fatto")
    check(c.post("/api/setup", json={"name": "X", "username": "altro", "password": "password-lunga-1"}, headers=H).status_code == 409,
          "primo avvio non ripetibile")

    # persone
    r = c.post("/api/people", json={"name": "Mario Rossi", "kind": "dottorando", "ciclo": "XL", "start": "2025-11-01"}, headers=H)
    check(r.status_code == 200 and r.json["state"]["people"][0]["name"] == "Mario Rossi", "crea persona")
    pid = r.json["id"]
    check(c.post("/api/people", json={"name": ""}, headers=H).status_code == 400, "nome obbligatorio")
    check(c.post("/api/people", json={"name": "X", "kind": "boh"}, headers=H).status_code == 400, "tipo non ammesso")
    check(c.post("/api/people", json={"name": "X", "start": "31/12/2025"}, headers=H).status_code == 400, "data non valida")
    check(c.post("/api/people", json={"name": "X", "email": "nonvalida"}, headers=H).status_code == 400, "email non valida")
    r = c.patch(f"/api/people/{pid}", json={"archived": True}, headers=H)
    p = r.json["state"]["people"][0]
    check(p["archived"] is True and p["ciclo"] == "XL", "modifica parziale: archivia, il resto resta")

    # progetti, persone coinvolte, contatti, spese
    r = c.post("/api/projects", json={"title": "Progetto Acme", "kind": "aziendale", "budget_cents": "12.500,50",
                                      "members": [{"person_id": pid, "role": "Dottorando"}, {"person_id": "nessuno"}]}, headers=H)
    prj = r.json["state"]["projects"][0]
    check(prj["budget_cents"] == 1250050 and prj["members"] == [{"person_id": pid, "role": "Dottorando"}],
          "progetto con budget all'italiana e persone (id inesistenti ignorati)")
    prj_id = prj["id"]
    check(c.post("/api/contacts", json={"project_id": prj_id, "name": "Ing. Neri"}, headers=H).status_code == 200, "contatto")
    check(c.post("/api/contacts", json={"name": "Senza progetto"}, headers=H).status_code == 400, "contatto senza progetto rifiutato")
    r = c.post("/api/expenses", json={"project_id": prj_id, "date": "2026-01-10", "item": "FPGA", "amount_cents": 4200.5}, headers=H)
    check(r.json["state"]["expenses"][0]["amount_cents"] == 420050, "spesa in euro → centesimi")
    check(c.post("/api/expenses", json={"project_id": prj_id, "date": "2026-01-10", "item": "x", "amount_cents": "dieci"},
                 headers=H).status_code == 400, "importo non valido")

    # scadenze: done → done_at
    r = c.post("/api/deadlines", json={"person_id": pid, "title": "Valutazione annuale", "due": "2026-11-20"}, headers=H)
    did = r.json["id"]
    r = c.patch(f"/api/deadlines/{did}", json={"done": True}, headers=H)
    d = next(x for x in r.json["state"]["deadlines"] if x["id"] == did)
    check(d["done_at"] != "", "scadenza completata: data di completamento")
    r = c.patch(f"/api/deadlines/{did}", json={"done": False}, headers=H)
    check(next(x for x in r.json["state"]["deadlines"] if x["id"] == did)["done_at"] == "", "scadenza riaperta")
    check(c.post("/api/deadlines", json={"title": "x"}, headers=H).status_code == 400, "scadenza senza data rifiutata")

    # incontri e pubblicazioni
    check(c.post("/api/meetings", json={"person_id": pid, "date": "2026-10-01", "notes": "ok"}, headers=H).status_code == 200,
          "incontro")
    r = c.post("/api/pubs", json={"title": "Paper", "status": "sottomesso", "person_ids": [pid], "project_id": prj_id}, headers=H)
    check(r.json["state"]["pubs"][0]["person_ids"] == [pid], "pubblicazione con autori interni")

    # task
    r = c.post("/api/tasks", json={"title": "Rivedere tesi", "due": "2026-11-01", "person_id": pid}, headers=H)
    tid = r.json["id"]
    t = r.json["state"]["tasks"][0]
    check(t["status"] == "todo" and t["position"] == 1, "task: stato e posizione iniziali")
    r = c.patch(f"/api/tasks/{tid}", json={"status": "done"}, headers=H)
    check(r.json["state"]["tasks"][0]["done_at"] != "", "task completato")
    r = c.patch(f"/api/tasks/{tid}", json={"status": "doing", "position": 0.5}, headers=H)
    t = r.json["state"]["tasks"][0]
    check(t["done_at"] == "" and t["position"] == 0.5, "task spostato sulla bacheca")
    check(c.patch("/api/tasks/nessuno", json={"title": "x"}, headers=H).status_code == 404, "task inesistente: 404")
    check(c.post("/api/segreti", json={}, headers=H).status_code == 404, "entità sconosciuta: 404")

    # calendario
    r = c.get("/api/calendar.ics")
    check(r.status_code == 200 and b"BEGIN:VCALENDAR" in r.data and b"Valutazione annuale" in r.data, "calendario .ics")

    # cancellazioni a cascata
    r = c.delete(f"/api/people/{pid}", headers=H)
    st = r.json["state"]
    check(not st["deadlines"] and not st["meetings"] and st["tasks"][0]["person_id"] is None
          and st["projects"][0]["members"] == [] and st["pubs"][0]["person_ids"] == [],
          "eliminare una persona: via tappe e incontri, i task restano senza persona")
    r = c.delete(f"/api/projects/{prj_id}", headers=H)
    st = r.json["state"]
    check(not st["contacts"] and not st["expenses"] and st["pubs"][0]["project_id"] is None, "eliminare un progetto")

    # esempi
    r = c.post("/api/examples", json={}, headers=H)
    st = r.json["state"]
    check(r.status_code == 200 and len(st["people"]) == 6 and len(st["projects"]) == 3 and st["examples"], "dati di esempio")
    check(c.post("/api/examples", json={}, headers=H).status_code == 409, "esempi non duplicati")

    # stato completo
    arch = c.get("/api/archive")
    check(arch.status_code == 200 and arch.data.startswith(b"SQLite format 3"), "export .compass backup")
    app2 = appmod.create_app(os.path.join(tmp, "nuovo", "compass.sqlite3"))
    n = app2.test_client()
    import sqlite3
    raw = os.path.join(tmp, "export.compass")
    with open(raw, "wb") as f:
        f.write(arch.data)
    with sqlite3.connect(raw) as x:
        n_users = x.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    check(n_users == 0 and b"scrypt" not in arch.data and b"anna" not in arch.data, "l'export non contiene utenti né password")
    check(n.post("/api/archive", data=arch.data, headers=OCT).status_code == 401, "import senza accesso: rifiutato")
    n.post("/api/setup", json={"name": "Mario", "username": "mario", "password": "password-mario-1"}, headers=H)
    r = n.post("/api/archive", data=arch.data, headers=OCT)
    check(r.status_code == 200 and r.json["imported"]["people"] == 6, "altra persona: importa i dati nel suo Compass")
    st = n.get("/api/state")
    check(st.status_code == 200 and len(st.json["state"]["tasks"]) >= 10, "dopo l'import resta collegata, dati presenti")
    n.post("/api/logout", json={}, headers=H)
    check(n.post("/api/login", json={"username": "mario", "password": "password-mario-1"}, headers=H).status_code == 200,
          "dopo l'import vale ancora la sua password")
    check(n.post("/api/login", json={"username": "anna", "password": "password-lunga-1"}, headers=H).status_code == 401,
          "l'utente di chi ha esportato non arriva")
    check(n.post("/api/archive", data=b"ciao", headers=OCT).status_code == 400, "file non valido rifiutato")

    r = c.delete("/api/examples", json={}, headers=H)
    st = r.json["state"]
    check(not st["people"] and not st["examples"], "esempi eliminati")
    check(c.post("/api/me/password", json={"current": "password-lunga-1", "new": "nuova-password-2"}, headers=H).status_code == 200,
          "cambio password")
    c.post("/api/logout", json={}, headers=H)
    check(c.post("/api/login", json={"username": "anna", "password": "password-lunga-1"}, headers=H).status_code == 401,
          "la vecchia password non vale più")
    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
