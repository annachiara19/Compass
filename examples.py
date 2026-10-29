"""Sample data to try Compass. Dates are relative to today; everything is marked example = 1."""
import secrets
from datetime import date, timedelta


def load(conn, today, now):
    t0 = date.fromisoformat(today)

    def T(n):
        return (t0 + timedelta(days=n)).isoformat()

    def ins(table, **f):
        f.setdefault("id", secrets.token_hex(8))
        f.update(example=1, created_at=now, updated_at=now)
        conn.execute(f"INSERT INTO {table}({', '.join(f)}) VALUES ({', '.join('?' * len(f))})", tuple(f.values()))
        return f["id"]

    # people
    marco = ins("people", name="Marco Bianco", kind="dottorando", ciclo="XXXIX", funding="PNRR scholarship",
                topic="Statistical fault injection on DNN accelerators", email="marco.bianco@example.it",
                start=T(-700), end=T(395), cosupervisors="Prof. R. Sala")
    elisa = ins("people", name="Elisa Ferri", kind="dottorando", ciclo="XL", funding="University scholarship",
                topic="Reliability of spiking neural networks on digital hardware", email="elisa.ferri@example.it",
                start=T(-340), end=T(755))
    luca = ins("people", name="Luca Moretti", kind="magistrale", matricola="s312456",
               topic="Industrial thesis: fault models for automotive SoCs", email="s312456@example.it",
               start=T(-120), end=T(60), cosupervisors="Eng. P. Neri (Acme)")
    sofia = ins("people", name="Sofia Ricci", kind="magistrale", matricola="s318901",
                topic="Software mitigation of soft errors in quantized CNNs", start=T(-40), end=T(200))
    giorgio = ins("people", name="Giorgio Conti", kind="triennale", matricola="s331022",
                  topic="Fault injection campaign on a RISC-V core", start=T(-20), end=T(90))
    anna = ins("people", name="Anna Galli", kind="assegnista", funding="SAFE-EDGE research grant",
               topic="Formal verification of accelerators", start=T(-200), end=T(530))

    # projects
    rel = ins("projects", title="Reliability of AI accelerators for automotive", acronym="REL-AI", kind="aziendale",
              partner="Acme Semiconductors S.p.A.", contract="Research contract no. 2025/118", status="attivo",
              start=T(-150), end=T(215), budget_cents=6000000)
    safe = ins("projects", title="Safe and efficient edge AI", acronym="SAFE-EDGE", kind="europeo",
               partner="Horizon Europe, 9 partners", contract="GA 101xxxxxx", status="attivo",
               start=T(-540), end=T(555), budget_cents=24500000)
    prin = ins("projects", title="Neuromorphic dependability", acronym="PRIN 2026", kind="nazionale",
               partner="Italian Ministry of University and Research", status="proposta", start=T(150), end=T(880),
               budget_cents=18000000)
    for pid, person, role in ((rel, marco, "PhD student"), (rel, luca, "Thesis student"), (safe, elisa, "PhD student"),
                              (safe, anna, "Research fellow"), (prin, elisa, "PhD student"), (rel, sofia, "Thesis student")):
        conn.execute("INSERT INTO project_people(project_id, person_id, role) VALUES (?, ?, ?)", (pid, person, role))
    ins("contacts", project_id=rel, name="Eng. Paolo Neri", role="Technical lead", email="p.neri@acme.example")
    ins("contacts", project_id=rel, name="Dr. Carla Russo", role="Administration and contracts", email="c.russo@acme.example")
    ins("contacts", project_id=safe, name="Dr. Jan Vermeer", role="Coordinator", email="j.vermeer@uni.example")
    for pid, d, item, cat, eur in ((rel, T(-90), "FPGA evaluation board", "attrezzature", 4200),
                                   (rel, T(-30), "Kick-off trip to Munich", "missioni", 780),
                                   (safe, T(-300), "Research fellowship (yearly share)", "personale", 25000),
                                   (safe, T(-120), "GPU workstation", "attrezzature", 6900),
                                   (safe, T(-15), "DATE conference: registration and travel", "missioni", 1450)):
        ins("expenses", project_id=pid, date=d, item=item, category=cat, amount_cents=eur * 100)

    # deadlines and milestones
    for person, project, title, kind, due, done in (
            (marco, None, "PhD annual review", "tappa", T(20), ""),
            (marco, None, "PhD thesis submission", "tappa", T(330), ""),
            (elisa, None, "Research stay abroad starts (TU Delft)", "tappa", T(45), ""),
            (elisa, None, "First-year training plan", "tappa", T(-60), T(-62)),
            (luca, None, "Master's thesis submission", "tappa", T(35), ""),
            (luca, None, "Graduation", "tappa", T(58), ""),
            (giorgio, None, "Final report submission", "tappa", T(80), ""),
            (None, rel, "D2.1 Report on fault models", "deliverable", T(12), ""),
            (None, rel, "Progress meeting with the company", "scadenza", T(26), ""),
            (None, safe, "M18 periodic report", "report", T(28), ""),
            (None, safe, "First-period cost statement", "rendicontazione", T(55), ""),
            (None, safe, "D3.2 Reliability benchmark", "deliverable", T(-25), T(-27)),
            (None, prin, "PRIN proposal submission", "scadenza", T(40), "")):
        ins("deadlines", person_id=person, project_id=project, title=title, kind=kind, due=due, done_at=done)

    # meetings
    ins("meetings", person_id=marco, project_id=rel, date=T(-7), title="Fault injection campaign progress",
        notes="Results on layer 3 match the model. Simulation time is still high.",
        next_steps="Try stratified sampling.\nDraft the results for DATE.")
    ins("meetings", person_id=luca, date=T(-3), title="Chapter 2 review",
        notes="State of the art is fine; the comparison with 2025 work is missing.",
        next_steps="Add a comparison table.\nSend chapter 3 within two weeks.")
    ins("meetings", person_id=elisa, date=T(-14), title="Planning the stay abroad",
        notes="Contact with the Delft group confirmed.", next_steps="Prepare the invitation letter.")
    ins("meetings", person_id=sofia, date=T(-10), title="Thesis goals",
        notes="Focus on 8-bit quantized CNNs.", next_steps="Read the three suggested papers.")
    ins("meetings", project_id=safe, date=T(-21), title="Monthly consortium call",
        notes="WP3 on track. Next review in February.", next_steps="Update the risk register.")

    # publications
    p1 = ins("pubs", title="Statistical fault injection for transformer accelerators", authors="M. Bianco, A. Galli, et al.",
             venue="DATE 2027", kind="conferenza", status="scrittura", deadline=T(18), year=str(t0.year + 1), project_id=rel)
    p2 = ins("pubs", title="Reliability of spiking neural networks on digital neuromorphic hardware",
             authors="E. Ferri, et al.", venue="IEEE Transactions on Computers", kind="rivista", status="revisione",
             deadline=T(9), year=str(t0.year), project_id=safe)
    p3 = ins("pubs", title="Fast fault-model selection for edge AI", authors="A. Galli, M. Bianco, et al.",
             venue="IOLTS", kind="conferenza", status="pubblicato", year=str(t0.year), project_id=safe)
    p4 = ins("pubs", title="Software hardening of quantized CNNs", authors="S. Ricci, et al.", venue="to be decided",
             kind="workshop", status="idea")
    for pub, person in ((p1, marco), (p1, anna), (p2, elisa), (p3, anna), (p3, marco), (p4, sofia)):
        conn.execute("INSERT INTO pub_people(pub_id, person_id) VALUES (?, ?)", (pub, person))

    # tasks
    pos = 0
    for title, status, prio, due, person, project in (
            ("Sign Elisa's training plan", "todo", "alta", T(-1), elisa, None),
            ("Review chapter 2 of Luca's thesis", "todo", "normale", T(2), luca, None),
            ("Prepare slides for the SAFE-EDGE review", "todo", "normale", T(6), None, safe),
            ("Reply to the IEEE TC reviewers", "doing", "alta", T(9), elisa, safe),
            ("Send the D2.1 report to the company", "todo", "alta", T(11), None, rel),
            ("Write the introduction of the DATE paper", "doing", "normale", T(15), marco, rel),
            ("Order a second FPGA board", "todo", "bassa", "", None, rel),
            ("Find a co-supervisor for Giorgio's thesis", "todo", "normale", T(4), giorgio, None),
            ("Invitation letter for Delft", "done", "normale", T(-5), elisa, None),
            ("Close the minutes of the consortium call", "done", "bassa", T(-18), None, safe)):
        pos += 1
        ins("tasks", title=title, status=status, priority=prio, due=due, person_id=person, project_id=project,
            position=pos, done_at=(T(-6) if status == "done" else ""))
