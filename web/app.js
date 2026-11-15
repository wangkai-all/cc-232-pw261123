/* 图书发行数据分析 · 前端应用(无依赖, 直接操作 DOM) */
/* global DATASET, Scenario */
"use strict";

const DS = window.DATASET;
const SC = window.Scenario;
const IDX = SC.index(DS);
const AS_OF = DS.meta.asOf;

// ------------------------------------------------------------ 状态
const state = {
  view: "overview",
  mode: "latest",            // latest=计入迟到修订 | original=仅首次上报
  bookWorkId: "W1",
  bookIsbn: null,
  compareWorkId: "W1",
  scenario: {                // 情景参数(默认值)
    windowMode: "agreed", overrideMonths: 12,
    percentile: 0.75, minSamples: 3,
    mode: "netOfActual", curve: "front",
  },
  scenarioGroupBy: "channel",
  expanded: new Set(),       // 情景树展开的节点
  revFilter: "全部",
  chartTable: new Set(),     // 处于"表格"视图的图表 id
};

// ------------------------------------------------------------ DOM 工具
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function svgText(x, y, str, attrs) {
  const t = s("text", Object.assign({ x, y }, attrs || {}));
  t.textContent = str;
  return t;
}

// ------------------------------------------------------------ 格式化
const fmtInt = n => Math.round(n).toLocaleString("zh-CN");
const fmtPct = (x, d = 1) => (x * 100).toFixed(d) + "%";
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function palette() {
  return {
    ship: cssVar("--c-ship"), sold: cssVar("--c-sold"), ret: cssVar("--c-ret"),
    stock: cssVar("--c-stock"), est: cssVar("--c-est"),
    s1: cssVar("--series-1"), s2: cssVar("--series-2"), s3: cssVar("--series-3"),
    s4: cssVar("--series-4"), s5: cssVar("--series-5"),
    grid: cssVar("--grid"), baseline: cssVar("--baseline"),
    surface: cssVar("--surface"), muted: cssVar("--muted"),
  };
}
const edOf = isbn => IDX.editionsByIsbn[isbn];
const workOf = isbn => IDX.worksById[edOf(isbn).workId];
const edLabel = isbn => {
  const e = edOf(isbn);
  return `第${e.editionNo}版·${e.binding}`;
};
const fullEdLabel = isbn => {
  const e = edOf(isbn);
  return `${workOf(isbn).title} 第${e.editionNo}版 ${e.binding} (ISBN ${isbn})`;
};

// ------------------------------------------------------------ 提示框
const tipEl = document.getElementById("tip");
function showTip(tip, x, y) {
  tipEl.replaceChildren();
  if (tip.title) tipEl.append(h("div", { class: "t-title", text: tip.title }));
  for (const row of tip.rows) {
    tipEl.append(h("div", { class: "t-row" },
      row.color ? h("span", { class: "line-key", style: `background:${row.color}` }) : null,
      h("span", { text: row.name }),
      h("span", { class: "v", text: row.value })));
  }
  tipEl.style.display = "block";
  const w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
  tipEl.style.left = Math.min(x + 14, window.innerWidth - w - 10) + "px";
  tipEl.style.top = Math.max(8, y - hh - 12) + "px";
}
function hideTip() { tipEl.style.display = "none"; }
document.addEventListener("pointermove", e => {
  const t = e.target.closest && e.target.closest("[data-tip]");
  if (t && t._tip) showTip(t._tip, e.clientX, e.clientY);
  else if (!e.target.closest || !e.target.closest("#tip")) hideTip();
});
document.addEventListener("focusin", e => {
  const t = e.target.closest && e.target.closest("[data-tip]");
  if (t && t._tip) {
    const r = t.getBoundingClientRect();
    showTip(t._tip, r.left + r.width / 2, r.top);
  }
});
document.addEventListener("focusout", hideTip);
function attachTip(el, tip) {
  el.setAttribute("data-tip", "");
  el.setAttribute("tabindex", "0");
  el._tip = tip;
}

// ------------------------------------------------------------ 通用组件
function kpiTile(label, value, delta, dotColor) {
  return h("div", { class: "kpi" },
    h("div", { class: "label" },
      dotColor ? h("span", { class: "dot", style: `background:${dotColor}` }) : null, label),
    h("div", { class: "value", text: value }),
    delta ? h("div", { class: "delta" }, delta) : null);
}

function legend(items) { // items: [{name, color, kind: "line"|"rect"}]
  return h("div", { class: "legend" },
    items.map(i => h("span", { class: "item" },
      h("span", { class: i.kind === "rect" ? "rect-key" : "line-key", style: `background:${i.color}` }),
      i.name)));
}

// 图表卡片(含 图表/表格 切换 —— 表格视图保证不依赖颜色也能读到每个值)
function chartCard(id, title, sub, buildChart, tableData) {
  const asTable = state.chartTable.has(id);
  const body = asTable ? dataTable(tableData.headers, tableData.rows) : buildChart();
  return h("div", { class: "card" },
    h("div", { class: "chart-head" },
      h("h3", { text: title }),
      h("span", { class: "spacer" }),
      h("div", {},
        h("button", {
          class: "seg" + (asTable ? "" : " on"),
          onclick: () => { state.chartTable.delete(id); render(); },
        }, "图表"),
        h("button", {
          class: "seg" + (asTable ? " on" : ""),
          onclick: () => { state.chartTable.add(id); render(); },
        }, "表格"))),
    sub ? h("p", { class: "sub", text: sub }) : null,
    body);
}

function dataTable(headers, rows, rowClass) {
  return h("table", { class: "data" },
    h("thead", {}, h("tr", {}, headers.map(hd =>
      h("th", { class: hd.num ? "num" : "", text: hd.label })))),
    h("tbody", {}, rows.map((r, i) =>
      h("tr", { class: rowClass ? rowClass(r, i) : "" },
        r.cells.map(c => {
          const td = h("td", { class: c && c.num ? "num" : "" });
          if (c && c.el) td.append(c.el); else td.textContent = c && c.text != null ? c.text : (c == null ? "" : c);
          if (c && c.tip) attachTip(td, c.tip);
          return td;
        })))));
}
const C = (text, num) => ({ text, num: num !== false });   // 数字单元格
const T = text => ({ text, num: false });                   // 文本单元格
const EL = el => ({ el });                                  // 自定义元素单元格

// ------------------------------------------------------------ 折线图(带十字线)
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * p) return m * p;
  }
  return 10 * p;
}

function lineChart(opts) {
  // opts: {labels, series:[{name, color, values}], yFmt}
  const P = palette();
  const W = 860, H = 280, ml = 52, mr = 96, mt = 14, mb = 30;
  const pw = W - ml - mr, ph = H - mt - mb;
  const n = opts.labels.length;
  const maxV = niceMax(Math.max(1, ...opts.series.flatMap(sr => sr.values)));
  const x = i => ml + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = v => mt + ph - (v / maxV) * ph;
  // 同一根轴只用一种刻度风格: 达到万级则整轴用"万"
  const yFmt = opts.yFmt || (maxV >= 10000
    ? v => (v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "万"
    : fmtInt);

  const g = s("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  // 网格与轴
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (maxV / ticks) * i, yy = y(v);
    g.append(s("line", { x1: ml, x2: W - mr, y1: yy, y2: yy, stroke: P.grid, "stroke-width": 1 }));
    g.append(svgText(ml - 8, yy + 4, yFmt(v), { "text-anchor": "end", class: "axis-val" }));
  }
  // x 轴标签(稀疏)
  const step = Math.ceil(n / 8);
  for (let i = 0; i < n; i += step) {
    g.append(svgText(x(i), H - 8, opts.labels[i], { "text-anchor": "middle" }));
  }
  g.append(s("line", { x1: ml, x2: W - mr, y1: y(0), y2: y(0), stroke: P.baseline, "stroke-width": 1 }));

  // 系列线
  const endYs = [];
  for (const sr of opts.series) {
    const d = sr.values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("");
    g.append(s("path", { d, fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const li = sr.values.length - 1;
    g.append(s("circle", {
      cx: x(li), cy: y(sr.values[li]), r: 4, fill: sr.color,
      stroke: P.surface, "stroke-width": 2,
    }));
    endYs.push({ name: sr.name, color: sr.color, y: y(sr.values[li]) });
  }
  // 端点直接标注(间距够才标, 避免碰撞; 图例始终存在)
  endYs.sort((a, b) => a.y - b.y);
  for (let i = 0; i < endYs.length; i++) {
    const tooClose = endYs.some((o, j) => j !== i && Math.abs(o.y - endYs[i].y) < 13 && j < i);
    if (!tooClose) {
      g.append(svgText(W - mr + 10, endYs[i].y + 4, endYs[i].name, { class: "end-label" }));
    }
  }

  // 十字线层
  const cross = s("line", { x1: 0, x2: 0, y1: mt, y2: mt + ph, class: "crosshair", visibility: "hidden" });
  const dots = opts.series.map(sr => s("circle", {
    r: 5, fill: sr.color, stroke: P.surface, "stroke-width": 2, visibility: "hidden",
  }));
  g.append(cross, ...dots);
  const overlay = s("rect", {
    x: ml, y: mt, width: pw, height: ph, fill: "transparent", tabindex: 0,
    role: "img", "aria-label": "趋势图, 左右方向键移动查看各月数值",
  });
  g.append(overlay);
  const showAt = (i, cx, cy) => {
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    const rows = opts.series.map((sr, k) => {
      dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(sr.values[i]));
      dots[k].setAttribute("visibility", "visible");
      return { name: sr.name, value: fmtInt(sr.values[i]) + " 册", color: sr.color };
    });
    showTip({ title: opts.labels[i], rows }, cx, cy);
  };
  const hideCross = () => {
    cross.setAttribute("visibility", "hidden");
    dots.forEach(d => d.setAttribute("visibility", "hidden"));
    hideTip();
  };
  let ki = n - 1;
  overlay.addEventListener("pointermove", e => {
    const rect = g.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (W / rect.width);
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - ml) / pw) * (n - 1))));
    ki = i;
    showAt(i, e.clientX, e.clientY);
  });
  overlay.addEventListener("pointerleave", hideCross);
  overlay.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    ki = Math.max(0, Math.min(n - 1, ki + (e.key === "ArrowRight" ? 1 : -1)));
    const rect = g.getBoundingClientRect();
    showAt(ki, rect.left + (x(ki) / W) * rect.width, rect.top + 40);
  });
  overlay.addEventListener("blur", hideCross);
  return g;
}

// ------------------------------------------------------------ 排行条
function rankedBars(rows, color, opts) {
  // rows: [{name, value, tip}]
  const max = Math.max(1, ...rows.map(r => r.value));
  const wrap = h("div", {});
  for (const r of rows) {
    const fill = h("div", {
      class: "hbar-fill",
      style: `width:${(r.value / max * 100).toFixed(2)}%;background:${color}`,
    });
    const row = h("div", { class: "hbar-row" },
      h("span", { class: "name", text: r.name }),
      h("div", { class: "hbar-track" }, fill),
      h("span", { class: "val", text: (opts && opts.fmt || fmtInt)(r.value) }));
    if (r.tip) attachTip(row, r.tip);
    wrap.append(row);
  }
  return wrap;
}

// ------------------------------------------------------------ 细分段条(去向)
function segBar(parts) { // parts: [{name, value, color}]
  const total = parts.reduce((t, p) => t + p.value, 0);
  const bar = h("div", { class: "segbar", role: "img" });
  const label = parts.map(p => `${p.name} ${fmtInt(p.value)}册(${total ? fmtPct(p.value / total) : "0%"})`).join(", ");
  bar.setAttribute("aria-label", label);
  for (const p of parts) {
    if (p.value <= 0 || total <= 0) continue;
    const seg = h("div", { style: `width:${(p.value / total * 100).toFixed(2)}%;background:${p.color}` });
    attachTip(seg, {
      title: p.name,
      rows: [{ name: "数量", value: fmtInt(p.value) + " 册" }, { name: "占比", value: fmtPct(p.value / total) }],
    });
    bar.append(seg);
  }
  return bar;
}

// ------------------------------------------------------------ 视图: 总览
function viewOverview(root) {
  const P = palette();
  const agg = SC.aggregate(DS, state.mode);
  const aggO = SC.aggregate(DS, "original");
  const sum = (obj, f) => Object.values(obj).reduce((t, v) => t + f(v), 0);
  const shipped = sum(agg.perIsbn, v => v.shipped);
  const sold = sum(agg.perIsbn, v => v.sold);
  const ret = sum(agg.perIsbn, v => v.returned);
  const stock = shipped - sold - ret;
  const warehouse = sum(agg.perIsbn, v => v.warehouse);
  const lateDelta = sold - sum(aggO.perIsbn, v => v.sold);
  const sc = SC.computeScenario(DS, state.scenario);

  root.append(h("p", { class: "view-desc", text:
    "发货、渠道实销、退书、库存与版次关系的总览。发到渠道 ≠ 卖给读者: " +
    "「渠道在库」是已发货但尚未实销也未退回的压货量。" }));

  root.append(h("div", { class: "kpis" },
    kpiTile("总发货", fmtInt(shipped), null, P.ship),
    kpiTile("渠道实销", fmtInt(sold),
      state.mode === "latest" && lateDelta > 0
        ? [h("span", { class: "up", text: `含迟到修订 +${fmtInt(lateDelta)}` }), " · 动销率 " + fmtPct(sold / shipped)]
        : "动销率 " + fmtPct(sold / shipped), P.sold),
    kpiTile("退书(实际)", fmtInt(ret), "退书率 " + fmtPct(ret / shipped), P.ret),
    kpiTile("渠道在库(压货)", fmtInt(stock), "占发货 " + fmtPct(stock / shipped), P.stock),
    kpiTile("社内库存", fmtInt(warehouse), "印刷 " + fmtInt(sum(agg.perIsbn, v => v.printed)) + " 册", null),
    kpiTile("未到观察期批次", String(sc.totals.openBatches),
      [`在窗发货 ${fmtInt(sc.totals.openShipped)} 册`, h("br"),
       `情景预计差额 ${fmtInt(sc.totals.estRemaining)} 册(估算)`], P.est)));

  // 月度趋势
  const ms = SC.monthlySeries(DS, state.mode);
  root.append(chartCard("ov-trend", "月度发货 / 实销 / 退书",
    state.mode === "latest" ? "实销与退书为修订链最新值(含迟到修订)" : "实销与退书为首次上报值(不含迟到修订)",
    () => h("div", {},
      legend([
        { name: "发货", color: P.ship, kind: "line" },
        { name: "实销", color: P.sold, kind: "line" },
        { name: "退书", color: P.ret, kind: "line" },
      ]),
      lineChart({
        labels: ms.months,
        series: [
          { name: "发货", color: P.ship, values: ms.shipped },
          { name: "实销", color: P.sold, values: ms.sold },
          { name: "退书", color: P.ret, values: ms.returned },
        ],
      })),
    {
      headers: [{ label: "月份" }, { label: "发货", num: 1 }, { label: "实销", num: 1 }, { label: "退书", num: 1 }],
      rows: ms.months.map((m, i) => ({ cells: [T(m), C(ms.shipped[i] && fmtInt(ms.shipped[i]) || "0"),
        C(fmtInt(ms.sold[i])), C(fmtInt(ms.returned[i]))] })),
    }));

  // 渠道在库排行 + 在窗提醒
  const byChan = {};
  for (const [k, v] of Object.entries(agg.pair)) {
    const cid = k.split("|")[1];
    byChan[cid] = byChan[cid] || { shipped: 0, sold: 0, returned: 0, stock: 0 };
    byChan[cid].shipped += v.shipped; byChan[cid].sold += v.sold;
    byChan[cid].returned += v.returned; byChan[cid].stock += v.stock;
  }
  const rows = Object.entries(byChan)
    .map(([cid, v]) => ({
      name: IDX.channelsById[cid].name, value: v.stock,
      tip: {
        title: IDX.channelsById[cid].name,
        rows: [
          { name: "发货", value: fmtInt(v.shipped) + " 册", color: P.ship },
          { name: "实销", value: fmtInt(v.sold) + " 册", color: P.sold },
          { name: "退书", value: fmtInt(v.returned) + " 册", color: P.ret },
          { name: "在库(压货)", value: fmtInt(v.stock) + " 册 · " + fmtPct(v.stock / v.shipped), color: P.stock },
        ],
      },
    }))
    .sort((a, b) => b.value - a.value);

  const twoCol = h("div", { class: "grid-2" });
  twoCol.append(h("div", { class: "card" },
    h("h3", { text: "渠道在库(压货)排行" }),
    h("p", { class: "sub", text: "已发货、未实销、未退回的库存, 是退书压力的来源" }),
    rankedBars(rows, P.stock)));

  const openCard = h("div", { class: "card" },
    h("h3", { text: "未到观察期批次" }),
    h("p", { class: "sub", text: "约定退书窗口尚未关闭的批次, 最终退货未知, 单独列示; 情景估算见「退书情景」页" }));
  const openRows = sc.open.slice().sort((a, b) => b.qty - a.qty).slice(0, 8);
  openCard.append(dataTable(
    [{ label: "批次" }, { label: "图书 / 版本" }, { label: "渠道" },
     { label: "发货", num: 1 }, { label: "出窗日" }, { label: "状态" }],
    openRows.map(b => ({
      cells: [
        T(b.id),
        T(`${b.title} 第${b.editionNo}版·${b.binding}`),
        T(b.channel),
        C(fmtInt(b.qty)),
        T(b.windowEnd),
        EL(h("span", { class: "tag open", text: "未到观察期" })),
      ],
    }))));
  openCard.append(h("p", { class: "sub", text:
    `共 ${sc.totals.openBatches} 个批次在窗, 上表按发货量列前 8。` }));
  twoCol.append(openCard);
  root.append(twoCol);
}

// ------------------------------------------------------------ 视图: 图书明细
function viewBook(root) {
  const P = palette();
  const work = IDX.worksById[state.bookWorkId];
  const editions = DS.editions.filter(e => e.workId === work.id);
  if (!state.bookIsbn || !editions.some(e => e.isbn === state.bookIsbn)) {
    state.bookIsbn = editions[0].isbn;
  }
  const isbn = state.bookIsbn;
  const ed = edOf(isbn);
  const agg = SC.aggregate(DS, state.mode);

  // 选择器
  const sel = h("select", { onchange: e => { state.bookWorkId = e.target.value; state.bookIsbn = null; render(); } },
    DS.works.map(w => h("option", { value: w.id, selected: w.id === work.id ? "" : null },
      `《${w.title}》 ${w.author} · ${w.category}`)));
  root.append(h("div", { class: "card" },
    h("div", { class: "params" },
      h("div", { class: "param" }, h("span", { text: "选择图书" }), sel)),
    h("div", { class: "chips" },
      editions.map(e => h("button", {
        class: "chip" + (e.isbn === isbn ? " on" : ""),
        onclick: () => { state.bookIsbn = e.isbn; render(); },
      },
        h("div", { class: "t", text: `第${e.editionNo}版 · ${e.binding}` }),
        h("div", { class: "s", text: `ISBN ${e.isbn} · ${e.pubDate} 出版` })))),
    editions.length > 1
      ? h("p", { class: "lineage", text:
          `该作品有 ${editions.length} 个版本记录。换 ISBN 再版保留版本对应关系; ` +
          `不同装帧(如精装/平装)为独立 ISBN, 分别统计, 不做合并。` })
      : null));

  // 版本信息 + 接替关系
  const succ = DS.editions.find(e => e.supersedes === ed.id);
  const prev = ed.supersedes ? DS.editions.find(e => e.id === ed.supersedes) : null;
  const lineageBits = [];
  if (prev) lineageBits.push(h("span", {}, "接替 ",
    h("button", { onclick: () => { state.bookIsbn = prev.isbn; render(); } },
      `第${prev.editionNo}版·${prev.binding}`), " (换 ISBN 再版)"));
  if (succ) lineageBits.push(h("span", {}, "被 ",
    h("button", { onclick: () => { state.bookIsbn = succ.isbn; render(); } },
      `第${succ.editionNo}版·${succ.binding}`), " 接替"));
  root.append(h("div", { class: "card" },
    h("h3", { text: `${work.title} · 第${ed.editionNo}版 ${ed.binding}` }),
    h("p", { class: "sub", text:
      `ISBN ${ed.isbn} · ${ed.format} · 定价 ¥${ed.listPrice.toFixed(2)} · ` +
      `${ed.pubDate} 出版 · 第${ed.printing}次印刷 · ${ed.note}` }),
    lineageBits.length ? h("p", { class: "lineage" }, ...lineageBits) : null));

  // 流量 tiles
  const v = agg.perIsbn[isbn] || { shipped: 0, sold: 0, returned: 0, printed: 0, warehouse: 0 };
  root.append(h("div", { class: "kpis" },
    kpiTile("发货", fmtInt(v.shipped), null, P.ship),
    kpiTile("实销", fmtInt(v.sold), "动销率 " + (v.shipped ? fmtPct(v.sold / v.shipped) : "—"), P.sold),
    kpiTile("退书(实际)", fmtInt(v.returned), "退书率 " + (v.shipped ? fmtPct(v.returned / v.shipped) : "—"), P.ret),
    kpiTile("渠道在库", fmtInt(v.shipped - v.sold - v.returned), null, P.stock),
    kpiTile("社内库存", fmtInt(v.warehouse), "印刷 " + fmtInt(v.printed) + " 册", null),
    kpiTile("印次", `第${ed.printing}次`, null, null)));

  // 各渠道去向
  const chanRows = [];
  for (const c of DS.channels) {
    const pv = agg.pair[isbn + "|" + c.id] || { shipped: 0, sold: 0, returned: 0, stock: 0 };
    if (!pv.shipped) continue;
    chanRows.push({ c, ...pv });
  }
  chanRows.sort((a, b) => b.shipped - a.shipped);
  root.append(h("div", { class: "card" },
    h("h3", { text: "各渠道去向" }),
    h("p", { class: "sub", text: "每个渠道的发货最终去了哪里: 实销给读者、退回了社内、还是仍压在渠道" }),
    legend([
      { name: "实销", color: P.sold, kind: "rect" },
      { name: "已退", color: P.ret, kind: "rect" },
      { name: "渠道在库", color: P.stock, kind: "rect" },
    ]),
    dataTable(
      [{ label: "渠道" }, { label: "发货", num: 1 }, { label: "实销", num: 1 },
       { label: "已退", num: 1 }, { label: "在库", num: 1 }, { label: "动销率", num: 1 },
       { label: "去向构成" }],
      chanRows.map(r => ({
        cells: [
          T(r.c.name), C(fmtInt(r.shipped)), C(fmtInt(r.sold)), C(fmtInt(r.returned)),
          C(fmtInt(r.stock)), C(fmtPct(r.sold / r.shipped)),
          EL(segBar([
            { name: "实销", value: r.sold, color: P.sold },
            { name: "已退", value: r.returned, color: P.ret },
            { name: "渠道在库", value: r.stock, color: P.stock },
          ])),
        ],
      })))));

  // 批次表(未到观察期单独标识)
  const alloc = SC.allocateReturns(DS, state.mode);
  const batches = DS.shipments.filter(sh => sh.isbn === isbn)
    .sort((a, b) => a.shipDate < b.shipDate ? -1 : 1);
  root.append(h("div", { class: "card" },
    h("h3", { text: "发货批次与退书窗口" }),
    h("p", { class: "sub", text:
      "退货按发货先后(FIFO)分摊到批次。窗口未关闭的批次退货尚未完结, 单独标识, 其最终退货见「退书情景」估算。" }),
    dataTable(
      [{ label: "批次" }, { label: "渠道" }, { label: "发货日" }, { label: "数量", num: 1 },
       { label: "窗口" }, { label: "出窗日" }, { label: "状态" },
       { label: "已分摊退货", num: 1 }, { label: "退货率", num: 1 }],
      batches.map(b => {
        const wEnd = SC.addMonths(b.shipDate, b.windowMonths);
        const open = wEnd > AS_OF;
        const ra = alloc[b.id] || 0;
        return {
          cells: [
            T(b.id), T(IDX.channelsById[b.channelId].name), T(b.shipDate), C(fmtInt(b.qty)),
            T(b.windowMonths + " 个月"), T(wEnd),
            EL(open ? h("span", { class: "tag open", text: "未到观察期" })
                    : h("span", { class: "tag closed", text: "已出窗" })),
            C(fmtInt(ra)), C(fmtPct(ra / b.qty)),
          ],
        };
      }))));

  // 该版本的修订记录
  const revs = SC.revisionLog(DS).filter(r => r.isbn === isbn);
  if (revs.length) {
    root.append(h("div", { class: "card" },
      h("h3", { text: "该版本的迟到修订(前后版本均保留)" }),
      dataTable(
        [{ label: "类型" }, { label: "渠道" }, { label: "期间/日期" },
         { label: "首次值", num: 1 }, { label: "修订值", num: 1 }, { label: "差额", num: 1 },
         { label: "修订时间" }, { label: "原因" }],
        revs.map(r => ({
          cells: [
            T(r.kind), T(r.channel), T(r.ref),
            C(fmtInt(r.before)), C(fmtInt(r.after)),
            C((r.delta > 0 ? "+" : "") + fmtInt(r.delta)),
            T(r.revisedAt), T(r.reason),
          ],
        })))));
  }
}

// ------------------------------------------------------------ 视图: 版次对比
function viewCompare(root) {
  const P = palette();
  const work = IDX.worksById[state.compareWorkId];
  const editions = DS.editions.filter(e => e.workId === work.id);
  const agg = SC.aggregate(DS, state.mode);
  const colors = [P.s1, P.s2, P.s3, P.s4];

  const sel = h("select", { onchange: e => { state.compareWorkId = e.target.value; render(); } },
    DS.works.map(w => h("option", { value: w.id, selected: w.id === work.id ? "" : null },
      `《${w.title}》 ${w.author}`)));
  root.append(h("div", { class: "card" },
    h("div", { class: "params" },
      h("div", { class: "param" }, h("span", { text: "选择图书" }), sel)),
    editions.length > 1
      ? h("p", { class: "lineage", text:
          "同一作品的各版次/装帧并列对比。再版换 ISBN 保留对应关系; 不同装帧是独立 ISBN, 全程分别统计, 不合并。" })
      : h("p", { class: "lineage", text: "该作品只有一个版本, 换其他作品可对比多版次。" })));

  if (editions.length < 1) return;

  // 指标对比表
  const metrics = [
    ["发货", v => fmtInt(v.shipped)],
    ["实销", v => fmtInt(v.sold)],
    ["退书(实际)", v => fmtInt(v.returned)],
    ["渠道在库", v => fmtInt(v.shipped - v.sold - v.returned)],
    ["社内库存", v => fmtInt(v.warehouse)],
    ["动销率", v => v.shipped ? fmtPct(v.sold / v.shipped) : "—"],
    ["退书率", v => v.shipped ? fmtPct(v.returned / v.shipped) : "—"],
  ];
  root.append(h("div", { class: "card" },
    h("h3", { text: "版本指标对比" }),
    h("p", { class: "sub", text: state.mode === "latest" ? "含迟到修订" : "仅首次上报" }),
    h("table", { class: "data" },
      h("thead", {}, h("tr", {},
        h("th", { text: "指标" }),
        editions.map(e => h("th", { class: "num" },
          h("span", { class: "dot", style: `background:${colors[editions.indexOf(e) % 4]};margin-right:6px` }),
          `第${e.editionNo}版·${e.binding}`)))),
      h("tbody", {},
        h("tr", {}, h("td", { text: "ISBN" }),
          editions.map(e => h("td", { class: "num", text: e.isbn }))),
        h("tr", {}, h("td", { text: "出版日期" }),
          editions.map(e => h("td", { class: "num", text: e.pubDate }))),
        metrics.map(([name, f]) => h("tr", {},
          h("td", { text: name }),
          editions.map(e => {
            const v = agg.perIsbn[e.isbn] || { shipped: 0, sold: 0, returned: 0, warehouse: 0 };
            return h("td", { class: "num", text: f(v) });
          })))))));

  // 累计动销曲线(按版龄对齐)
  const sales = SC.resolveView(DS.sales, state.mode);
  const series = editions.map((e, i) => {
    const shippedTotal = (agg.perIsbn[e.isbn] || {}).shipped || 0;
    const byMonth = {};
    for (const r of sales) {
      if (r.isbn !== e.isbn) continue;
      const mAge = Math.max(0, Math.round(SC.monthsBetween(e.pubDate, r.period + "-01")));
      byMonth[mAge] = (byMonth[mAge] || 0) + r.qty;
    }
    const maxAge = Math.max(0, ...Object.keys(byMonth).map(Number));
    const vals = [];
    let cum = 0;
    for (let m = 0; m <= maxAge; m++) {
      cum += byMonth[m] || 0;
      vals.push(shippedTotal ? cum / shippedTotal : 0);
    }
    return { name: `第${e.editionNo}版·${e.binding}`, color: colors[i % 4], values: vals };
  });
  const maxLen = Math.max(...series.map(sr => sr.values.length));
  const labels = Array.from({ length: maxLen }, (_, i) => `${i}`);
  root.append(chartCard("cmp-curve", "累计动销率 · 按版龄(月)对齐",
    "上市后第 N 个月累计实销占累计发货的比例; 版次之间起点对齐, 便于比较动销快慢",
    () => h("div", {},
      series.length >= 2
        ? legend(series.map(sr => ({ name: sr.name, color: sr.color, kind: "line" })))
        : null,
      lineChart({
        labels, series,
        yFmt: v => fmtPct(v, 0),
      })),
    {
      headers: [{ label: "版龄(月)" }, ...series.map(sr => ({ label: sr.name, num: 1 }))],
      rows: labels.map((m, i) => ({
        cells: [T(m), ...series.map(sr => C(sr.values[i] != null ? fmtPct(sr.values[i]) : "—"))],
      })),
    }));
}

// ------------------------------------------------------------ 视图: 退书情景
function viewScenario(root) {
  const P = palette();
  const p = state.scenario;
  const sc = SC.computeScenario(DS, p);

  root.append(h("div", { class: "banner" },
    h("span", { class: "icon", text: "⚠" }),
    h("div", {},
      h("strong", { text: "情景估算, 不是确定预测。" }),
      h("div", { text:
        "以下数字由「历史同类批次退书率 × 可调参数」演算得到, 用于评估退书压力的量级; " +
        "不构成对未来的确定结论, 估算值不写入实际退书数据, 实际退书以渠道退回为准。" }))));

  // 参数面板
  const num = (v, min, max, onch) => h("input", {
    type: "number", value: v, min, max, style: "width:76px",
    onchange: e => { onch(+e.target.value); render(); },
  });
  root.append(h("div", { class: "card" },
    h("h3", { text: "情景参数" }),
    h("div", { class: "params" },
      h("fieldset", { class: "param" },
        h("legend", { text: "观察窗口" }),
        h("label", { class: "radio" },
          h("input", {
            type: "radio", name: "wm", checked: p.windowMode === "agreed" ? "" : null,
            onchange: () => { p.windowMode = "agreed"; render(); },
          }), "按批次约定窗口"),
        h("label", { class: "radio" },
          h("input", {
            type: "radio", name: "wm", checked: p.windowMode === "override" ? "" : null,
            onchange: () => { p.windowMode = "override"; render(); },
          }), "统一覆盖为"),
        num(p.overrideMonths, 1, 36, v => p.overrideMonths = Math.max(1, Math.min(36, v || 12))),
        h("span", { text: "个月" })),
      h("div", { class: "param" },
        h("span", { text: "历史退书率取值" }),
        h("select", {
          onchange: e => { p.percentile = +e.target.value; render(); },
        },
          [[0.5, "P50(中位)"], [0.75, "P75(偏保守)"], [0.9, "P90(压力)"]].map(([v, l]) =>
            h("option", { value: v, selected: p.percentile === v ? "" : null }, l)))),
      h("div", { class: "param" },
        h("span", { text: "剩余退货估算方式" }),
        h("select", {
          onchange: e => { p.mode = e.target.value; render(); },
        },
          h("option", { value: "netOfActual", selected: p.mode === "netOfActual" ? "" : null },
            "按总量扣已退"),
          h("option", { value: "curve", selected: p.mode === "curve" ? "" : null },
            "按退货曲线节奏"))),
      p.mode === "curve" ? h("div", { class: "param" },
        h("span", { text: "退货曲线" }),
        h("select", {
          onchange: e => { p.curve = e.target.value; render(); },
        },
          [["front", "前重(早退多)"], ["linear", "匀速"], ["back", "后重(晚退多)"]].map(([v, l]) =>
            h("option", { value: v, selected: p.curve === v ? "" : null }, l)))) : null,
      h("div", { class: "param" },
        h("span", { text: "同类最少样本批次" }),
        num(p.minSamples, 1, 20, v => p.minSamples = Math.max(1, Math.min(20, v || 3)))))));

  // 结果 tiles
  const t = sc.totals;
  root.append(h("div", { class: "kpis" },
    kpiTile("未到观察期批次", String(t.openBatches), `历史已出窗 ${t.histBatches} 个`, null),
    kpiTile("在窗发货", fmtInt(t.openShipped), null, P.ship),
    kpiTile("在窗已退(实际)", fmtInt(t.openReturned),
      "占在窗发货 " + fmtPct(t.openReturned / Math.max(1, t.openShipped)), P.ret),
    kpiTile("预计差额(还需退回)", fmtInt(t.estRemaining),
      "情景估算值, 非实际数据", P.est),
    kpiTile("情景最终退书率", fmtPct(t.estFinal / Math.max(1, t.openShipped)),
      `(已退+预计差额)/在窗发货`, P.est),
    kpiTile("历史批次实际退书率", fmtPct(t.histRate),
      `${t.histBatches} 个已出窗批次`, null)));

  // 预计差额来源(可展开树)
  const groupKey = state.scenarioGroupBy === "channel"
    ? b => b.channel : b => `${b.title} 第${b.editionNo}版·${b.binding}`;
  const subKey = state.scenarioGroupBy === "channel"
    ? b => `${b.title} 第${b.editionNo}版·${b.binding}` : b => b.channel;
  const groups = new Map();
  for (const b of sc.open) {
    const g = groupKey(b);
    if (!groups.has(g)) groups.set(g, new Map());
    const sub = groups.get(g);
    const sk = subKey(b);
    if (!sub.has(sk)) sub.set(sk, []);
    sub.get(sk).push(b);
  }
  const sumF = (arr, f) => arr.reduce((tt, x) => tt + f(x), 0);
  const rows = [];
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const ea = sumF([...a[1].values()].flat(), x => x.estRemaining);
    const eb = sumF([...b[1].values()].flat(), x => x.estRemaining);
    return eb - ea;
  });
  for (const [gName, subs] of sortedGroups) {
    const gBatches = [...subs.values()].flat();
    const gShip = sumF(gBatches, x => x.qty), gRet = sumF(gBatches, x => x.returned);
    const gEst = sumF(gBatches, x => x.estRemaining), gEstT = sumF(gBatches, x => x.estTotal);
    const gk = "g|" + gName;
    const gOpen = state.expanded.has(gk);
    rows.push({ cls: "group", cells: [
      EL(h("span", {},
        h("button", { class: "chev", onclick: () => { toggle(gk); }, text: gOpen ? "▾" : "▸" }),
        gName)),
      C(fmtInt(gShip)), C(fmtInt(gRet)), C(fmtPct(gEstT / Math.max(1, gShip))),
      T("—"), EL(h("span", { class: "tag est", text: fmtInt(gEst) })),
    ] });
    if (!gOpen) continue;
    const sortedSubs = [...subs.entries()].sort((a, b) =>
      sumF(b[1], x => x.estRemaining) - sumF(a[1], x => x.estRemaining));
    for (const [sName, arr] of sortedSubs) {
      const sShip = sumF(arr, x => x.qty), sRet = sumF(arr, x => x.returned);
      const sEst = sumF(arr, x => x.estRemaining), sEstT = sumF(arr, x => x.estTotal);
      const sk = "s|" + gName + "|" + sName;
      const sOpen = state.expanded.has(sk);
      rows.push({ cls: "group-2", cells: [
        EL(h("span", { style: "padding-left:22px" },
          h("button", { class: "chev", onclick: () => { toggle(sk); }, text: sOpen ? "▾" : "▸" }),
          sName)),
        C(fmtInt(sShip)), C(fmtInt(sRet)), C(fmtPct(sEstT / Math.max(1, sShip))),
        T("—"), EL(h("span", { class: "tag est", text: fmtInt(sEst) })),
      ] });
      if (!sOpen) continue;
      for (const b of arr.slice().sort((x, y) => y.estRemaining - x.estRemaining)) {
        rows.push({ cls: "", cells: [
          EL(h("span", { style: "padding-left:46px", text: `${b.id} · ${b.shipDate} 发货` })),
          C(fmtInt(b.qty)), C(fmtInt(b.returned)), C(fmtPct(b.rateUsed)),
          T(`${b.basis} · n=${b.samples}`),
          EL(h("span", { class: "tag est", text: fmtInt(b.estRemaining) })),
        ] });
      }
    }
  }
  function toggle(k) {
    if (state.expanded.has(k)) state.expanded.delete(k); else state.expanded.add(k);
    render();
  }

  root.append(h("div", { class: "card" },
    h("div", { class: "chart-head" },
      h("h3", { text: "预计差额的来源(可展开)" }),
      h("span", { class: "spacer" }),
      h("div", {},
        h("button", {
          class: "seg" + (state.scenarioGroupBy === "channel" ? " on" : ""),
          onclick: () => { state.scenarioGroupBy = "channel"; render(); },
        }, "按渠道"),
        h("button", {
          class: "seg" + (state.scenarioGroupBy === "edition" ? " on" : ""),
          onclick: () => { state.scenarioGroupBy = "edition"; render(); },
        }, "按版本")),
      h("button", {
        onclick: () => {
          state.expanded = new Set();
          for (const [g, subs] of sortedGroups) {
            state.expanded.add("g|" + g);
            for (const sName of subs.keys()) state.expanded.add("s|" + g + "|" + sName);
          }
          render();
        },
      }, "展开全部"),
      h("button", { onclick: () => { state.expanded = new Set(); render(); } }, "全部收起")),
    h("p", { class: "sub", text:
      "「预计差额」= 情景下还需退回的数量(估算)。批次行展示所采用的历史退书率及其依据层级与样本数。" }),
    dataTable(
      [{ label: state.scenarioGroupBy === "channel" ? "渠道 / 版本 / 批次" : "版本 / 渠道 / 批次" },
       { label: "在窗发货", num: 1 }, { label: "已退(实际)", num: 1 },
       { label: "采用退书率", num: 1 }, { label: "依据" },
       { label: "预计差额(估算)", num: 1 }],
      rows, r => r.cls)));

  // 超情景批次
  const over = sc.open.filter(b => b.overScenario);
  if (over.length) {
    root.append(h("div", { class: "card" },
      h("h3", { text: "实际已退超过情景总量的批次" }),
      h("p", { class: "sub", text: "这些批次实际退货已高于当前情景估值, 可关注是否需要上调参数" }),
      dataTable(
        [{ label: "批次" }, { label: "图书 / 版本" }, { label: "渠道" },
         { label: "发货", num: 1 }, { label: "已退(实际)", num: 1 },
         { label: "情景总量", num: 1 }],
        over.map(b => ({ cells: [
          T(b.id), T(`${b.title} 第${b.editionNo}版·${b.binding}`), T(b.channel),
          C(fmtInt(b.qty)), C(fmtInt(b.returned)), C(fmtInt(b.estTotal)),
        ] })))));
  }

  // 历史依据
  root.append(h("div", { class: "card" },
    h("h3", { text: "历史依据: 已出窗批次退书率(同类·同渠道类型)" }),
    h("p", { class: "sub", text:
      `样本不足 ${p.minSamples} 个批次时, 向上回退到更宽的相似层级(同类→同渠道类型→全部)。` }),
    dataTable(
      [{ label: "类别 × 渠道类型" }, { label: "样本批次", num: 1 },
       { label: "P50", num: 1 }, { label: "P75", num: 1 },
       { label: "P90", num: 1 }, { label: "均值", num: 1 }],
      sc.basisTable.map(g => ({ cells: [
        T(g.group.replace("|", " × ")), C(String(g.n)),
        C(fmtPct(g.p50)), C(fmtPct(g.p75)), C(fmtPct(g.p90)), C(fmtPct(g.mean)),
      ] })))));
}

// ------------------------------------------------------------ 视图: 修订记录
function viewRevisions(root) {
  const log = SC.revisionLog(DS);
  const filtered = state.revFilter === "全部" ? log : log.filter(r => r.kind === state.revFilter);
  root.append(h("p", { class: "view-desc", text:
    "迟到实销与退书修订的完整台账: 每条修订保留首次值与修订值两个版本, " +
    "分析视图按顶栏开关选择采用「最新值」或「首次上报值」。" }));
  root.append(h("div", { class: "card" },
    h("div", { class: "chart-head" },
      h("h3", { text: `修订台账(${filtered.length} 条)` }),
      h("span", { class: "spacer" }),
      h("div", {}, ["全部", "实销", "退书"].map((k, i, arr) =>
        h("button", {
          class: "seg" + (state.revFilter === k ? " on" : ""),
          onclick: () => { state.revFilter = k; render(); },
        }, k)))),
    dataTable(
      [{ label: "类型" }, { label: "图书" }, { label: "版本" }, { label: "渠道" },
       { label: "期间/日期" }, { label: "首次值", num: 1 }, { label: "修订值", num: 1 },
       { label: "差额", num: 1 }, { label: "修订时间" }, { label: "原因" }],
      filtered.map(r => ({ cells: [
        T(r.kind),
        T(r.title),
        T(`第${r.editionNo}版·${r.binding}`),
        T(r.channel),
        T(r.ref),
        C(fmtInt(r.before)),
        C(fmtInt(r.after)),
        C((r.delta > 0 ? "+" : "") + fmtInt(r.delta)),
        T(r.revisedAt),
        T(r.reason),
      ] })))));
}

// ------------------------------------------------------------ 视图: 数据导出
function toCSV(headers, rows) {
  const esc = v => {
    const str = String(v == null ? "" : v);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  return "\uFEFF" + [headers.map(esc).join(","),
    ...rows.map(r => r.map(esc).join(","))].join("\r\n");}
function download(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || "text/csv") + ";charset=utf-8" });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function viewExport(root) {
  const agg = SC.aggregate(DS, "latest");
  const sc = SC.computeScenario(DS, state.scenario);
  const chanName = cid => IDX.channelsById[cid].name;

  const items = [
    {
      name: "发货明细", desc: `${DS.shipments.length} 行 · 批次/渠道/窗口`,
      file: "发货明细.csv",
      make: () => toCSV(
        ["批次", "ISBN", "书名", "版次", "装帧", "渠道", "发货日期", "数量", "折扣", "约定窗口(月)", "出窗日", "状态"],
        DS.shipments.map(sh => {
          const wEnd = SC.addMonths(sh.shipDate, sh.windowMonths);
          const e = edOf(sh.isbn);
          return [sh.id, sh.isbn, workOf(sh.isbn).title, `第${e.editionNo}版`, e.binding,
            chanName(sh.channelId), sh.shipDate, sh.qty, sh.discount, sh.windowMonths,
            wEnd, wEnd > AS_OF ? "未到观察期" : "已出窗"];
        })),
    },
    {
      name: "实销明细(含修订链)", desc: `${DS.sales.length} 行 · 首次上报与修订版本均在`,
      file: "实销明细_含修订.csv",
      make: () => toCSV(
        ["记录ID", "ISBN", "书名", "渠道", "期间", "数量", "上报日期", "记录性质", "修订自", "原因"],
        DS.sales.map(r => [r.id, r.isbn, workOf(r.isbn).title, chanName(r.channelId),
          r.period, r.qty, r.reportedAt, r.revisionOf ? "修订版" : "首次上报",
          r.revisionOf || "", r.reason || ""])),
    },
    {
      name: "退书明细(含修订链)", desc: `${DS.returns.length} 行 · 仅实际退货, 不含情景估算`,
      file: "退书明细_含修订.csv",
      make: () => toCSV(
        ["记录ID", "ISBN", "书名", "渠道", "退货日期", "数量", "记录性质", "修订自", "原因"],
        DS.returns.map(r => [r.id, r.isbn, workOf(r.isbn).title, chanName(r.channelId),
          r.returnDate, r.qty, r.revisionOf ? "修订版" : "首次上报",
          r.revisionOf || "", r.reason || ""])),
    },
    {
      name: "版本×渠道流向汇总", desc: "发货=实销+退书+在库 的对账口径",
      file: "版本渠道流向汇总.csv",
      make: () => {
        const rows = [];
        for (const [k, v] of Object.entries(agg.pair)) {
          const [isbn, cid] = k.split("|");
          const e = edOf(isbn);
          rows.push([isbn, workOf(isbn).title, `第${e.editionNo}版`, e.binding,
            chanName(cid), v.shipped, v.sold, v.returned, v.stock,
            v.shipped ? (v.sold / v.shipped * 100).toFixed(1) + "%" : ""]);
        }
        rows.sort((a, b) => a[0] < b[0] ? -1 : 1);
        return toCSV(
          ["ISBN", "书名", "版次", "装帧", "渠道", "发货", "实销(含迟到修订)", "退书", "渠道在库", "动销率"],
          rows);
      },
    },
    {
      name: "退书情景估算(非实际数据)", desc: `${sc.totals.openBatches} 行 · 当前情景参数演算, 不写入实际退书`,
      file: "退书情景估算_非实际数据.csv",
      make: () => toCSV(
        ["数据性质", "批次", "ISBN", "书名", "版本", "渠道", "发货日", "出窗日",
         "在窗发货", "已退(实际)", "采用退书率", "依据", "样本数", "预计差额(估算)"],
        sc.open.map(b => ["情景估算-非实际数据", b.id, b.isbn, b.title,
          `第${b.editionNo}版·${b.binding}`, b.channel, b.shipDate, b.windowEnd,
          b.qty, b.returned, (b.rateUsed * 100).toFixed(1) + "%",
          b.basis, b.samples, Math.round(b.estRemaining)])),
    },
    {
      name: "修订台账", desc: `${SC.revisionLog(DS).length} 行 · 迟到实销/退书修订前后值`,
      file: "修订台账.csv",
      make: () => toCSV(
        ["类型", "ISBN", "书名", "版本", "渠道", "期间/日期", "首次值", "修订值", "差额", "修订时间", "原因"],
        SC.revisionLog(DS).map(r => [r.kind, r.isbn, r.title,
          `第${r.editionNo}版·${r.binding}`, r.channel, r.ref,
          r.before, r.after, r.delta, r.revisedAt, r.reason])),
    },
    {
      name: "全部数据(JSON)", desc: "与页面加载的同一份虚构数据集",
      file: "dataset.json", mime: "application/json",
      make: () => JSON.stringify(DS, null, 1),
    },
  ];

  root.append(h("p", { class: "view-desc", text:
    "导出明细供线下核对。情景估算文件的每一行都标注「情景估算-非实际数据」, " +
    "与实际退书明细严格分开。" }));
  root.append(h("div", { class: "export-grid" },
    items.map(it => h("div", { class: "export-item" },
      h("div", { class: "meta" },
        h("div", { class: "name", text: it.name }),
        h("div", { class: "desc", text: it.desc })),
      h("button", {
        class: "primary",
        onclick: () => download(it.file, it.make(), it.mime),
      }, "导出")))));
}

// ------------------------------------------------------------ 框架
const VIEWS = [
  ["overview", "总览"],
  ["book", "图书明细"],
  ["compare", "版次对比"],
  ["scenario", "退书情景"],
  ["revisions", "修订记录"],
  ["export", "数据导出"],
];

function render() {
  const tabs = document.getElementById("tabs");
  tabs.replaceChildren(...VIEWS.map(([k, label]) =>
    h("button", {
      class: state.view === k ? "on" : "",
      onclick: () => { state.view = k; render(); },
    }, label)));

  const app = document.getElementById("app");
  app.replaceChildren();
  ({ overview: viewOverview, book: viewBook, compare: viewCompare,
     scenario: viewScenario, revisions: viewRevisions, export: viewExport })[state.view](app);
}

// 顶栏
document.getElementById("asof-badge").textContent = `数据截至 ${AS_OF}`;
document.getElementById("mode-toggle").addEventListener("change", e => {
  state.mode = e.target.checked ? "latest" : "original";
  render();
});
const themeBtn = document.getElementById("theme-toggle");
const savedTheme = (() => { try { return localStorage.getItem("bk-theme"); } catch { return null; } })();
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const dark = cur ? cur === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("bk-theme", next); } catch { /* 忽略 */ }
  render();
});

render();
