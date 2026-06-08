"""Command-line entry point.

  openwashdip initdb            # create PostGIS extension + tables
  openwashdip list              # list integrated sources
  openwashdip sync <slug>       # run a source's sync now
"""

from __future__ import annotations

import argparse
from typing import Optional, Sequence

from sqlalchemy import select

from .db import SessionLocal, init_db
from .ingest import sync_source
from .models import Source


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="openwashdip", description="Open-source data integrator.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("initdb", help="Create the PostGIS extension and tables.")
    sub.add_parser("list", help="List integrated sources.")
    s = sub.add_parser("sync", help="Run a source's sync now.")
    s.add_argument("slug", help="Source slug.")

    args = parser.parse_args(argv)

    if args.cmd == "initdb":
        init_db()
        print("database initialized")
        return 0

    db = SessionLocal()
    try:
        if args.cmd == "list":
            for src in db.scalars(select(Source).order_by(Source.id)).all():
                sched = f"every {src.interval_minutes}m" if src.interval_minutes else "manual"
                print(f"{src.slug:<24} {src.last_status or '-':<8} {sched:<12} {src.title}")
            return 0
        if args.cmd == "sync":
            src = db.scalar(select(Source).where(Source.slug == args.slug))
            if not src:
                parser.error(f"no such source: {args.slug}")
            run = sync_source(db, src)
            print(f"[{args.slug}] {run.status}: {run.row_count} row(s)" + (f" — {run.error}" if run.error else ""))
            return 0
    finally:
        db.close()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
