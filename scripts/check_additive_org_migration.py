"""Simulated additive SQLite migration and backup/restore rehearsal.

NOT an actual Telegram Serverless database migration or live backup.
The official tgcloud dry-run and real backup must be verified separately.
"""
import sqlite3
import tempfile
from pathlib import Path

OLD_SCHEMA = """
CREATE TABLE organizations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, owner_tg_id INTEGER NOT NULL UNIQUE,
 name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
 created_at INTEGER NOT NULL
);
CREATE TABLE shifts (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL,
 employee_id INTEGER NOT NULL, started_at INTEGER NOT NULL);
"""

ADDITIVE_SCHEMA = """
CREATE TABLE organization_memberships (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 org_id INTEGER NOT NULL,
 user_tg_id INTEGER NOT NULL,
 role TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 created_by INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_org_membership_org_user
 ON organization_memberships (org_id, user_tg_id);
CREATE INDEX idx_org_membership_actor
 ON organization_memberships (user_tg_id, status);
CREATE TABLE user_organization_selections (
 user_tg_id INTEGER PRIMARY KEY,
 org_id INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE onboarding_sessions (
 user_tg_id INTEGER PRIMARY KEY,
 phase TEXT NOT NULL,
 request_id INTEGER,
 expires_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
"""

def initialize(db):
    db.executescript(OLD_SCHEMA)
    db.execute("INSERT INTO organizations (id,owner_tg_id,name,created_at) VALUES (?,?,?,?)",
               (42, 7654321, "Магазин", 123))
    db.execute("INSERT INTO shifts (id,org_id,employee_id,started_at) VALUES (?,?,?,?)",
               (11, 42, 9, 100))
    sql_before = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='organizations'"
    ).fetchone()[0]
    db.executescript(ADDITIVE_SCHEMA)
    assert db.execute("SELECT id,owner_tg_id,name FROM organizations").fetchall() == [
        (42, 7654321, "Магазин")
    ]
    assert db.execute("SELECT id,org_id,employee_id FROM shifts").fetchall() == [
        (11, 42, 9)
    ]
    assert db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='organizations'"
    ).fetchone()[0] == sql_before
    db.execute("INSERT INTO organization_memberships "
               "(org_id,user_tg_id,role,created_by,created_at) VALUES (?,?,?,?,?)",
               (42, 7654322, "manager", 7654321, 1000))
    try:
        db.execute("INSERT INTO organization_memberships "
                   "(org_id,user_tg_id,role,created_by,created_at) VALUES (?,?,?,?,?)",
                   (42, 7654322, "manager", 7654321, 1000))
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Duplicate membership accepted")
    db.execute("INSERT INTO user_organization_selections "
               "(user_tg_id,org_id,updated_at) VALUES (?,?,?)", (7654322, 42, 2000))
    db.execute("INSERT INTO onboarding_sessions "
               "(user_tg_id,phase,request_id,expires_at,updated_at) VALUES (?,?,?,?,?)",
               (7654321, "choose_group", 991, 9999, 1000))
    assert db.execute("SELECT phase,request_id FROM onboarding_sessions").fetchone() == ("choose_group", 991)
    try:
        db.execute("INSERT INTO onboarding_sessions "
                   "(user_tg_id,phase,request_id,expires_at,updated_at) VALUES (?,?,?,?,?)",
                   (7654321, "choose_group", 992, 9999, 1000))
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Duplicate onboarding session accepted")
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    db.commit()

def main():
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)
        with sqlite3.connect(path/"original.db") as db:
            initialize(db)
            with sqlite3.connect(path/"backup.db") as backup:
                db.backup(backup)
        with sqlite3.connect(path/"backup.db") as backup, sqlite3.connect(path/"restored.db") as restored:
            backup.backup(restored)
            assert restored.execute("SELECT name FROM organizations WHERE id=42").fetchone() == ("Магазин",)
            assert restored.execute("SELECT org_id FROM shifts WHERE id=11").fetchone() == (42,)
            assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    print("OK: sample legacy IDs, rows, uniqueness and backup/restore preserved")

if __name__=="__main__":
    main()
