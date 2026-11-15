/* DOM 冒烟测试: 用 jsdom 真实加载页面, 逐视图检查渲染与关键数字。
   运行: node tools/smoke_dom.js   (需要 jsdom, 默认从 /tmp/bk-test/node_modules 加载) */
"use strict";
const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  ({ JSDOM } = require("/tmp/bk-test/node_modules/jsdom"));
} catch {
  try { ({ JSDOM } = require("jsdom")); }
  catch {
    console.log("跳过: 未找到 jsdom (npm install jsdom 后可运行)");
    process.exit(0);
  }
}

const web = p => fs.readFileSync(path.join(__dirname, "../web", p), "utf8");
const html = web("index.html")
  .replace('<link rel="stylesheet" href="styles.css">', "")
  .replace("<script src=\"data.js\"></script>", `<script>${web("data.js")}</script>`)
  .replace("<script src=\"scenario.js\"></script>", `<script>${web("scenario.js")}</script>`)
  .replace("<script src=\"app.js\"></script>", `<script>${web("app.js")}</script>`);

const errors = [];
const { VirtualConsole } = require("/tmp/bk-test/node_modules/jsdom");
const vc = new VirtualConsole();
vc.on("jsdomError", e => errors.push("jsdomError: " + e.message));
vc.on("error", m => errors.push("console.error: " + m));

const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: true });
const { document } = dom.window;

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log("  ✓ " + label);
  else { failures++; console.error("  ✗ " + label); }
};
const txt = el => el ? el.textContent : "";
const num = s => Number(String(s).replace(/[^\d.-]/g, ""));
// 可见文本(排除 <script>/<style> 源码)
const bodyText = () => {
  const c = document.body.cloneNode(true);
  c.querySelectorAll("script,style").forEach(n => n.remove());
  return c.textContent;
};

// ---------------------------------------------------------- 初始渲染
console.log("[总览]");
ok(document.querySelectorAll("#tabs button").length === 6, "6 个视图页签");
const kpis = [...document.querySelectorAll(".kpi")];
ok(kpis.length === 6, "6 个 KPI 卡片");
const kpiVal = i => num(kpis[i].querySelector(".value").textContent);
const [shipped, sold, ret, stock] = [0, 1, 2, 3].map(kpiVal);
ok(shipped === sold + ret + stock,
  `KPI 对账: 发货${shipped} = 实销${sold} + 退书${ret} + 在库${stock}`);
ok(document.querySelector("svg"), "趋势图 SVG 已渲染");
ok(document.querySelectorAll(".legend .item").length >= 3, "趋势图图例 ≥3 项");
ok(bodyText().includes("含迟到修订"), "默认计入迟到修订并显示提示");
// 表格切换
const segBtns = [...document.querySelectorAll("button.seg")];
segBtns.find(b => b.textContent === "表格").click();
ok(document.querySelector("table.data"), "趋势图可切换到表格视图");
segBtns.find(b => b.textContent === "表格") && [...document.querySelectorAll("button.seg")].find(b => b.textContent === "图表").click();

// ---------------------------------------------------------- 图书明细
console.log("[图书明细]");
[...document.querySelectorAll("#tabs button")].find(b => b.textContent === "图书明细").click();
ok(bodyText().includes("各渠道去向"), "去向表标题存在");
ok(bodyText().includes("分别统计, 不做合并") || bodyText().includes("不做合并"),
  "多装帧不合并提示存在");
const chips = [...document.querySelectorAll(".chip")];
ok(chips.length >= 3, "《潮汐算法》有 ≥3 个版本芯片(平装/精装/第2版)");
// 切到精装版, 确认 ISBN 不串
chips.find(c => c.textContent.includes("精装")).click();
ok(bodyText().includes("9787021000024"), "精装版 ISBN 正确显示");
ok(document.querySelectorAll(".segbar").length >= 3, "去向分段条按渠道渲染");
// 换到 2025-12 出版的《食帖·山野》, 其批次应仍在观察窗口内
const workSel = document.querySelector("select");
workSel.value = "W8";
workSel.dispatchEvent(new dom.window.Event("change"));
const tags = [...document.querySelectorAll(".tag.open")];
ok(tags.length > 0, "新出版品种存在「未到观察期」批次标识");

// ---------------------------------------------------------- 版次对比
console.log("[版次对比]");
[...document.querySelectorAll("#tabs button")].find(b => b.textContent === "版次对比").click();
ok(bodyText().includes("版本指标对比"), "指标对比表存在");
ok(bodyText().includes("累计动销率"), "累计动销曲线存在");
const cmpHeaders = [...document.querySelectorAll("table.data th")].map(th => th.textContent);
ok(cmpHeaders.some(h => h.includes("精装")) && cmpHeaders.some(h => h.includes("平装")),
  "对比表同时列出精装与平装(未合并)");

// ---------------------------------------------------------- 退书情景
console.log("[退书情景]");
[...document.querySelectorAll("#tabs button")].find(b => b.textContent === "退书情景").click();
ok(bodyText().includes("情景估算, 不是确定预测"), "显著的非预测声明");
ok(bodyText().includes("不写入实际退书数据"), "估算不写入实际数据声明");
ok(bodyText().includes("预计差额的来源"), "预计差额来源表存在");
const before1 = document.querySelectorAll("table.data tr").length;
[...document.querySelectorAll("button")].find(b => b.textContent === "展开全部").click();
const after1 = document.querySelectorAll("table.data tr").length;
ok(after1 > before1, `展开全部后行数增加(${before1}→${after1})`);
// 调参: P50 -> P90, 预计差额 tile 不变小
const tileEst = () => num([...document.querySelectorAll(".kpi .label")]
  .find(l => l.textContent.includes("预计差额")).nextElementSibling.textContent);
const sel = [...document.querySelectorAll("select")][0];
sel.value = "0.5";
sel.dispatchEvent(new dom.window.Event("change"));
const estP50 = tileEst();
sel.value = "0.9";
sel.dispatchEvent(new dom.window.Event("change"));
const estP90 = tileEst();
ok(estP90 >= estP50, `调参生效: P90 预计差额(${estP90}) >= P50(${estP50})`);
ok(bodyText().includes("历史依据"), "历史依据表存在");

// ---------------------------------------------------------- 修订记录
console.log("[修订记录]");
[...document.querySelectorAll("#tabs button")].find(b => b.textContent === "修订记录").click();
const revRows = document.querySelectorAll("table.data tbody tr").length;
ok(revRows >= 15, `修订台账行数 ${revRows} >= 15`);
ok(bodyText().includes("首次值") && bodyText().includes("修订值"),
  "前后版本列均存在");

// ---------------------------------------------------------- 数据导出
console.log("[数据导出]");
[...document.querySelectorAll("#tabs button")].find(b => b.textContent === "数据导出").click();
const expItems = [...document.querySelectorAll(".export-item")];
ok(expItems.length === 7, "7 个导出项");
ok(bodyText().includes("退书情景估算(非实际数据)"), "情景估算导出明确标注非实际数据");

// ---------------------------------------------------------- 顶栏开关
console.log("[视图开关]");
document.getElementById("mode-toggle").click();   // 关掉迟到修订
ok(!bodyText().includes("含迟到修订 +"), "关闭后不再显示迟到修订增量");
document.getElementById("mode-toggle").click();

ok(errors.length === 0, "运行期无 JS 错误" + (errors.length ? ": " + errors[0] : ""));

console.log(failures === 0 ? "\nDOM 冒烟测试全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
