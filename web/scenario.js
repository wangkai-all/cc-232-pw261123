/* 图书发行分析 · 纯逻辑模块(无 DOM, 浏览器与 node 共用)
 *
 * 职责:
 *  1. 修订链解析 —— 迟到实销/退书修订保留前后版本, 提供 "最新值" 与 "首次上报" 两种视图
 *  2. 流向对账   —— 发货 = 实销 + 退书 + 渠道在库; 印刷 = 发货 - 退书回库 + 社内库存
 *  3. 退货分摊   —— 渠道退货按发货先后(FIFO)分摊到批次
 *  4. 退书情景   —— 用已出窗的历史同类批次退书率, 估算未到观察期批次的剩余退货
 *     ⚠ 情景结果只是假设演算, 不是确定预测, 也绝不写回实际退书数据
 */
(function (root, factory) {
  const M = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = M;
  else root.Scenario = M;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ------------------------------------------------------------ 日期工具
  function parseDate(s) { return new Date(s + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addMonths(dateStr, m) {
    const d = parseDate(dateStr);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + m;
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(y, mo, Math.min(d.getUTCDate(), last))));
  }
  function monthsBetween(aStr, bStr) {
    const a = parseDate(aStr), b = parseDate(bStr);
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12
      + (b.getUTCMonth() - a.getUTCMonth())
      + (b.getUTCDate() - a.getUTCDate()) / 30.44;
  }
  function monthOf(dateStr) { return dateStr.slice(0, 7); }

  // ------------------------------------------------------------ 索引
  function index(dataset) {
    const editionsByIsbn = {}, worksById = {}, channelsById = {};
    for (const e of dataset.editions) editionsByIsbn[e.isbn] = e;
    for (const w of dataset.works) worksById[w.id] = w;
    for (const c of dataset.channels) channelsById[c.id] = c;
    return { editionsByIsbn, worksById, channelsById };
  }

  // ------------------------------------------------------------ 修订链
  // 每条链: 首次上报(根) -> 修订1 -> 修订2 ...; 两种视图都保留, 互不覆盖
  function resolveView(records, mode) {
    const superseded = new Set();
    for (const r of records) if (r.revisionOf) superseded.add(r.revisionOf);
    if (mode === "original") {          // 仅首次上报: 每条链的根
      return records.filter(r => !r.revisionOf);
    }
    // latest: 每条链的叶子(未被任何人取代)
    return records.filter(r => !superseded.has(r.id));
  }

  function revisionLog(dataset) {
    const { editionsByIsbn, worksById, channelsById } = index(dataset);
    const log = [];
    const collect = (records, kind, dateKey) => {
      const byId = {};
      for (const r of records) byId[r.id] = r;
      for (const r of records) {
        if (!r.revisionOf) continue;
        const prev = byId[r.revisionOf];
        if (!prev) continue;
        const ed = editionsByIsbn[r.isbn];
        const wk = worksById[ed.workId];
        log.push({
          kind,                                  // "实销" | "退书"
          title: wk.title, isbn: r.isbn,
          editionNo: ed.editionNo, binding: ed.binding,
          channel: channelsById[r.channelId].name,
          ref: dateKey === "period" ? r.period : r.returnDate,
          before: prev.qty, after: r.qty, delta: r.qty - prev.qty,
          revisedAt: r.reportedAt || r.recordedAt || r.returnDate,
          reason: r.reason || "",
        });
      }
    };
    collect(dataset.sales, "实销", "period");
    collect(dataset.returns, "退书", "returnDate");
    return log.sort((a, b) => a.revisedAt < b.revisedAt ? -1 : 1);
  }

  // ------------------------------------------------------------ 流向汇总
  // mode: "latest"(含迟到修订) | "original"(仅首次上报)
  function aggregate(dataset, mode) {
    const sales = resolveView(dataset.sales, mode);
    const returns = resolveView(dataset.returns, mode);
    const pair = {};   // isbn|channelId -> {shipped, sold, returned}
    const perIsbn = {};
    const ensure = (o, k) => o[k] || (o[k] = { shipped: 0, sold: 0, returned: 0 });
    for (const s of dataset.shipments) {
      ensure(pair, s.isbn + "|" + s.channelId).shipped += s.qty;
      ensure(perIsbn, s.isbn).shipped += s.qty;
    }
    for (const r of sales) {
      ensure(pair, r.isbn + "|" + r.channelId).sold += r.qty;
      ensure(perIsbn, r.isbn).sold += r.qty;
    }
    for (const r of returns) {
      ensure(pair, r.isbn + "|" + r.channelId).returned += r.qty;
      ensure(perIsbn, r.isbn).returned += r.qty;
    }
    for (const p of dataset.printRuns) {
      ensure(perIsbn, p.isbn).printed = (perIsbn[p.isbn].printed || 0) + p.qty;
    }
    for (const k of Object.keys(pair)) {
      const v = pair[k];
      v.stock = v.shipped - v.sold - v.returned;   // 渠道在库(压货)
    }
    for (const k of Object.keys(perIsbn)) {
      const v = perIsbn[k];
      v.printed = v.printed || 0;
      v.warehouse = v.printed - v.shipped + v.returned; // 退书回社内库
    }
    return { pair, perIsbn };
  }

  // ------------------------------------------------------------ 退货 FIFO 分摊到批次
  function allocateReturns(dataset, mode) {
    const returns = resolveView(dataset.returns, mode);
    const byPair = {};
    for (const s of dataset.shipments) {
      const k = s.isbn + "|" + s.channelId;
      (byPair[k] || (byPair[k] = { batches: [], returns: [] })).batches.push(s);
    }
    for (const r of returns) {
      const k = r.isbn + "|" + r.channelId;
      if (byPair[k]) byPair[k].returns.push(r);
    }
    const alloc = {};   // batchId -> 分摊到的退货量
    for (const k of Object.keys(byPair)) {
      const { batches, returns: rets } = byPair[k];
      batches.sort((a, b) => a.shipDate < b.shipDate ? -1 : 1);
      let remaining = rets.reduce((t, r) => t + r.qty, 0);
      for (const b of batches) {
        const take = Math.min(remaining, b.qty);
        alloc[b.id] = take;
        remaining -= take;
      }
    }
    return alloc;
  }

  // ------------------------------------------------------------ 月度序列(趋势图)
  function monthlySeries(dataset, mode) {
    const sales = resolveView(dataset.sales, mode);
    const returns = resolveView(dataset.returns, mode);
    const months = new Set();
    const ship = {}, sold = {}, ret = {};
    for (const s of dataset.shipments) {
      const m = monthOf(s.shipDate); months.add(m);
      ship[m] = (ship[m] || 0) + s.qty;
    }
    for (const r of sales) {
      months.add(r.period);
      sold[r.period] = (sold[r.period] || 0) + r.qty;
    }
    for (const r of returns) {
      const m = monthOf(r.returnDate); months.add(m);
      ret[m] = (ret[m] || 0) + r.qty;
    }
    const sorted = [...months].sort();
    return {
      months: sorted,
      shipped: sorted.map(m => ship[m] || 0),
      sold: sorted.map(m => sold[m] || 0),
      returned: sorted.map(m => ret[m] || 0),
    };
  }

  // ------------------------------------------------------------ 统计工具
  function percentile(sortedAsc, p) {
    if (!sortedAsc.length) return 0;
    if (sortedAsc.length === 1) return sortedAsc[0];
    const h = (sortedAsc.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (h - lo);
  }
  const CURVES = {
    linear: t => t,                    // 匀速
    front: t => 1 - (1 - t) * (1 - t), // 前重(退货集中在窗口前段)
    back: t => t * t,                  // 后重
  };

  // ------------------------------------------------------------ 退书情景
  // params: {
  //   windowMode: "agreed" | "override", overrideMonths: number,
  //   percentile: 0.5 | 0.75 | 0.9,
  //   minSamples: number,
  //   mode: "netOfActual" | "curve",   // 剩余退货的估算方式
  //   curve: "linear" | "front" | "back"
  // }
  function computeScenario(dataset, params) {
    const asOf = dataset.meta.asOf;
    const { editionsByIsbn, worksById, channelsById } = index(dataset);
    const alloc = allocateReturns(dataset, "latest");
    const p = Object.assign({
      windowMode: "agreed", overrideMonths: 12, percentile: 0.75,
      minSamples: 3, mode: "netOfActual", curve: "front",
    }, params || {});

    // 批次画像
    const batches = dataset.shipments.map(s => {
      const ed = editionsByIsbn[s.isbn];
      const wk = worksById[ed.workId];
      const ch = channelsById[s.channelId];
      const winMonths = p.windowMode === "override" ? p.overrideMonths : s.windowMonths;
      const windowEnd = addMonths(s.shipDate, winMonths);
      const elapsed = monthsBetween(s.shipDate, asOf);
      const elapsedFrac = Math.max(0, Math.min(1, elapsed / winMonths));
      return {
        id: s.id, isbn: s.isbn, channelId: s.channelId,
        title: wk.title, category: wk.category,
        editionNo: ed.editionNo, binding: ed.binding,
        channel: ch.name, channelType: ch.type,
        shipDate: s.shipDate, qty: s.qty, windowMonths: winMonths,
        windowEnd, elapsedFrac,
        outOfWindow: windowEnd <= asOf,
        returned: alloc[s.id] || 0,
      };
    });

    // 历史依据: 已出窗批次的实际退书率, 按相似层级分组
    const historical = batches.filter(b => b.outOfWindow && b.qty > 0);
    const LEVELS = [
      { key: "catChan", label: "同类·同渠道", fn: b => b.category + "|" + b.channelId },
      { key: "catType", label: "同类·同渠道类型", fn: b => b.category + "|" + b.channelType },
      { key: "cat", label: "同类(全部渠道)", fn: b => b.category },
      { key: "type", label: "同渠道类型(全部类别)", fn: b => b.channelType },
      { key: "all", label: "全部历史批次", fn: () => "all" },
    ];
    const groups = {};   // levelKey|groupKey -> rates[]
    for (const lv of LEVELS) {
      for (const b of historical) {
        const gk = lv.key + "|" + lv.fn(b);
        (groups[gk] || (groups[gk] = [])).push(b.returned / b.qty);
      }
    }
    const pickRate = b => {
      for (const lv of LEVELS) {
        const gk = lv.key + "|" + lv.fn(b);
        const rates = groups[gk];
        if (rates && rates.length >= p.minSamples) {
          const sorted = [...rates].sort((x, y) => x - y);
          return { rate: percentile(sorted, p.percentile), basis: lv.label, n: rates.length };
        }
      }
      return { rate: 0, basis: "无历史样本", n: 0 };
    };

    // 未到观察期批次: 逐批估算
    const curveF = CURVES[p.curve] || CURVES.linear;
    const open = [];
    for (const b of batches.filter(x => !x.outOfWindow)) {
      const { rate, basis, n } = pickRate(b);
      const estTotal = b.qty * rate;
      let estRemaining;
      if (p.mode === "curve") {
        // 按退货曲线: 假设最终退货按曲线节奏发生, 剩余 = 总量 × 未到位的曲线比例
        estRemaining = Math.max(0, estTotal * (1 - curveF(b.elapsedFrac)));
      } else {
        // 按总量扣已退: 剩余 = 情景总量 - 实际已退
        estRemaining = Math.max(0, estTotal - b.returned);
      }
      open.push(Object.assign({}, b, {
        rateUsed: rate, basis, samples: n,
        estTotal, estRemaining,
        expectedByCurve: estTotal * curveF(b.elapsedFrac),
        overScenario: b.returned > estTotal,   // 实际已退超过情景总量
      }));
    }

    // 历史依据汇总表(同类·同渠道类型 粒度, 供界面展示)
    const basisTable = [];
    for (const lv of LEVELS) {
      if (lv.key !== "catType") continue;
      const keys = new Set(historical.map(b => lv.fn(b)));
      for (const k of [...keys].sort()) {
        const rates = (groups[lv.key + "|" + k] || []).slice().sort((a, b) => a - b);
        if (!rates.length) continue;
        basisTable.push({
          group: k, n: rates.length,
          p50: percentile(rates, 0.5), p75: percentile(rates, 0.75),
          p90: percentile(rates, 0.9),
          mean: rates.reduce((t, x) => t + x, 0) / rates.length,
        });
      }
    }

    const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
    return {
      params: p, asOf,
      batches, open, historical, basisTable,
      totals: {
        openBatches: open.length,
        openShipped: sum(open, b => b.qty),
        openReturned: sum(open, b => b.returned),
        estRemaining: sum(open, b => b.estRemaining),
        estFinal: sum(open, b => b.returned + b.estRemaining),
        histBatches: historical.length,
        histRate: historical.length
          ? sum(historical, b => b.returned) / sum(historical, b => b.qty) : 0,
      },
    };
  }

  return {
    parseDate, addMonths, monthsBetween, monthOf,
    index, resolveView, revisionLog, aggregate, allocateReturns,
    monthlySeries, percentile, computeScenario, CURVES,
  };
});
