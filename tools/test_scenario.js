/* 对 scenario.js 与虚构数据的对账/逻辑测试。运行: node tools/test_scenario.js */
"use strict";
const path = require("path");
global.window = {};
require(path.join(__dirname, "../web/data.js"));
const DS = global.window.DATASET;
const S = require(path.join(__dirname, "../web/scenario.js"));

let failures = 0;
function ok(cond, label, extra) {
  if (cond) { console.log("  ✓ " + label); }
  else { failures++; console.error("  ✗ " + label + (extra ? "  → " + extra : "")); }
}
function section(name) { console.log("\n[" + name + "]"); }

// ---------------------------------------------------------- 1. 修订链
section("修订链完整性");
for (const [name, records] of [["实销", DS.sales], ["退书", DS.returns]]) {
  const ids = new Set(records.map(r => r.id));
  const badRef = records.filter(r => r.revisionOf && !ids.has(r.revisionOf));
  ok(badRef.length === 0, `${name}: 所有 revisionOf 都能指回已有记录`);
  const roots = records.filter(r => !r.revisionOf);
  const superseded = new Set(records.filter(r => r.revisionOf).map(r => r.revisionOf));
  const leaves = records.filter(r => !superseded.has(r.id));
  ok(roots.length + (records.length - roots.length) === records.length,
    `${name}: 根+修订 = 全部记录`);
  ok(leaves.length + superseded.size === records.length,
    `${name}: 最新视图(叶子) + 被取代 = 全部记录`);
  const revs = records.filter(r => r.revisionOf);
  ok(revs.length > 0, `${name}: 存在修订记录(${revs.length} 条), 前后版本均保留`);
}

// ---------------------------------------------------------- 2. 流向对账
section("流向对账(两种视图)");
for (const mode of ["latest", "original"]) {
  const { pair, perIsbn } = S.aggregate(DS, mode);
  let badStock = 0, badEq = 0;
  for (const k of Object.keys(pair)) {
    const v = pair[k];
    if (v.shipped !== v.sold + v.returned + v.stock) badEq++;
    if (v.stock < 0) badStock++;
  }
  ok(badEq === 0, `${mode}: 每个 ISBN×渠道 发货=实销+退书+在库`);
  ok(badStock === 0, `${mode}: 渠道在库无负值`);
  let badWh = 0, badPrint = 0;
  for (const k of Object.keys(perIsbn)) {
    const v = perIsbn[k];
    if (v.warehouse < 0) badWh++;
    if (v.printed !== v.shipped - v.returned + v.warehouse) badPrint++;
  }
  ok(badWh === 0, `${mode}: 社内库存无负值`);
  ok(badPrint === 0, `${mode}: 印刷=发货-退书回库+社内库存`);
}

// 迟到修订只增不减(本数据集如此生成), latest 实销 >= original 实销
const aggL = S.aggregate(DS, "latest"), aggO = S.aggregate(DS, "original");
const sumSold = a => Object.values(a.perIsbn).reduce((t, v) => t + v.sold, 0);
ok(sumSold(aggL) > sumSold(aggO),
  `迟到实销修订生效: latest(${sumSold(aggL)}) > original(${sumSold(aggO)})`);

// ---------------------------------------------------------- 3. FIFO 分摊
section("退货 FIFO 分摊");
const alloc = S.allocateReturns(DS, "latest");
const totalAlloc = Object.values(alloc).reduce((t, x) => t + x, 0);
const totalRet = S.resolveView(DS.returns, "latest").reduce((t, r) => t + r.qty, 0);
ok(totalAlloc === totalRet, `分摊总量(${totalAlloc}) = 实际退货总量(${totalRet})`);
const shipById = {};
for (const s of DS.shipments) shipById[s.id] = s.qty;
const overAlloc = Object.entries(alloc).filter(([id, q]) => q > shipById[id]);
ok(overAlloc.length === 0, "单批次分摊不超过其发货量");

// ---------------------------------------------------------- 4. 情景引擎
section("退书情景");
const sc = S.computeScenario(DS, {});
ok(sc.totals.openBatches > 0, `存在未到观察期批次(${sc.totals.openBatches})`);
ok(sc.totals.histBatches > 0, `存在历史已出窗批次(${sc.totals.histBatches})`);
ok(sc.open.every(b => b.estRemaining >= 0), "所有在窗批次预计剩余退货 >= 0");
ok(Math.abs(sc.totals.estFinal - (sc.totals.openReturned + sc.totals.estRemaining)) < 1e-9,
  "合计: 预计最终退货 = 已退 + 预计剩余");
ok(sc.open.every(b => b.windowEnd > sc.asOf), "在窗批次出窗日均晚于数据截至日");
ok(sc.historical.every(b => b.windowEnd <= sc.asOf), "历史批次出窗日均不晚于截至日");
const noBasis = sc.open.filter(b => b.basis === "无历史样本");
ok(noBasis.length === 0, "所有在窗批次都找到历史依据");
ok(sc.basisTable.length > 0 && sc.basisTable.every(g => g.n >= 1 && g.p50 <= g.p75 && g.p75 <= g.p90),
  "历史依据表分位数有序");

// 参数敏感性: P90 的估算应不低于 P50
const scP50 = S.computeScenario(DS, { percentile: 0.5 });
const scP90 = S.computeScenario(DS, { percentile: 0.9 });
ok(scP90.totals.estRemaining >= scP50.totals.estRemaining - 1e-9,
  `P90 估算(${Math.round(scP90.totals.estRemaining)}) >= P50 估算(${Math.round(scP50.totals.estRemaining)})`);
// 窗口覆盖: 缩短窗口会让更多批次"出窗", 在窗批次减少
const scShort = S.computeScenario(DS, { windowMode: "override", overrideMonths: 3 });
ok(scShort.totals.openBatches <= sc.totals.openBatches,
  "缩短观察窗口后, 未到观察期批次不增多");

// 分位数函数
section("统计函数");
const arr = [0.05, 0.10, 0.15, 0.20];
ok(Math.abs(S.percentile(arr, 0.5) - 0.125) < 1e-9, "percentile P50 插值正确");
ok(Math.abs(S.percentile(arr, 0) - 0.05) < 1e-9, "percentile P0 = 最小值");
ok(Math.abs(S.percentile(arr, 1) - 0.20) < 1e-9, "percentile P100 = 最大值");

// ---------------------------------------------------------- 5. 月度序列
section("月度序列");
const ms = S.monthlySeries(DS, "latest");
const sumArr = a => a.reduce((t, x) => t + x, 0);
ok(sumArr(ms.shipped) === Object.values(aggL.perIsbn).reduce((t, v) => t + v.shipped, 0),
  "月度发货合计 = 发货总量");
ok(sumArr(ms.sold) === sumSold(aggL), "月度实销合计 = 实销总量(latest)");
ok(ms.months.every((m, i) => i === 0 || ms.months[i - 1] < m), "月份有序");

// ---------------------------------------------------------- 6. 版次关系
section("版次关系");
const edByIsbn = {};
for (const e of DS.editions) edByIsbn[e.isbn] = e;
const isbns = new Set(DS.editions.map(e => e.isbn));
ok(isbns.size === DS.editions.length, "ISBN 唯一(不同装帧不共用 ISBN)");
// 同一作品的不同装帧必须是不同版本记录(不合并统计)
const workBindings = {};
for (const e of DS.editions) {
  (workBindings[e.workId] || (workBindings[e.workId] = new Set())).add(e.binding);
}
const multiBinding = Object.entries(workBindings).filter(([, s]) => s.size > 1);
ok(multiBinding.length > 0, "存在同作品多装帧的示例(用于验证不合并展示)");
for (const e of DS.editions) {
  if (!e.supersedes) continue;
  const prev = DS.editions.find(x => x.id === e.supersedes);
  ok(prev && prev.isbn !== e.isbn && prev.workId === e.workId,
    `${e.isbn}: 再版换 ISBN 且指向同一作品上一版`);
  ok(prev && prev.binding === e.binding,
    `${e.isbn}: 再版接替保持装帧一致(平装接替平装, 不串精装)`);
}

console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
