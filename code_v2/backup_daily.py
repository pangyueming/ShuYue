# -*- coding: utf-8 -*-
r"""ShuYue daily backup — SQLite online snapshot + uploads tarball.

Design (industry practice for single-server SQLite):
  1. `VACUUM INTO` produces a consistent snapshot even while the server is
     writing (WAL-safe) — no downtime, no rsync-of-live-file corruption risk.
  2. uploads/ is tar.gz'd (PDFs are immutable once written).
  3. Optional OSS upload via ossutil if configured; otherwise the archive
     stays in backups/ (still useful for cron rsync).

Usage:
  python backup_daily.py                 # snapshot now
  python backup_daily.py --keep 7       # retention days (default 7)

Cron (server, 03:30 daily):
  30 3 * * * cd /opt/shuyue/code_v2 && /opt/shuyue/venv/bin/python backup_daily.py --keep 7 >> ../backups/backup.log 2>&1

Windows Task Scheduler equivalent:
  schtasks /create /tn "ShuYueBackup" /tr "python D:\opt\shuyue\code_v2\backup_daily.py" /sc daily /st 03:30
"""
import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "cognibridge.db")
UPLOAD_DIR = os.path.join(HERE, "uploads")
BACKUP_DIR = os.path.join(os.path.dirname(HERE), "backups")
OSS_BUCKET = os.getenv("BACKUP_OSS_BUCKET", "")   # e.g. oss://shuyue-backup/db/


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=7, help="retention days (default 7)")
    args = ap.parse_args()

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    db_out = os.path.join(BACKUP_DIR, f"db_{stamp}.sqlite")
    up_out = os.path.join(BACKUP_DIR, f"uploads_{stamp}.tar.gz")

    # 1. online DB snapshot (safe under concurrent writes)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("VACUUM INTO ?", (db_out,))
    finally:
        conn.close()
    size_mb = os.path.getsize(db_out) / 1048576
    print(f"[backup] db snapshot -> {db_out} ({size_mb:.1f} MB)")

    # 2. uploads tarball
    if os.path.isdir(UPLOAD_DIR):
        with tarfile.open(up_out, "w:gz") as tar:
            tar.add(UPLOAD_DIR, arcname="uploads")
        print(f"[backup] uploads -> {up_out} ({os.path.getsize(up_out)/1048576:.1f} MB)")

    # 3. optional OSS upload (ossutil must be on PATH + configured)
    if OSS_BUCKET and shutil.which("ossutil"):
        for f in (db_out, up_out):
            if os.path.exists(f):
                r = subprocess.run(["ossutil", "cp", f, OSS_BUCKET, "--force"],
                                   capture_output=True, text=True, timeout=300)
                status = "ok" if r.returncode == 0 else f"FAIL: {r.stderr[:120]}"
                print(f"[backup] oss {os.path.basename(f)}: {status}")

    # 4. retention
    cutoff = time.time() - args.keep * 86400
    removed = 0
    for name in os.listdir(BACKUP_DIR):
        p = os.path.join(BACKUP_DIR, name)
        if name.startswith(("db_", "uploads_")) and os.path.getmtime(p) < cutoff:
            os.remove(p)
            removed += 1
    print(f"[backup] retention: removed {removed} old file(s), keep={args.keep}d")
    return 0


if __name__ == "__main__":
    sys.exit(main())
