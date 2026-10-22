#!/usr/bin/env python3
"""Real API/Worker acceptance for persistent SQL dataset scheduling."""
from importlib import import_module
from pathlib import Path
import json
import os
import time

Client = import_module("test-identity").Client


def main():
    dataset_id = json.loads(Path(".local/dataset-test.json").read_text())["sqlWarehouseId"]
    client = Client()
    client.call(
        "POST",
        "/auth/login",
        {"username": os.environ["JIUZHANG_BOOTSTRAP_USER"], "password": os.environ["JIUZHANG_BOOTSTRAP_PASSWORD"]},
    )
    before, _ = client.call("GET", "/tasks/" + dataset_id)
    original = before["data"]
    scheduled = {
        "name": original["name"],
        "description": original["description"],
        "owner": original["owner"],
        "tags": original["tags"],
        "schedule": {
            "mode": "interval",
            "cron": "0 9 * * *",
            "intervalMinutes": 1,
            "timezone": "Asia/Shanghai",
            "retries": 0,
            "timeoutSeconds": 600,
            "concurrency": 1,
            "dependencies": [],
        },
    }
    client.call("PATCH", "/tasks/" + dataset_id, scheduled)
    deadline = time.monotonic() + 70
    run = None
    while time.monotonic() < deadline:
        payload, _ = client.call("GET", "/runs?datasetId=" + dataset_id + "&pageSize=100")
        rows = payload["data"]
        scheduled_runs = [row for row in rows if row.get("trigger") == "schedule"]
        if scheduled_runs:
            run = scheduled_runs[0]
            if run["status"] in {"succeeded", "failed", "blocked", "canceled"}:
                break
        time.sleep(1)
    assert run is not None, "Worker did not create a scheduled run"
    assert run["taskId"] == dataset_id, run
    assert run["status"] == "succeeded", run
    task, _ = client.call("GET", "/tasks/" + dataset_id)
    assert task["data"]["lastSuccessRunId"] == run["id"], task
    assert task["data"]["nextRunAt"] is not None, task

    paused, _ = client.call("POST", "/tasks/" + dataset_id + "/pause")
    assert paused["data"]["enabled"] is False, paused
    time.sleep(2)
    restored = dict(scheduled)
    restored["schedule"] = original["schedule"]
    client.call("PATCH", "/tasks/" + dataset_id, restored)
    client.call("POST", "/tasks/" + dataset_id + ("/resume" if original["enabled"] else "/pause"))
    print("PASS real scheduling: persisted interval, Worker-created SQL snapshot run, task success cursor, pause/resume")


if __name__ == "__main__":
    main()
