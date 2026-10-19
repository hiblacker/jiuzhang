#!/usr/bin/env python3
"""Real PostgreSQL/API acceptance. Creates then disables synthetic test accounts; prints no secrets."""
import http.cookiejar
import json
import os
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("JIUZHANG_TEST_API", "http://127.0.0.1:8080/api/v1")


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def call(self, method, path, body=None, expected=200, csrf=True, origin=None, extra_headers=None):
        headers = {"Content-Type": "application/json"}
        if csrf and self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        if origin:
            headers["Origin"] = origin
        headers.update(extra_headers or {})
        request = urllib.request.Request(BASE + path, method=method, headers=headers,
            data=None if body is None else json.dumps(body).encode())
        try:
            response = self.http.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        payload = json.loads(response.read())
        assert response.code == expected, (method, path, response.code, expected, payload)
        if response.code == 200 and path in ("/session", "/auth/login"):
            self.csrf = payload["data"]["csrfToken"]
        return payload, response.headers


def main():
    admin = Client()
    admin.call("GET", "/session", expected=401)
    admin.call("POST", "/auth/login", {"username": "missing", "password": "wrong"}, expected=401)
    session, headers = admin.call("POST", "/auth/login", {
        "username": os.environ["JIUZHANG_BOOTSTRAP_USER"],
        "password": os.environ["JIUZHANG_BOOTSTRAP_PASSWORD"]})
    assert "HttpOnly" in headers["Set-Cookie"] and "SameSite=Strict" in headers["Set-Cookie"]
    admin_id = session["data"]["user"]["id"]
    admin.call("PATCH", "/system/users/" + admin_id, {"enabled": False}, expected=409)
    admin.call("POST", "/auth/logout", expected=403, csrf=False)
    admin.call("POST", "/auth/logout", expected=403, origin="https://untrusted.invalid")
    username = "check_" + uuid.uuid4().hex[:10]
    password = uuid.uuid4().hex
    user, _ = admin.call("POST", "/system/users", {
        "username": username, "password": password, "name": "synthetic test account",
        "role": "viewer", "enabled": True}, expected=201)
    uid = user["data"]["id"]
    assert "password" not in user["data"] and "password_hash" not in user["data"]
    viewer = Client()
    viewer.call("POST", "/auth/login", {"username": username, "password": password})
    viewer.call("GET", "/system/users", expected=403)
    viewer.call("POST", "/system/users", {"name": "forbidden", "role": "admin", "enabled": True}, expected=403)
    admin.call("PATCH", "/system/users/" + uid, {"enabled": False})
    viewer.call("GET", "/session", expected=401)
    admin.call("PATCH", "/system/users/" + uid, {"enabled": True})
    viewer.call("POST", "/auth/login", {"username": username, "password": password})
    new_password = uuid.uuid4().hex
    viewer.call("POST", "/auth/password", {"currentPassword": "wrong", "newPassword": new_password}, expected=401)
    viewer.call("POST", "/auth/password", {"currentPassword": password, "newPassword": new_password})
    viewer.call("GET", "/session", expected=401)
    viewer.call("POST", "/auth/login", {"username": username, "password": password}, expected=401)
    viewer.call("POST", "/auth/login", {"username": username, "password": new_password})
    viewer.call("POST", "/auth/logout")
    viewer.call("GET", "/session", expected=401)
    admin.call("PATCH", "/system/users/" + uid, {"enabled": False})
    for _ in range(5):
        viewer.call("POST", "/auth/login", {"username": username, "password": "wrong"}, expected=401)
    viewer.call("POST", "/auth/login", {"username": username, "password": "wrong"}, expected=429)
    audit, _ = admin.call("GET", "/system/audit")
    assert any(row["action"] == "password_change" for row in audit["data"])
    admin.call("POST", "/auth/logout")
    admin.call("GET", "/session", expected=401)
    print("PASS real identity: bootstrap, cookie flags, CSRF/origin, roles, last admin, disable, password revocation, logout, throttle, audit")


if __name__ == "__main__":
    main()
