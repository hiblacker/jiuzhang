#!/usr/bin/env python3
"""Seed demo STORY/DEFECT rows into the NAS MySQL devopsv1 database.

The platform only ever reads its sources, so this seeder lives outside the
application: it drives the mysql client inside the NAS container over SSH.
Every row it creates carries an invisible HTML comment marker, which is the only
thing it is ever allowed to update on a later run.
"""
import argparse
import datetime as dt
import os
import random
import subprocess
import sys
import uuid
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")
MARKER_LIKE = "%<!--seed:%-->%"
MARKER = "<!--seed:%s-->"
DEFAULT_PROJECTS = "T202411004,T202403006,T202403043,T202403036"

MODULES = [
    "客户管理", "账户中心", "对账服务", "报表平台", "权限中心", "消息推送",
    "文件服务", "移动端", "批量作业", "接口网关", "审批流程", "数据字典",
    "产品台账", "额度管理", "流程编排", "运维监控",
]
REQ_ACTIONS = ["支持", "优化", "新增", "重构", "补充", "完善"]
REQ_OBJECTS = [
    "批量导入", "导出模板", "查询条件", "操作日志", "权限校验", "异常提示",
    "页面加载速度", "数据校验规则", "缓存刷新策略", "并发控制",
]
TASK_ACTIONS = ["开发", "联调", "自测", "用例编写", "上线准备", "代码评审", "性能压测"]
TASK_OBJECTS = ["接口", "页面", "定时任务", "报表", "脚本", "配置项", "批量作业"]
DEFECT_PROBLEMS = [
    "偶发报错", "显示异常", "数据不一致", "响应超时", "空指针异常",
    "样式错位", "权限校验失效", "批量处理结果缺失",
]
ISSUES = ["响应变慢", "数据对不上", "重复提交", "状态不同步", "导出失败"]
SCENES = ["单人操作", "批量并发", "跨机构协作", "移动端提交", "定时触发"]
CONSTRAINTS = ["幂等", "可回滚", "不改变现有接口语义", "失败可重试", "操作留痕"]


class RemoteError(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Seed demo STORY/DEFECT rows into NAS MySQL.")
    parser.add_argument("--apply", action="store_true", help="commit the batch (default: dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="explicitly keep the default read-only mode")
    parser.add_argument("--print-sql", action="store_true", help="print the generated SQL")
    parser.add_argument("-v", "--verbose", action="store_true", help="print sampled context summary")
    parser.add_argument("--story-req", type=int, default=6, help="new requirement rows (TYPE=0)")
    parser.add_argument("--story-task", type=int, default=6, help="new task rows (TYPE=1)")
    parser.add_argument("--defect", type=int, default=8, help="new defect rows")
    parser.add_argument("--advance", type=int, default=8, help="rows to move forward one status")
    parser.add_argument("--projects", default=DEFAULT_PROJECTS, help="comma separated project codes")
    parser.add_argument("--run-id", default=dt.datetime.now(TZ).strftime("%Y%m%d%H"))
    parser.add_argument("--ssh-host", default="hiblacker@192.168.1.10")
    parser.add_argument("--ssh-port", type=int, default=13022)
    parser.add_argument("--ssh-key", default="~/.ssh/id_rsa")
    parser.add_argument("--docker", default="/usr/local/bin/docker")
    parser.add_argument("--container", default="mysql-1")
    parser.add_argument("--database", default="devopsv1")
    parser.add_argument("--timeout", type=int, default=120)
    return parser.parse_args(argv)


def scrub(text):
    """Drop anything that could echo a credential before it reaches a log."""
    keep = []
    for line in text.splitlines():
        lowered = line.lower()
        if "mysql_pwd" in lowered or "password" in lowered or "identified by" in lowered:
            continue
        keep.append(line)
    return "\n".join(keep).strip()


def quote(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def number(value):
    return "NULL" if value is None else str(value)


def stamp(value):
    return "NULL" if value is None else "'" + value.strftime("%Y-%m-%d %H:%M:%S") + "'"


def run_remote(args, sql):
    remote = (
        "sudo -n {docker} exec -i {container} sh -c "
        "'MYSQL_PWD=$MYSQL_ROOT_PASSWORD exec mysql -uroot --batch --raw "
        "--skip-column-names --default-character-set=utf8mb4 {database}'"
    ).format(docker=args.docker, container=args.container, database=args.database)
    command = [
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15", "-i", os.path.expanduser(args.ssh_key),
        "-p", str(args.ssh_port), args.ssh_host, remote,
    ]
    try:
        done = subprocess.run(command, input=sql, text=True, encoding="utf-8",
                              capture_output=True, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        raise RemoteError(2, "ssh timed out after %ds" % args.timeout) from None
    if done.returncode != 0:
        code = 2 if done.returncode == 255 else 4
        raise RemoteError(code, scrub(done.stderr) or "mysql exited with %d" % done.returncode)
    return done.stdout


def rows_of(text):
    rows = []
    for line in text.splitlines():
        if line.strip():
            rows.append(line.split("\t"))
    return rows


def build_context_sql(codes, run_id):
    listed = ",".join(quote(code) for code in codes)
    scope = "PROJECT_ID IN (SELECT PROJECT_ID FROM PROJECT WHERE PROJECT_CODE IN (%s) AND DELETE_FLAG=0)" % listed
    marker = "%%<!--seed:%s-->%%" % run_id
    return "\n".join([
        "SELECT 'DB', DATABASE(), @@version;",
        "SELECT 'PRJ', PROJECT_ID, PROJECT_CODE, IFNULL(PROJECT_NAME,'') FROM PROJECT "
        "WHERE PROJECT_CODE IN (%s) AND DELETE_FLAG=0;" % listed,
        "SELECT 'CNT', 'STORY', PROJECT_ID, COUNT(*) FROM STORY WHERE %s GROUP BY PROJECT_ID;" % scope,
        "SELECT 'CNT', 'DEFECT', PROJECT_ID, COUNT(*) FROM DEFECT WHERE %s GROUP BY PROJECT_ID;" % scope,
        "SELECT 'SM', 'STORY', PROJECT_ID, TYPE, STATUS, IFNULL(STATUS_CODE,'~'), "
        "IFNULL(STATUS_NAME,'~'), COUNT(*) FROM STORY WHERE %s AND DELETE_FLAG=0 "
        "GROUP BY PROJECT_ID, TYPE, STATUS, STATUS_CODE, STATUS_NAME;" % scope,
        "SELECT 'SM', 'DEFECT', PROJECT_ID, TYPE, STATUS, IFNULL(STATUS_CODE,'~'), "
        "IFNULL(STATUS_NAME,'~'), COUNT(*) FROM DEFECT WHERE %s AND DELETE_FLAG=0 "
        "GROUP BY PROJECT_ID, TYPE, STATUS, STATUS_CODE, STATUS_NAME;" % scope,
        "SELECT 'NODE', 'STORY', PROJECT_ID, TYPE, STATUS, NODE_ID, COUNT(*) FROM STORY "
        "WHERE %s AND DELETE_FLAG=0 AND NODE_ID IS NOT NULL "
        "GROUP BY PROJECT_ID, TYPE, STATUS, NODE_ID;" % scope,
        "SELECT 'NODE', 'DEFECT', PROJECT_ID, STATUS, NODE_Id, COUNT(*) FROM DEFECT "
        "WHERE %s AND DELETE_FLAG=0 AND NODE_Id IS NOT NULL "
        "GROUP BY PROJECT_ID, STATUS, NODE_Id;" % scope,
        "SELECT 'ITER', PROJECT_ID, ITERATION_ID, COUNT(*) FROM STORY WHERE %s "
        "AND DELETE_FLAG=0 AND ITERATION_ID IS NOT NULL GROUP BY PROJECT_ID, ITERATION_ID;" % scope,
        "SELECT 'USER', PROJECT_ID, HANDLER, COUNT(*) FROM STORY WHERE %s AND DELETE_FLAG=0 "
        "AND HANDLER REGEXP '^[0-9a-f]{32}$' GROUP BY PROJECT_ID, HANDLER;" % scope,
        "SELECT 'SRC', 'STORY', PROJECT_ID, IFNULL(SOURCE,-1), COUNT(*) FROM STORY "
        "WHERE %s AND DELETE_FLAG=0 GROUP BY PROJECT_ID, SOURCE;" % scope,
        "SELECT 'SRC', 'DEFECT', PROJECT_ID, IFNULL(SOURCE,-1), COUNT(*) FROM DEFECT "
        "WHERE %s AND DELETE_FLAG=0 GROUP BY PROJECT_ID, SOURCE;" % scope,
        "SELECT 'PRI', 'STORY', PROJECT_ID, IFNULL(PRIORITY,-1), COUNT(*) FROM STORY "
        "WHERE %s AND DELETE_FLAG=0 GROUP BY PROJECT_ID, PRIORITY;" % scope,
        "SELECT 'PRI', 'DEFECT', PROJECT_ID, IFNULL(PRIORITY,-1), COUNT(*) FROM DEFECT "
        "WHERE %s AND DELETE_FLAG=0 GROUP BY PROJECT_ID, PRIORITY;" % scope,
        "SELECT 'SER', 'STR', PROJECT_ID, IFNULL(MAX(CAST(SUBSTRING_INDEX(ENCODE,'-',-1) AS UNSIGNED)),0) "
        "FROM STORY WHERE ENCODE REGEXP '^#STR-[A-Za-z0-9]+-[0-9]+$' GROUP BY PROJECT_ID;",
        "SELECT 'SER', 'TSK', PROJECT_ID, IFNULL(MAX(CAST(SUBSTRING_INDEX(ENCODE,'-',-1) AS UNSIGNED)),0) "
        "FROM STORY WHERE ENCODE REGEXP '^#TSK-[A-Za-z0-9]+-[0-9]+$' GROUP BY PROJECT_ID;",
        "SELECT 'SER', 'DEF', PROJECT_ID, IFNULL(MAX(CAST(SUBSTRING_INDEX(ENCODE,'-',-1) AS UNSIGNED)),0) "
        "FROM DEFECT WHERE ENCODE REGEXP '^#DEF-[A-Za-z0-9]+-[0-9]+$' GROUP BY PROJECT_ID;",
        "SELECT 'MARK', 'STORY', COUNT(*) FROM STORY WHERE DESCRIPTION LIKE %s;" % quote(marker),
        "SELECT 'MARK', 'DEFECT', COUNT(*) FROM DEFECT WHERE DESCRIPTION LIKE %s;" % quote(marker),
        "SELECT 'PARENT', PROJECT_ID, ID FROM STORY WHERE %s AND DELETE_FLAG=0 AND TYPE=0 "
        "ORDER BY CREATE_TIME DESC LIMIT 400;" % scope,
        "SELECT 'ADV', 'STORY', ID, PROJECT_ID, TYPE, STATUS FROM STORY WHERE %s AND DELETE_FLAG=0 "
        "AND STATUS IN (0,1) AND DESCRIPTION LIKE %s ORDER BY CREATE_TIME DESC LIMIT 60;"
        % (scope, quote(MARKER_LIKE)),
        "SELECT 'ADV', 'DEFECT', ID, PROJECT_ID, TYPE, STATUS FROM DEFECT WHERE %s AND DELETE_FLAG=0 "
        "AND STATUS IN (0,1) AND DESCRIPTION LIKE %s ORDER BY CREATE_TIME DESC LIMIT 40;"
        % (scope, quote(MARKER_LIKE)),
    ]) + "\n"


def load_context(args, codes):
    rows = rows_of(run_remote(args, build_context_sql(codes, args.run_id)))
    if not rows or rows[0][0] != "DB":
        raise RemoteError(3, "unexpected preflight response")
    if rows[0][1] != args.database:
        raise RemoteError(3, "connected to %s, expected %s" % (rows[0][1], args.database))

    ctx = {
        "version": rows[0][2],
        "projects": {},
        "status": {},
        "node": {},
        "iter": {},
        "users": {},
        "source": {},
        "priority": {},
        "serial": {},
        "parents": {},
        "advance": {"STORY": [], "DEFECT": []},
        "counts": {},
        "marker": {},
    }
    for row in rows[1:]:
        tag = row[0]
        if tag == "PRJ":
            ctx["projects"].setdefault(row[2], {"id": row[1], "name": row[3]})
        elif tag == "CNT":
            ctx["counts"][(row[1], row[2])] = int(row[3])
        elif tag == "SM":
            key = (row[2], row[1], int(row[3]), int(row[4]))
            ctx["status"].setdefault(key, []).append(
                (None if row[5] == "~" else row[5], None if row[6] == "~" else row[6], int(row[7])))
        elif tag == "NODE":
            table = row[1]
            pid = row[2]
            if table == "STORY":
                key = (pid, table, int(row[3]), int(row[4]))
                ctx["node"].setdefault(key, []).append((row[5], int(row[6])))
            else:
                key = (pid, table, 2, int(row[3]))
                ctx["node"].setdefault(key, []).append((row[4], int(row[5])))
        elif tag == "ITER":
            ctx["iter"].setdefault(row[1], []).append((row[2], int(row[3])))
        elif tag == "USER":
            ctx["users"].setdefault(row[1], []).append((row[2], int(row[3])))
        elif tag == "SRC":
            ctx["source"].setdefault((row[1], row[2]), []).append((int(row[3]), int(row[4])))
        elif tag == "PRI":
            ctx["priority"].setdefault((row[1], row[2]), []).append((int(row[3]), int(row[4])))
        elif tag == "SER":
            ctx["serial"][(row[2], row[1])] = int(row[3])
        elif tag == "MARK":
            ctx["marker"][row[1]] = int(row[2])
        elif tag == "PARENT":
            ctx["parents"].setdefault(row[1], []).append(row[2])
        elif tag == "ADV":
            ctx["advance"][row[1]].append((row[2], row[3], int(row[4]), int(row[5])))

    for pool in ("iter", "users"):
        for pid in ctx[pool]:
            ctx[pool][pid].sort(key=lambda item: -item[1])
    for key in ("node",):
        for pid in ctx[key]:
            ctx[key][pid].sort(key=lambda item: -item[1])
    return ctx


def weighted(rng, pairs):
    if not pairs:
        return None
    total = sum(weight for _, weight in pairs if weight > 0)
    if total <= 0:
        return pairs[0][0]
    pick = rng.uniform(0, total)
    upto = 0.0
    for value, weight in pairs:
        if weight <= 0:
            continue
        upto += weight
        if pick <= upto:
            return value
    return pairs[-1][0]


def state_of(ctx, pid, table, stype, status):
    combos = ctx["status"].get((pid, table, int(stype), int(status)), [])
    if not combos:
        return None
    best = sorted(combos, key=lambda item: -item[2])[0]
    return {"status": int(status), "code": best[0], "name": best[1]}


def node_of(ctx, pid, table, stype, status):
    pool = ctx["node"].get((pid, table, int(stype), int(status)), [])
    return pool[0][0] if pool else None


def mode_value(pairs, fallback):
    return pairs[0][0] if pairs else fallback


def code_of(ctx, pid):
    for code, meta in ctx["projects"].items():
        if meta["id"] == pid:
            return code
    return ""


def make_text(rng, module, obj, action, issue):
    background = ("%s的%s目前依赖人工核对，高峰期容易%s，一线的项目经理和测试同学已经反馈过多次。"
                  % (module, obj, issue))
    first, second = rng.sample(SCENES, 2)
    goal = ("在%s中%s%s，覆盖%s和%s两个场景，并保证%s，不改变现有调用方的使用方式。"
            % (module, action, obj, first, second, rng.choice(CONSTRAINTS)))
    accept = ("验收标准：主流程可以通过页面完整走通；异常分支有明确提示且不产生脏数据；"
              "对%s已有能力保持兼容。" % module)
    plain = "\n".join([background, goal, accept])
    html = "<p>%s</p><p>%s</p><p>%s</p>" % (background, goal, accept)
    return html, plain


def make_title(rng, module, action, obj):
    title = "【%s】%s%s" % (module, action, obj)
    return title[:100]


def build_story_row(rng, ctx, pid, stype, run_id, moment, serial, parents):
    if stype == 0:
        module = rng.choice(MODULES)
        action = rng.choice(REQ_ACTIONS)
        obj = rng.choice(REQ_OBJECTS)
        state = state_of(ctx, pid, "STORY", 0, 0)
        forecast_days, hours, prefix = "5", "40", "STR"
    else:
        module = rng.choice(MODULES)
        action = rng.choice(TASK_ACTIONS)
        obj = rng.choice(TASK_OBJECTS)
        state = state_of(ctx, pid, "STORY", 1, 0)
        forecast_days, hours, prefix = "1", "8", "TSK"
    html, plain = make_text(rng, module, obj, action, rng.choice(ISSUES))
    user = weighted(rng, ctx["users"].get(pid, [])) or "system"
    owner = weighted(rng, ctx["users"].get(pid, [])) or user
    iteration = weighted(rng, ctx["iter"].get(pid, []))
    parent = None
    if stype == 1:
        parent = rng.choice(parents) if parents else (
            rng.choice(ctx["parents"][pid]) if ctx["parents"].get(pid) else None)
    begin = moment.date()
    end = begin + dt.timedelta(days=rng.randint(3, 14))
    return {
        "ID": uuid.uuid4().hex,
        "PROJECT_ID": pid,
        "TYPE": stype,
        "PID": parent,
        "SORT": 2,
        "TITLE": make_title(rng, module, action, obj),
        "DESCRIPTION": html + MARKER % run_id,
        "DESCRIPTION_TEXT": plain,
        "STATUS": state["status"] if state else 0,
        "STATUS_CODE": state["code"] if state else None,
        "STATUS_NAME": state["name"] if state else None,
        "HANDLER": user,
        "ITERATION_ID": iteration,
        "PRIORITY": mode_value(ctx["priority"].get(("STORY", pid), []), 1),
        "END_TIME": end.strftime("%Y-%m-%d"),
        "PLAN_BEGIN_TIME": begin.strftime("%Y-%m-%d"),
        "PLAN_END_TIME": end.strftime("%Y-%m-%d"),
        "ACTUAL_BEGIN_TIME": None,
        "ACTUAL_END_TIME": None,
        "FORECAST_DAYS": forecast_days,
        "ACTUAL_DAYS": None,
        "PRODUCT_OWNER": owner,
        "SKILL_OWNER": owner,
        "INVOLVE_CODE": 1,
        "FORECAST_WORKING_HOURS": hours,
        "REALITY_WORKING_HOURS": "0",
        "CREATE_USER": user,
        "CREATE_TIME": moment.strftime("%Y-%m-%d %H:%M:%S"),
        "UPDATE_USER": user,
        "UPDATE_TIME": moment.strftime("%Y-%m-%d %H:%M:%S"),
        "DELETE_FLAG": 0,
        "NODE_ID": node_of(ctx, pid, "STORY", stype, 0),
        "ENCODE": "#%s-%s-%05d" % (prefix, code_of(ctx, pid), serial),
        "PROPOSER": owner,
        "FOLLOW_PEOPLE": None,
        "SOURCE": mode_value(ctx["source"].get(("STORY", pid), []), 0),
    }


def build_defect_row(rng, ctx, pid, run_id, moment, serial):
    module = rng.choice(MODULES)
    problem = rng.choice(DEFECT_PROBLEMS)
    obj = rng.choice(REQ_OBJECTS + TASK_OBJECTS)
    state = state_of(ctx, pid, "DEFECT", 2, 0)
    html, plain = make_text(rng, module, obj, "修复", problem)
    user = weighted(rng, ctx["users"].get(pid, [])) or "system"
    owner = weighted(rng, ctx["users"].get(pid, [])) or user
    code = code_of(ctx, pid)
    return {
        "ID": uuid.uuid4().hex,
        "PROJECT_ID": pid,
        "TYPE": 2,
        "PID": None,
        "TITLE": make_title(rng, module, "", "%s %s" % (obj, problem)),
        "DESCRIPTION": html + MARKER % run_id,
        "DESCRIPTION_TEXT": plain,
        "STATUS": state["status"] if state else 0,
        "STATUS_CODE": state["code"] if state else None,
        "STATUS_NAME": state["name"] if state else None,
        "HANDLER": user,
        "PROPOSER": owner,
        "FOLLOW_PEOPLE": None,
        "ITERATION_ID": weighted(rng, ctx["iter"].get(pid, [])),
        "DEFECT_TYPE": 0,
        "PRIORITY": mode_value(ctx["priority"].get(("DEFECT", pid), []), 1),
        "END_TIME": (moment.date() + dt.timedelta(days=rng.randint(1, 7))).strftime("%Y-%m-%d"),
        "ACTUAL_BEGIN_TIME": None,
        "ACTUAL_END_TIME": None,
        "CREATE_USER": user,
        "CREATE_TIME": moment.strftime("%Y-%m-%d %H:%M:%S"),
        "UPDATE_USER": user,
        "UPDATE_TIME": moment.strftime("%Y-%m-%d %H:%M:%S"),
        "DELETE_FLAG": 0,
        "NODE_Id": node_of(ctx, pid, "DEFECT", 2, 0),
        "ENCODE": "#DEF-%s-%05d" % (code, serial),
        "IF_PROD": 1,
        "SOURCE": mode_value(ctx["source"].get(("DEFECT", pid), []), 1),
    }


STORY_COLUMNS = [
    "ID", "PROJECT_ID", "TYPE", "PID", "SORT", "TITLE", "DESCRIPTION", "DESCRIPTION_TEXT",
    "STATUS", "STATUS_CODE", "STATUS_NAME", "HANDLER", "ITERATION_ID", "PRIORITY",
    "END_TIME", "PLAN_BEGIN_TIME", "PLAN_END_TIME", "ACTUAL_BEGIN_TIME", "ACTUAL_END_TIME",
    "FORECAST_DAYS", "ACTUAL_DAYS", "PRODUCT_OWNER", "SKILL_OWNER", "INVOLVE_CODE",
    "FORECAST_WORKING_HOURS", "REALITY_WORKING_HOURS", "CREATE_USER", "CREATE_TIME",
    "UPDATE_USER", "UPDATE_TIME", "DELETE_FLAG", "NODE_ID", "ENCODE", "PROPOSER",
    "FOLLOW_PEOPLE", "SOURCE",
]

DEFECT_COLUMNS = [
    "ID", "PROJECT_ID", "TYPE", "PID", "TITLE", "DESCRIPTION", "DESCRIPTION_TEXT",
    "STATUS", "STATUS_CODE", "STATUS_NAME", "HANDLER", "PROPOSER", "FOLLOW_PEOPLE",
    "ITERATION_ID", "DEFECT_TYPE", "PRIORITY", "END_TIME", "ACTUAL_BEGIN_TIME",
    "ACTUAL_END_TIME", "CREATE_USER", "CREATE_TIME", "UPDATE_USER", "UPDATE_TIME",
    "DELETE_FLAG", "NODE_Id", "ENCODE", "IF_PROD", "SOURCE",
]

STORY_TEXT = {"ID", "TITLE", "DESCRIPTION", "DESCRIPTION_TEXT", "HANDLER", "ITERATION_ID",
              "END_TIME", "PLAN_BEGIN_TIME", "PLAN_END_TIME", "FORECAST_DAYS", "ACTUAL_DAYS",
              "PRODUCT_OWNER", "SKILL_OWNER", "FORECAST_WORKING_HOURS",
              "REALITY_WORKING_HOURS", "CREATE_USER", "CREATE_TIME", "UPDATE_USER",
              "UPDATE_TIME", "NODE_ID", "ENCODE", "PROPOSER", "FOLLOW_PEOPLE",
              "STATUS_CODE", "STATUS_NAME", "PID", "PROJECT_ID"}
DEFECT_TEXT = {"ID", "TITLE", "DESCRIPTION", "DESCRIPTION_TEXT", "HANDLER", "PROPOSER",
               "FOLLOW_PEOPLE", "ITERATION_ID", "END_TIME", "CREATE_USER", "CREATE_TIME",
               "UPDATE_USER", "UPDATE_TIME", "NODE_Id", "ENCODE", "STATUS_CODE",
               "STATUS_NAME", "PID", "PROJECT_ID"}


def render_insert(table, row):
    columns = STORY_COLUMNS if table == "STORY" else DEFECT_COLUMNS
    texts = STORY_TEXT if table == "STORY" else DEFECT_TEXT
    values = []
    for column in columns:
        if column in texts:
            values.append(quote(row[column]))
        else:
            values.append(number(row[column]))
    return "INSERT INTO %s (%s) VALUES (%s);" % (
        table, ", ".join(columns), ", ".join(values))


def plan(args, ctx):
    rng = random.Random(args.run_id)
    now = dt.datetime.now(TZ)
    moments = []
    cursor = now - dt.timedelta(seconds=600)
    for _ in range(args.story_req + args.story_task + args.defect):
        cursor = cursor + dt.timedelta(seconds=rng.randint(5, 90))
        moments.append(cursor)

    story_pids = [meta["id"] for meta in ctx["projects"].values()]
    req_pids = [pid for pid in story_pids if state_of(ctx, pid, "STORY", 0, 0)]
    task_pids = [pid for pid in story_pids if state_of(ctx, pid, "STORY", 1, 0)]
    defect_pids = [pid for pid in story_pids if state_of(ctx, pid, "DEFECT", 2, 0)]
    if not req_pids:
        raise RemoteError(3, "no project exposes a requirement status=0 combination")

    serial = {}
    statements = []
    inserted = {"STORY": 0, "DEFECT": 0}
    new_requirements = {}
    slot = 0

    for _ in range(args.story_req):
        pid = rng.choice(req_pids)
        key = (pid, "STR")
        serial[key] = serial.get(key, ctx["serial"].get(key, 0)) + 1
        row = build_story_row(rng, ctx, pid, 0, args.run_id, moments[slot], serial[key], [])
        statements.append(render_insert("STORY", row))
        new_requirements.setdefault(pid, []).append(row["ID"])
        inserted["STORY"] += 1
        slot += 1

    for _ in range(args.story_task):
        pid = rng.choice(task_pids or req_pids)
        key = (pid, "TSK")
        serial[key] = serial.get(key, ctx["serial"].get(key, 0)) + 1
        row = build_story_row(rng, ctx, pid, 1, args.run_id, moments[slot],
                              serial[key], new_requirements.get(pid, []))
        statements.append(render_insert("STORY", row))
        inserted["STORY"] += 1
        slot += 1

    for _ in range(args.defect):
        if not defect_pids:
            break
        pid = rng.choice(defect_pids)
        key = (pid, "DEF")
        serial[key] = serial.get(key, ctx["serial"].get(key, 0)) + 1
        row = build_defect_row(rng, ctx, pid, args.run_id, moments[slot], serial[key])
        statements.append(render_insert("DEFECT", row))
        inserted["DEFECT"] += 1
        slot += 1

    updates, advanced = plan_advance(args, rng, ctx, now)
    statements.extend(updates)
    return statements, inserted, advanced, now


def plan_advance(args, rng, ctx, now):
    plan_story = (args.advance + 1) // 2
    plan_defect = args.advance // 2
    statements = []
    advanced = {"STORY": 0, "DEFECT": 0}
    stamp_value = (now - dt.timedelta(seconds=30)).strftime("%Y-%m-%d %H:%M:%S")

    for table, quota in (("STORY", plan_story), ("DEFECT", plan_defect)):
        candidates = ctx["advance"].get(table, [])
        rng.shuffle(candidates)
        for row_id, pid, stype, status in candidates:
            if advanced[table] >= quota:
                break
            target_to = 1 if status == 0 else 2
            target = state_of(ctx, pid, table, stype, target_to)
            if not target:
                continue
            node = node_of(ctx, pid, table, stype, target_to)
            if table == "STORY":
                sets = ["STATUS=%d" % target["status"], "STATUS_CODE=%s" % quote(target["code"]),
                        "STATUS_NAME=%s" % quote(target["name"]),
                        "NODE_ID=%s" % quote(node), "UPDATE_TIME='%s'" % stamp_value]
                if target_to == 1:
                    sets.append("ACTUAL_BEGIN_TIME='%s'" % stamp_value)
                else:
                    sets.append("ACTUAL_END_TIME='%s'" % stamp_value)
                    sets.append("END_TIME='%s'" % stamp_value[:10])
                statements.append(
                    "UPDATE STORY SET %s WHERE ID=%s AND PROJECT_ID=%s AND STATUS=%d "
                    "AND DESCRIPTION LIKE %s AND DELETE_FLAG=0;"
                    % (", ".join(sets), quote(row_id), quote(pid), status, quote(MARKER_LIKE)))
            else:
                sets = ["STATUS=%d" % target["status"], "STATUS_CODE=%s" % quote(target["code"]),
                        "STATUS_NAME=%s" % quote(target["name"]),
                        "NODE_Id=%s" % quote(node), "UPDATE_TIME='%s'" % stamp_value]
                if target_to == 2:
                    sets.append("ACTUAL_END_TIME='%s'" % stamp_value)
                    sets.append("END_TIME='%s'" % stamp_value[:10])
                else:
                    sets.append("ACTUAL_BEGIN_TIME='%s'" % stamp_value)
                statements.append(
                    "UPDATE DEFECT SET %s WHERE ID=%s AND PROJECT_ID=%s AND STATUS=%d "
                    "AND DESCRIPTION LIKE %s AND DELETE_FLAG=0;"
                    % (", ".join(sets), quote(row_id), quote(pid), status, quote(MARKER_LIKE)))
            advanced[table] += 1
    return statements, advanced


def apply_batch(args, statements):
    body = "SET NAMES utf8mb4;\nSTART TRANSACTION;\n" + "\n".join(statements) + "\nCOMMIT;\n"
    run_remote(args, body)


def verify(args, inserted):
    pattern = "%<!--seed:" + args.run_id + "-->%"
    sql = "\n".join([
        "SELECT 'V','STORY',COUNT(*) FROM STORY WHERE DESCRIPTION LIKE %s;" % quote(pattern),
        "SELECT 'V','DEFECT',COUNT(*) FROM DEFECT WHERE DESCRIPTION LIKE %s;" % quote(pattern),
        "SELECT 'T','STORY',COUNT(*) FROM STORY;",
        "SELECT 'T','DEFECT',COUNT(*) FROM DEFECT;",
    ]) + "\n"
    rows = rows_of(run_remote(args, sql))
    seen = {}
    totals = {}
    for row in rows:
        if row[0] == "V":
            seen[row[1]] = int(row[2])
        elif row[0] == "T":
            totals[row[1]] = int(row[2])
    if seen.get("STORY", 0) != inserted["STORY"] or seen.get("DEFECT", 0) != inserted["DEFECT"]:
        raise RemoteError(5, "post-commit check failed: story=%s/%s defect=%s/%s"
                          % (seen.get("STORY"), inserted["STORY"],
                             seen.get("DEFECT"), inserted["DEFECT"]))
    return totals


def main(argv=None):
    args = parse_args(argv)
    if not args.run_id.isdigit() or len(args.run_id) != 10:
        print("error: --run-id must be a 10 digit hour bucket, e.g. 2026110914", file=sys.stderr)
        return 3
    codes = [code.strip() for code in args.projects.split(",") if code.strip()]
    try:
        ctx = load_context(args, codes)
        if not ctx["projects"]:
            print("error: none of the requested projects exist in %s" % args.database, file=sys.stderr)
            return 3
        if args.verbose:
            for code, meta in sorted(ctx["projects"].items()):
                print("project %s %s story=%s defect=%s serial=%s"
                      % (code, meta["id"], ctx["counts"].get(("STORY", meta["id"]), 0),
                         ctx["counts"].get(("DEFECT", meta["id"]), 0),
                         {k[1]: v for k, v in ctx["serial"].items() if k[0] == meta["id"]}))
        if ctx["marker"].get("STORY", 0) + ctx["marker"].get("DEFECT", 0) > 0:
            print("[seed] run=%s already applied, skipped" % args.run_id)
            return 0
        statements, inserted, advanced, _ = plan(args, ctx)
        if args.print_sql:
            print("SET NAMES utf8mb4;\nSTART TRANSACTION;")
            for statement in statements:
                print(statement)
            print("COMMIT;")
        if not args.apply:
            print("[seed] run=%s dry-run insert=%d/%d advance=%d"
                  % (args.run_id, inserted["STORY"], inserted["DEFECT"],
                     advanced["STORY"] + advanced["DEFECT"]))
            return 0
        apply_batch(args, statements)
        totals = verify(args, inserted)
        print("[seed] run=%s projects=%d inserted=%d (req=%d/task=%d/def=%d) advanced=%d/%d "
              "story=%d defect=%d"
              % (args.run_id, len(ctx["projects"]), inserted["STORY"] + inserted["DEFECT"],
                 args.story_req, args.story_task, inserted["DEFECT"],
                 advanced["STORY"], advanced["DEFECT"],
                 totals.get("STORY", 0), totals.get("DEFECT", 0)))
        return 0
    except RemoteError as error:
        print("error(%d): %s" % (error.code, error.detail), file=sys.stderr)
        return error.code


if __name__ == "__main__":
    sys.exit(main())
