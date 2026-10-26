#!/usr/bin/env python3
"""Real API/Worker acceptance for persistent SQL dataset scheduling."""
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
import json
import os
import time
from zoneinfo import ZoneInfo

Client = import_module("test-identity").Client
TERMINAL = {"succeeded", "failed", "blocked", "canceled"}


def task_input(task, schedule):
    return {
        "name": task["name"],
        "description": task["description"],
        "owner": task["owner"],
        "tags": task["tags"],
        "schedule": schedule,
    }


def wait_for_no_active_run(client, dataset_id, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        payload, _ = client.call(
            "GET", "/runs?datasetId=" + dataset_id + "&pageSize=100"
        )
        if not any(row["status"] not in TERMINAL for row in payload["data"]):
            return
        time.sleep(1)
    raise AssertionError("A previous dataset run did not finish before schedule test")


def latest_scheduled_id(client, dataset_id):
    payload, _ = client.call(
        "GET", "/runs?datasetId=" + dataset_id + "&pageSize=100"
    )
    ids = [
        int(row["id"])
        for row in payload["data"]
        if row.get("trigger") == "schedule" and row.get("taskId") == dataset_id
    ]
    return max(ids, default=0)


def main():
    fixture = json.loads(Path(".local/dataset-test.json").read_text())
    dataset_id = fixture["sqlWarehouseId"]
    client = Client()
    client.call(
        "POST",
        "/auth/login",
        {
            "username": os.environ["JIUZHANG_BOOTSTRAP_USER"],
            "password": os.environ["JIUZHANG_BOOTSTRAP_PASSWORD"],
        },
    )
    if fixture.get("directId"):
        client.call("GET", "/tasks/" + fixture["directId"], expected=404)
    original_response, _ = client.call("GET", "/tasks/" + dataset_id)
    original = original_response["data"]
    task_id = original["id"]
    paused = False

    try:
        client.call("POST", "/tasks/" + task_id + "/pause")
        paused = True
        wait_for_no_active_run(client, dataset_id)

        cron = {
            "mode": "cron",
            "cron": "*/5 * * * *",
            "intervalMinutes": 1,
            "timezone": "Asia/Shanghai",
            "retries": 0,
            "timeoutSeconds": 600,
            "concurrency": 1,
            "dependencies": [],
        }
        too_long = {**cron, "timeoutSeconds": 601}
        client.call(
            "PATCH",
            "/tasks/" + task_id,
            task_input(original, too_long),
            expected=422,
        )
        client.call("PATCH", "/tasks/" + task_id, task_input(original, cron))
        paused_task, _ = client.call("GET", "/tasks/" + task_id)
        assert paused_task["data"]["enabled"] is False, paused_task
        assert paused_task["data"]["nextRunAt"] is None, paused_task
        resumed, _ = client.call("POST", "/tasks/" + task_id + "/resume")
        paused = False
        next_cron = datetime.fromisoformat(
            resumed["data"]["nextRunAt"].replace("Z", "+00:00")
        )
        now = datetime.now(timezone.utc)
        local_cron = next_cron.astimezone(ZoneInfo("Asia/Shanghai"))
        assert now < next_cron <= now.replace(second=0, microsecond=0) + timedelta(
            minutes=6
        ), resumed
        assert local_cron.minute % 5 == 0 and local_cron.second == 0, resumed

        client.call("POST", "/tasks/" + task_id + "/pause")
        paused = True
        interval = {
            **cron,
            "mode": "interval",
            "intervalMinutes": 1,
            "timeoutSeconds": 30,
        }
        client.call("PATCH", "/tasks/" + task_id, task_input(original, interval))
        before_run = latest_scheduled_id(client, dataset_id)
        resumed, _ = client.call("POST", "/tasks/" + task_id + "/resume")
        paused = False
        next_interval = datetime.fromisoformat(
            resumed["data"]["nextRunAt"].replace("Z", "+00:00")
        )
        assert next_interval > datetime.now(timezone.utc), resumed

        deadline = time.monotonic() + 70
        run = None
        while time.monotonic() < deadline:
            payload, _ = client.call(
                "GET", "/runs?datasetId=" + dataset_id + "&pageSize=100"
            )
            candidates = [
                row
                for row in payload["data"]
                if row.get("trigger") == "schedule"
                and row.get("taskId") == dataset_id
                and int(row["id"]) > before_run
            ]
            if candidates:
                run = max(candidates, key=lambda row: int(row["id"]))
                if run["status"] in TERMINAL:
                    break
            time.sleep(1)

        assert run is not None, "Worker did not create a scheduled run"
        assert run["status"] == "succeeded", run
        assert run["scheduleSnapshot"]["mode"] == "interval", run
        assert run["scheduleSnapshot"]["intervalMinutes"] == 1, run
        assert run["scheduleSnapshot"]["timeoutSeconds"] == 30, run
        task, _ = client.call("GET", "/tasks/" + task_id)
        assert task["data"]["lastSuccessRunId"] == run["id"], task
        assert task["data"]["nextRunAt"] is not None, task

        paused_task, _ = client.call("POST", "/tasks/" + task_id + "/pause")
        paused = True
        assert paused_task["data"]["enabled"] is False, paused_task
        assert paused_task["data"]["nextRunAt"] is None, paused_task
        print(
            "PASS real scheduling: Cron next instant, persisted interval, run snapshot, "
            "success cursor, pause/resume"
        )
    finally:
        if paused is False:
            client.call("POST", "/tasks/" + task_id + "/pause")
        client.call(
            "PATCH", "/tasks/" + task_id, task_input(original, original["schedule"])
        )
        if original["enabled"]:
            client.call("POST", "/tasks/" + task_id + "/resume")


if __name__ == "__main__":
    main()
