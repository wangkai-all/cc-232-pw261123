#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成图书发行分析用的虚构数据。

输出:
  web/data.js       前端直接加载 (window.DATASET)
  data/dataset.json 同一份数据的 JSON 副本, 便于检查/导出

全部为虚构数据。种子固定, 结果可复现。
对账约束(生成时保证):
  每个 ISBN×渠道: 发货 = 实销(当前值) + 退书(当前值) + 渠道在库, 在库 >= 0
  每个 ISBN:        印刷 = 发货 - 退书回库 + 社内库存, 社内库存 >= 0
"""
import json
import random
import datetime as dt
import os

R = random.Random(20261115)
AS_OF = dt.date(2026, 11, 15)

# ---------------------------------------------------------------- 主数据
WORKS = [
    {"id": "W1", "title": "潮汐算法", "author": "林晚晴", "category": "小说"},
    {"id": "W2", "title": "边城茶事", "author": "周牧", "category": "文学"},
    {"id": "W3", "title": "星图编织手册", "author": "陈杲", "category": "科普"},
    {"id": "W4", "title": "巷口经济学", "author": "苏远", "category": "经济"},
    {"id": "W5", "title": "苔藓森林", "author": "何田田", "category": "少儿"},
    {"id": "W6", "title": "夜班电台", "author": "陆时", "category": "小说"},
    {"id": "W7", "title": "纸张简史", "author": "闻道", "category": "社科"},
    {"id": "W8", "title": "食帖·山野", "author": "纪云", "category": "生活"},
]

# supersedes: 再版/换 ISBN 时指向上一版; 装帧不同是独立 ISBN, 不互相取代
EDITIONS = [
    {"id": "E1", "isbn": "9787021000017", "workId": "W1", "editionNo": 1, "printing": 1,
     "binding": "平装", "format": "32开", "listPrice": 49.0, "pubDate": "2024-06-01",
     "supersedes": None, "note": "首版"},
    {"id": "E2", "isbn": "9787021000024", "workId": "W1", "editionNo": 1, "printing": 1,
     "binding": "精装", "format": "32开", "listPrice": 88.0, "pubDate": "2024-10-01",
     "supersedes": None, "note": "精装纪念版, 与平装并行销售, 不可合并统计"},
    {"id": "E3", "isbn": "9787021001014", "workId": "W1", "editionNo": 2, "printing": 1,
     "binding": "平装", "format": "32开", "listPrice": 56.0, "pubDate": "2025-09-01",
     "supersedes": "E1", "note": "第2版(修订), 换 ISBN, 接替 E1"},
    {"id": "E4", "isbn": "9787021002011", "workId": "W2", "editionNo": 1, "printing": 1,
     "binding": "平装", "format": "32开", "listPrice": 42.0, "pubDate": "2024-03-01",
     "supersedes": None, "note": "首版"},
    {"id": "E5", "isbn": "9787021002028", "workId": "W2", "editionNo": 1, "printing": 1,
     "binding": "精装", "format": "16开", "listPrice": 78.0, "pubDate": "2025-04-01",
     "supersedes": None, "note": "精装插图版, 与平装并行, 不可合并统计"},
    {"id": "E6", "isbn": "9787021003018", "workId": "W3", "editionNo": 1, "printing": 1,
     "binding": "平装", "format": "16开", "listPrice": 68.0, "pubDate": "2024-01-15",
     "supersedes": None, "note": "首版"},
    {"id": "E7", "isbn": "9787021003025", "workId": "W3", "editionNo": 2, "printing": 1,
     "binding": "平装", "format": "16开", "listPrice": 72.0, "pubDate": "2026-03-01",
     "supersedes": "E6", "note": "第2版, 换 ISBN, 接替 E6"},
    {"id": "E8", "isbn": "9787021004015", "workId": "W4", "editionNo": 1, "printing": 1,
     "binding": "平装", "format": "32开", "listPrice": 59.0, "pubDate": "2025-02-01",
     "supersedes": None, "note": "首版"},
    {"id": "E9", "isbn": "9787021005012", "workId": "W5", "editionNo": 1, "printing": 1,
     "binding": "平装", "format": "12开", "listPrice": 36.0, "pubDate": "2024-08-01",
     "supersedes": None, "note": "绘本, 渠道退货率偏高"},
    {"id": "E10", "isbn": "9787021006019", "workId": "W6", "editionNo": 1, "printing": 2,
     "binding": "平装", "format": "32开", "listPrice": 45.0, "pubDate": "2025-06-01",
     "supersedes": None, "note": "2026-01 重印(第2次印刷), ISBN 不变"},
    {"id": "E11", "isbn": "9787021007016", "workId": "W7", "editionNo": 1, "printing": 1,
     "binding": "平装", "format": "16开", "listPrice": 64.0, "pubDate": "2023-11-01",
     "supersedes": None, "note": "长销品种"},
    {"id": "E12", "isbn": "9787021008013", "workId": "W8", "editionNo": 1, "printing": 1,
     "binding": "平装", "format": "16开", "listPrice": 52.0, "pubDate": "2025-12-01",
     "supersedes": None, "note": "首版"},
]

CHANNELS = [
    {"id": "C1", "name": "当当网", "type": "电商", "windowMonths": 12},
    {"id": "C2", "name": "京东图书", "type": "电商", "windowMonths": 12},
    {"id": "C3", "name": "新华文轩", "type": "新华系", "windowMonths": 10},
    {"id": "C4", "name": "博库书城", "type": "新华系", "windowMonths": 10},
    {"id": "C5", "name": "言几又书店", "type": "连锁书店", "windowMonths": 6},
    {"id": "C6", "name": "城市馆配联盟", "type": "馆配", "windowMonths": 12},
    {"id": "C7", "name": "出版社直营店", "type": "直营", "windowMonths": 3},
]

# 基础月需求(虚构): 全书生命周期渠道合计约销多少册
BASE_DEMAND = {"E1": 26000, "E2": 5200, "E3": 15000, "E4": 12000, "E5": 4300,
               "E6": 8400, "E7": 6600, "E8": 9800, "E9": 13500, "E10": 11000,
               "E11": 7200, "E12": 5400}
CHAN_WEIGHT = {"C1": 0.24, "C2": 0.22, "C3": 0.16, "C4": 0.12, "C5": 0.10,
               "C6": 0.09, "C7": 0.07}
# 发货超铺系数: 发到渠道 > 预期实销, 形成渠道压货
OVERSTOCK = {"C1": 1.30, "C2": 1.28, "C3": 1.22, "C4": 1.20, "C5": 1.15,
             "C6": 1.05, "C7": 1.02}
# 约定退书率(虚构, 按 类别×渠道类型)
RATE_TABLE = {
    "小说":   {"电商": .13, "新华系": .10, "连锁书店": .09, "馆配": .03, "直营": .01},
    "文学":   {"电商": .11, "新华系": .09, "连锁书店": .08, "馆配": .03, "直营": .01},
    "科普":   {"电商": .08, "新华系": .07, "连锁书店": .06, "馆配": .02, "直营": .01},
    "经济":   {"电商": .10, "新华系": .08, "连锁书店": .07, "馆配": .03, "直营": .01},
    "少儿":   {"电商": .18, "新华系": .14, "连锁书店": .12, "馆配": .04, "直营": .02},
    "社科":   {"电商": .07, "新华系": .06, "连锁书店": .05, "馆配": .02, "直营": .01},
    "生活":   {"电商": .12, "新华系": .09, "连锁书店": .08, "馆配": .03, "直营": .01},
}

ED = {e["id"]: e for e in EDITIONS}
WK = {w["id"]: w for w in WORKS}
CH = {c["id"]: c for c in CHANNELS}


def d(s):
    return dt.date.fromisoformat(s)


def add_months(date, m):
    y = date.year + (date.month - 1 + m) // 12
    mo = (date.month - 1 + m) % 12 + 1
    day = min(date.day, [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
                         31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1])
    return dt.date(y, mo, day)


def months_between(a, b):
    return (b.year - a.year) * 12 + (b.month - a.month) + (b.day - a.day) / 30.44


def seasonal(channel_type, month, category):
    f = 1.0
    if channel_type == "电商":
        if month == 11:
            f *= 1.5
        if month == 6:
            f *= 1.3
        if month == 1:
            f *= 0.8
    else:
        if month == 9 and category in ("少儿", "科普"):
            f *= 1.25
        if month == 2:
            f *= 0.85
    return f


def demand_curve(months_since_pub):
    table = [1.6, 1.4, 1.2, 1.0, .85, .72, .6, .52, .46, .40, .36, .32]
    if months_since_pub < len(table):
        return table[months_since_pub]
    return table[-1] * (0.94 ** (months_since_pub - len(table) + 1))


def current_qty(records):
    """修订链取最新值: 被后续修订取代的记录不计入。"""
    superseded = {r["revisionOf"] for r in records if r["revisionOf"]}
    return {r["id"]: r["qty"] for r in records if r["id"] not in superseded}


# ---------------------------------------------------------------- 发货批次
shipments = []
sid = 0
for e in EDITIONS:
    pub = d(e["pubDate"])
    # 被接替的旧版: 在新版出版后不再发货
    successor = next((x for x in EDITIONS if x["supersedes"] == e["id"]), None)
    ship_end = d(successor["pubDate"]) if successor else dt.date(2026, 10, 31)
    ship_end = min(ship_end, dt.date(2026, 10, 31))
    for c in CHANNELS:
        total = BASE_DEMAND[e["id"]] * CHAN_WEIGHT[c["id"]] * OVERSTOCK[c["id"]]
        total = int(total * R.uniform(0.9, 1.1))
        if total < 300:
            continue
        # 分批: 首发 45%, 后续视动销补货
        plan = [(pub, 0.45)]
        rest = 0.55
        offset = 3
        while rest > 0.05:
            frac = min(rest, R.uniform(0.20, 0.30))
            plan.append((add_months(pub, offset), frac))
            rest -= frac
            offset += R.choice([4, 5, 6])
        for ship_date, frac in plan:
            if ship_date > ship_end:
                continue
            qty = max(100, int(total * frac / 50) * 50)
            sid += 1
            shipments.append({
                "id": f"S{sid:04d}", "isbn": e["isbn"], "channelId": c["id"],
                "shipDate": ship_date.isoformat(), "qty": qty,
                "discount": round(R.uniform(0.55, 0.68), 3),
                "windowMonths": c["windowMonths"],
            })

# ---------------------------------------------------------------- 实销(月度)
sales = []
sale_id = 0
pairs = {}
for s in shipments:
    pairs.setdefault((s["isbn"], s["channelId"]), []).append(s)

for (isbn, cid), ships in sorted(pairs.items()):
    e = next(x for x in EDITIONS if x["isbn"] == isbn)
    w = WK[e["workId"]]
    c = CH[cid]
    pub = d(e["pubDate"])
    successor = next((x for x in EDITIONS if x["supersedes"] == e["id"]), None)
    cut_date = d(successor["pubDate"]) if successor else None
    total_ship = sum(s["qty"] for s in ships)
    demand_total = total_ship / OVERSTOCK[cid] * R.uniform(0.92, 1.05)
    curve_sum = sum(demand_curve(m) for m in range(30))
    shipped_cum = 0
    sold_cum = 0
    ships_sorted = sorted(ships, key=lambda s: s["shipDate"])
    si = 0
    m_date = dt.date(pub.year, pub.month, 1)
    while m_date <= dt.date(2026, 10, 1):
        while si < len(ships_sorted) and d(ships_sorted[si]["shipDate"]) < add_months(m_date, 1):
            shipped_cum += ships_sorted[si]["qty"]
            si += 1
        m_idx = months_between(pub, m_date)
        if m_idx < 0:
            m_date = add_months(m_date, 1)
            continue
        pot = demand_total * demand_curve(int(m_idx)) / curve_sum \
            * seasonal(c["type"], m_date.month, w["category"])
        if cut_date and m_date >= cut_date:
            pot *= 0.15  # 新版上市后旧版需求骤降
        pot *= R.uniform(0.75, 1.25)
        available = shipped_cum - sold_cum
        qty = int(min(available, max(0, pot)))
        if qty > 0:
            sale_id += 1
            report_date = add_months(m_date, 1) + dt.timedelta(days=R.randint(8, 20))
            sales.append({"id": f"R{sale_id:05d}", "isbn": isbn, "channelId": cid,
                          "period": m_date.isoformat()[:7], "qty": qty,
                          "reportedAt": min(report_date, AS_OF).isoformat(),
                          "revisionOf": None, "reason": None})
            sold_cum += qty
        m_date = add_months(m_date, 1)

# ---------------------------------------------------------------- 退书事件
returns = []
ret_id = 0
for s in shipments:
    e = next(x for x in EDITIONS if x["isbn"] == s["isbn"])
    w = WK[e["workId"]]
    c = CH[s["channelId"]]
    rate = RATE_TABLE[w["category"]][c["type"]] * R.uniform(0.7, 1.3)
    final_qty = int(s["qty"] * rate)
    if final_qty < 20:
        continue
    ship_date = d(s["shipDate"])
    win_end = add_months(ship_date, s["windowMonths"])
    # 退货集中在窗口中后段: 1~3 次退货事件
    n_events = R.choice([1, 2, 2, 3])
    fracs = sorted(R.uniform(0.35, 0.95) for _ in range(n_events))
    weights = [R.random() + 0.3 for _ in range(n_events)]
    wsum = sum(weights)
    for i, (frac, wgt) in enumerate(zip(fracs, weights)):
        ev_date = ship_date + dt.timedelta(days=int((win_end - ship_date).days * frac))
        if ev_date > AS_OF:
            continue  # 未到观察期的部分尚未发生 —— 由情景引擎估算
        qty = int(final_qty * wgt / wsum)
        if qty <= 0:
            continue
        ret_id += 1
        returns.append({"id": f"T{ret_id:05d}", "isbn": s["isbn"],
                        "channelId": s["channelId"], "returnDate": ev_date.isoformat(),
                        "qty": qty, "revisionOf": None, "reason": None})

# ---------------------------------------------------------------- 对账修正: 实销+退货 <= 发货
for (isbn, cid), ships in pairs.items():
    total_ship = sum(s["qty"] for s in ships)
    sold = sum(r["qty"] for r in sales if r["isbn"] == isbn and r["channelId"] == cid)
    rets = [r for r in returns if r["isbn"] == isbn and r["channelId"] == cid]
    ret_qty = sum(r["qty"] for r in rets)
    overflow = sold + ret_qty - total_ship
    if overflow > 0:  # 从最近的退货事件开始核减
        for r in sorted(rets, key=lambda x: x["returnDate"], reverse=True):
            cut = min(r["qty"], overflow)
            r["qty"] -= cut
            overflow -= cut
        returns = [r for r in returns if r["qty"] > 0]

# ---------------------------------------------------------------- 迟到实销修订(保留前后版本)
# 修订会增加实销, 需保证 实销+退货 <= 发货 的对账约束仍成立
n_late = 0
cur_sales0 = current_qty(sales)
cur_returns0 = current_qty(returns)
ship_by_pair = {}
for s in shipments:
    ship_by_pair[(s["isbn"], s["channelId"])] = \
        ship_by_pair.get((s["isbn"], s["channelId"]), 0) + s["qty"]
sold_by_pair = {}
for r in sales:
    if r["id"] in cur_sales0:
        k = (r["isbn"], r["channelId"])
        sold_by_pair[k] = sold_by_pair.get(k, 0) + r["qty"]
ret_by_pair = {}
for r in returns:
    if r["id"] in cur_returns0:
        k = (r["isbn"], r["channelId"])
        ret_by_pair[k] = ret_by_pair.get(k, 0) + r["qty"]

candidates = [r for r in sales if "2026-04" <= r["period"] <= "2026-09"
              and CH[r["channelId"]]["type"] in ("电商", "连锁书店")]
R.shuffle(candidates)
for orig in candidates[:22]:
    k = (orig["isbn"], orig["channelId"])
    headroom = ship_by_pair[k] - sold_by_pair.get(k, 0) - ret_by_pair.get(k, 0)
    add = min(int(orig["qty"] * R.uniform(0.10, 0.35)), headroom)
    if add < 3:
        continue
    sale_id += 1
    sales.append({"id": f"R{sale_id:05d}", "isbn": orig["isbn"],
                  "channelId": orig["channelId"], "period": orig["period"],
                  "qty": orig["qty"] + add,
                  "reportedAt": (add_months(d(orig["period"] + "-01"), 3)
                                 + dt.timedelta(days=R.randint(5, 20))).isoformat(),
                  "revisionOf": orig["id"],
                  "reason": "渠道迟到实销补报, 修订原上报值"})
    sold_by_pair[k] = sold_by_pair.get(k, 0) + add
    n_late += 1

# ---------------------------------------------------------------- 退书修订(保留前后版本)
ret_cands = [r for r in returns if d(r["returnDate"]) <= dt.date(2026, 8, 1)]
R.shuffle(ret_cands)
n_ret_rev = 0
for orig in ret_cands[:12]:
    delta = int(orig["qty"] * R.uniform(-0.15, 0.12))
    new_qty = orig["qty"] + delta
    if new_qty <= 0 or abs(delta) < 2:
        continue
    ret_id += 1
    recorded = min(d(orig["returnDate"]) + dt.timedelta(days=R.randint(15, 40)), AS_OF)
    returns.append({"id": f"T{ret_id:05d}", "isbn": orig["isbn"],
                    "channelId": orig["channelId"],
                    "returnDate": orig["returnDate"], "qty": new_qty,
                    "recordedAt": recorded.isoformat(),
                    "revisionOf": orig["id"],
                    "reason": "退货清点差异, 修订入账"})
    n_ret_rev += 1

# ---------------------------------------------------------------- 印刷与社内库存
cur_sales = current_qty(sales)
cur_returns = current_qty(returns)

print_runs = []
pid = 0
for e in EDITIONS:
    isbn = e["isbn"]
    ships_e = sorted([s for s in shipments if s["isbn"] == isbn],
                     key=lambda s: s["shipDate"])
    if not ships_e:
        continue
    total_ship = sum(s["qty"] for s in ships_e)
    total_ret = sum(q for rid, q in cur_returns.items()
                    if any(r["id"] == rid and r["isbn"] == isbn for r in returns))
    pub = d(e["pubDate"])
    mid = pub + dt.timedelta(days=200)
    early_ship = sum(s["qty"] for s in ships_e if d(s["shipDate"]) < mid)
    n_prints = e["printing"]
    p1 = max(early_ship, int(total_ship * 0.6))
    p1 = ((p1 + 499) // 500) * 500
    leftover = R.randint(300, 1800)
    total_print_needed = total_ship - total_ret + leftover
    if n_prints == 1:
        p1 = max(p1, ((total_print_needed + 499) // 500) * 500)
        pid += 1
        print_runs.append({"id": f"P{pid:03d}", "isbn": isbn, "printing": 1,
                           "printDate": (pub - dt.timedelta(days=30)).isoformat(),
                           "qty": p1})
    else:
        p2 = total_print_needed - p1
        if p2 > 200:
            pid += 1
            print_runs.append({"id": f"P{pid:03d}", "isbn": isbn, "printing": 1,
                               "printDate": (pub - dt.timedelta(days=30)).isoformat(),
                               "qty": p1})
            pid += 1
            print_runs.append({"id": f"P{pid:03d}", "isbn": isbn, "printing": 2,
                               "printDate": "2026-01-10", "qty": ((p2 + 499) // 500) * 500})
        else:
            p1 = max(p1, ((total_print_needed + 499) // 500) * 500)
            pid += 1
            print_runs.append({"id": f"P{pid:03d}", "isbn": isbn, "printing": 1,
                               "printDate": (pub - dt.timedelta(days=30)).isoformat(),
                               "qty": p1})

# ---------------------------------------------------------------- 输出
dataset = {
    "meta": {
        "title": "图书发行数据分析 · 虚构示例数据",
        "asOf": AS_OF.isoformat(),
        "generatedAt": AS_OF.isoformat(),
        "seed": 20261115,
        "disclaimer": "本数据集为虚构示例, 仅用于演示; 不涉及任何真实出版社、图书或渠道。",
    },
    "works": WORKS,
    "editions": EDITIONS,
    "channels": CHANNELS,
    "printRuns": print_runs,
    "shipments": shipments,
    "sales": sales,
    "returns": returns,
}

os.makedirs("web", exist_ok=True)
os.makedirs("data", exist_ok=True)
with open("web/data.js", "w", encoding="utf-8") as f:
    f.write("// 虚构示例数据, 由 tools/generate_data.py 生成, 请勿手改\n")
    f.write("window.DATASET = ")
    json.dump(dataset, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
with open("data/dataset.json", "w", encoding="utf-8") as f:
    json.dump(dataset, f, ensure_ascii=False, indent=1)

# 摘要
cs = sum(cur_sales.values())
cr = sum(cur_returns.values())
sh = sum(s["qty"] for s in shipments)
pr = sum(p["qty"] for p in print_runs)
print(f"批次 {len(shipments)}  实销记录 {len(sales)}(含修订)  退书记录 {len(returns)}(含修订)")
print(f"发货 {sh:,}  实销 {cs:,}  退书 {cr:,}  渠道在库 {sh - cs - cr:,}  "
      f"印刷 {pr:,}  社内库存 {pr - sh + cr:,}")
print(f"迟到实销修订 {n_late} 条, 退书修订 {n_ret_rev} 条")
in_window = [s for s in shipments
             if add_months(d(s['shipDate']), s['windowMonths']) > AS_OF]
print(f"未到观察期批次 {len(in_window)} / {len(shipments)}")
