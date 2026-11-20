"""Keeps the campaigns (global model, update history, joined devices) in Postgres, normally the Supabase database, so a restart or
redeploy of the server does not wipe them.

Set DATABASE_URL (Supabase: Project Settings > Database > Connection string; on Render use the pooler string, the direct host is
IPv6 only) as an environment variable on the server. Never commit it. Without DATABASE_URL nothing is saved and the campaigns live
in memory only, as before.

One row per campaign ("campaign:<id>") holds the whole campaign as JSON, and the row "active" says which one is collecting. The older
single row "campaign" is imported as the first campaign. Device tokens are stored only as SHA-256 hashes. The table is created on first use.
"""

from __future__ import annotations

import json
import logging
import os
from typing import List, Optional, Protocol

log = logging.getLogger("fedad.persist")
TABLE, ROW = "fedad_state", "campaign"


class Store(Protocol):
    """Named JSON rows: one per campaign ("campaign:<id>") plus one that says which campaign is active ("active")."""
    def read(self, key: str = ROW) -> Optional[dict]: ...
    def write(self, state: dict, key: str = ROW) -> None: ...
    def keys(self, prefix: str = "") -> List[str]: ...
    def delete(self, key: str) -> None: ...


class PostgresStore:
    def __init__(self, url: str):
        import psycopg                                    # imported here so the server still runs without it when persistence is off
        self._psycopg, self.url = psycopg, url
        with self._conn() as c:
            c.execute(f"create table if not exists {TABLE} (id text primary key, data jsonb not null, updated_at timestamptz not null default now())")
            # Supabase exposes the public schema through its Data API. With row level security on and no policy, the public (anon) key can
            # read and write nothing here; this server connects as the postgres role, which is not subject to it.
            c.execute(f"alter table {TABLE} enable row level security")

    def _conn(self):
        return self._psycopg.connect(self.url, connect_timeout=10, autocommit=True)

    def read(self, key: str = ROW) -> Optional[dict]:
        with self._conn() as c:
            r = c.execute(f"select data from {TABLE} where id = %s", (key,)).fetchone()
        return r[0] if r else None

    def write(self, state: dict, key: str = ROW) -> None:
        with self._conn() as c:
            c.execute(f"insert into {TABLE} (id, data, updated_at) values (%s, %s::jsonb, now()) "
                      f"on conflict (id) do update set data = excluded.data, updated_at = now()", (key, json.dumps(state)))

    def keys(self, prefix: str = "") -> List[str]:
        with self._conn() as c:
            return [r[0] for r in c.execute(f"select id from {TABLE} where starts_with(id, %s) order by id", (prefix,)).fetchall()]

    def delete(self, key: str) -> None:
        with self._conn() as c:
            c.execute(f"delete from {TABLE} where id = %s", (key,))


def open_store() -> Optional[Store]:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        log.info("PERSIST off: DATABASE_URL is not set, the campaign lives in memory only")
        return None
    try:
        store = PostgresStore(url)
        log.info("PERSIST on: campaign state is saved to Postgres")
        return store
    except Exception as e:                                # a database problem must not stop the server from starting
        reason = (str(e).strip().splitlines() or [""])[0].replace(url, "<DATABASE_URL>")       # the first line says why; never the connection string
        log.error("PERSIST disabled: could not open the database (%s: %s)", type(e).__name__, reason[:200])
        return None
