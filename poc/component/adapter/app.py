# POC-01 execution adapter: the platform-side worker the scheduler calls.
# One chain call = SeaTunnel REST submit -> dbt load -> P0 warehouse build/publish.
# Single-threaded by design: chains serialize; concurrency safety of publication
# was proven separately in the synthetic P0 (two real sessions, one CAS winner).
import json
import os
import random
import re
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHAIN_LOCK = threading.Lock()

DBT_HOST = os.environ["DBT_HOST"]
PG_PASSWORD = open("/run/secrets/pg_password").read().strip()
MYSQL_USER = "poc_ro"
MYSQL_PASSWORD = open("/run/secrets/mysql_password").read().strip()
JOBS = "/opt/seatunnel_jobs"
ST = "http://seatunnel:5801"
DBT_PROJECT = "/opt/dbt_project"

STATE = {"dbname": None, "source_db": None}
LAST = {"result": None}
RETRY_COUNT = 0

UPPER = {"daily": "2026-09-04 00:00:00", "late": "2026-09-05 00:00:00",
         "replay": "2026-09-04 00:00:00", "stale": "2026-09-03 00:00:00"}
CURSOR_OVERRIDE = {"late": "2026-09-04 00:00:00", "replay": "1970-01-01 00:00:00"}
ADVANCE = {"daily": True, "late": True, "replay": True, "stale": False}


def db_conn(dbname=None):
    import psycopg2
    return psycopg2.connect(host=DBT_HOST, dbname=dbname or STATE["dbname"],
                            user="postgres", password=PG_PASSWORD, port=5432)


def http(url, method="GET", data=None, content_type="text/plain", timeout=30):
    request = urllib.request.Request(url, method=method,
                                     data=data.encode() if data else None)
    if data:
        request.add_header("Content-Type", content_type)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode()

def submit_seatunnel(job, cursor, upper, batch_token):
    template = open(f"{JOBS}/{job}.json").read()
    body = (template.replace("__MYSQL_USER__", MYSQL_USER)
            .replace("__MYSQL_PASSWORD__", MYSQL_PASSWORD)
            .replace("__SOURCE_DB__", STATE["source_db"])
            .replace("__CURSOR__", cursor).replace("__UPPER__", upper)
            .replace("__BATCH__", batch_token)
            .replace("__DBNAME__", STATE["dbname"]).replace("__PG_PASSWORD__", PG_PASSWORD))
    json.loads(body)  # invalid JSON must fail here, not at the engine
    submitted = http(f"{ST}/hazelcast/rest/maps/submit-job", "POST", body,
                     content_type="application/json", timeout=60)
    job_id = json.loads(submitted).get("jobId")
    if not job_id:
        raise RuntimeError(f"submit-job returned no jobId: {submitted[:200]}")
    deadline = time.time() + 300
    while time.time() < deadline:
        info = http(f"{ST}/hazelcast/rest/maps/job-info/{job_id}", timeout=30)
        match = re.search(r'"jobStatus"\s*:\s*"([A-Z_]+)"', info)
        if match:
            state = match.group(1)
            if state in ("FINISHED", "COMPLETED"):
                return {"jobId": str(job_id), "state": state}
            if state in ("FAILED", "CANCELED", "KILLED"):
                raise RuntimeError(f"SeaTunnel job {job} ({job_id}) ended {state}")
        time.sleep(3)
    raise RuntimeError(f"SeaTunnel job {job} ({job_id}) timed out")


def dbt(*args):
    # The project dir is a read-only mount; dbt log/target paths must be writable.
    env = dict(os.environ, DBT_PASSWORD=PG_PASSWORD, DBT_DBNAME=STATE["dbname"],
               DBT_LOG_PATH="/tmp/dbt-logs", DBT_TARGET_PATH="/tmp/dbt-target")
    result = subprocess.run(["dbt", *args, "--profiles-dir", DBT_PROJECT],
                            cwd=DBT_PROJECT, env=env, capture_output=True, text=True,
                            timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"dbt {' '.join(args)} failed: {(result.stdout + result.stderr)[-1500:]}")
    return result.stdout


def chain(mode):
    if mode not in UPPER:
        raise ValueError(f"unknown mode {mode}")
    upper = UPPER[mode]
    batch = "p01-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + \
        f"{random.randint(0, 0xffff):04x}"
    platform_run_id = "pr-" + batch

    override = CURSOR_OVERRIDE.get(mode)
    with db_conn() as conn, conn.cursor() as cur:
        if override:
            story_cursor = log_cursor = override
        else:
            state = {}
            for key in ("story", "status_log"):
                cur.execute("SELECT cursor::text FROM warehouse.ingestion_state WHERE state_key=%s", (key,))
                state[key] = cur.fetchone()[0]
            # timestamptz::text is 'YYYY-MM-DD HH:MM:SS+08'; MySQL wants the naive Shanghai literal.
            story_cursor = log_cursor = state["story"].split("+")[0]

    ingest = [submit_seatunnel("objects", story_cursor, upper, batch),
              submit_seatunnel("events", log_cursor, upper, batch)]
    dbt("run")
    dbt("run-operation", "load_data", "--args", f"{{p_batch: {batch}}}")
    dbt("run-operation", "build_publish", "--args",
        f'{{p_cutoff: "{upper}+08", p_rule: "poc01-v1", p_finalized: false, '
        f'p_mode: "{mode}", p_platform_run_id: "{platform_run_id}"}}')

    if ADVANCE[mode]:
        with db_conn() as conn, conn.cursor() as cur:
            for key in ("story", "status_log"):
                cur.execute(
                    "INSERT INTO warehouse.ingestion_state(state_key,cursor,batch_id,updated_at) "
                    "VALUES (%s,%s::timestamptz,%s,now()) "
                    "ON CONFLICT (state_key) DO UPDATE SET cursor=EXCLUDED.cursor, "
                    "batch_id=EXCLUDED.batch_id, updated_at=now()", (key, upper + "+08", batch))
            conn.commit()

    with db_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT a.release_id, r.state FROM warehouse.active_release a "
                    "LEFT JOIN warehouse.release r USING(release_id)")
        active = cur.fetchone()
        cur.execute("SELECT state, release_id FROM warehouse.run_log WHERE platform_run_id=%s",
                    (platform_run_id,))
        run_state = cur.fetchone()
        cur.execute("SELECT count(*) FROM raw.event")
        event_count = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM raw.object")
        object_count = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM raw_landing.status_batch WHERE batch_id=%s", (batch,))
        landed = cur.fetchone()[0]
        metrics = []
        if run_state and run_state[1]:
            cur.execute("SELECT period_id, team, completion_events, completed_objects, "
                        "duration_sum_seconds, valid_samples, duration_mean_seconds, "
                        "inventory, inventory_reason FROM warehouse.metric "
                        "WHERE release_id=%s ORDER BY period_id, team", (run_state[1],))
            metrics = [dict(zip([d[0] for d in cur.description], r)) for r in cur.fetchall()]
        stale = None
        cur.execute("SELECT reason FROM warehouse.stale_rejections WHERE platform_run_id=%s",
                    (platform_run_id,))
        row = cur.fetchone()
        if row:
            stale = row[0]

    active_release = (None if active is None else {
        "release_id": active[0],
        "state": active[1],
    })
    result = {"platform_run_id": platform_run_id, "mode": mode, "batch": batch,
              "ingest": ingest, "run_state": run_state[0] if run_state else None,
              "release_id": run_state[1] if run_state else None,
              "active_release": active_release, "raw_events": event_count,
              "raw_objects": object_count, "landed_events": landed,
              "metrics": metrics, "stale_rejection": stale}
    return result


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global RETRY_COUNT
        try:
            if self.path == "/health":
                return self._json(200, {"status": "ok", "session": STATE["dbname"]})
            if self.path == "/last":
                return self._json(200, LAST["result"])
            if self.path == "/retry-once":
                RETRY_COUNT += 1
                return self._json(200 if RETRY_COUNT > 1 else 500,
                                  {"attempt": RETRY_COUNT, "synthetic": True})
            match = re.match(r"^/chain/([a-z]+)$", self.path)
            if match:
                if not STATE["dbname"]:
                    return self._json(409, {"error": "no session database; POST /session first"})
                with CHAIN_LOCK:
                    result = chain(match.group(1))
                LAST["result"] = result
                return self._json(200, result)
            return self._json(404, {"error": "not found"})
        except Exception as error:  # noqa: BLE001 - report to scheduler, log locally
            return self._json(500, {"error": str(error)})

    def do_POST(self):
        try:
            if self.path == "/session":
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length) or b"{}")
                name = payload.get("dbname", "")
                source = payload.get("source_db", "")
                if not re.fullmatch(r"p01_[0-9]{14}_[a-f0-9]{8}", name) or not re.fullmatch(r"src_[0-9]{14}_[a-f0-9]{8}", source):
                    return self._json(400, {"error": "invalid experiment database name"})
                STATE["dbname"] = name
                STATE["source_db"] = source
                return self._json(200, {"session": name, "source": source})
            return self._json(404, {"error": "not found"})
        except Exception as error:  # noqa: BLE001
            return self._json(500, {"error": str(error)})

    def log_message(self, fmt, *args):
        print("adapter:", fmt % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
