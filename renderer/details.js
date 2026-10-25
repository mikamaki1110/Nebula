// =====================================================================
// Nebula – Detailseiten (Klick auf eine Kachel der Übersicht)
// Prozessor, Grafikkarte, Arbeitsspeicher, Laufwerke, Netzwerk
// Nutzt Helfer und Zustand aus renderer.js (hw, fast, slow, procs, hist …)
// =====================================================================
(() => {
  let current = null;   // aktuell offene Detailseite
  let refs = {};        // DOM-Bereiche, die live aktualisiert werden
  const totals = { rx: 0, tx: 0 }; // Netzwerk seit Start von Nebula

  // ---------- Bausteine ----------
  const pct = (v) => `${Math.round(v)}%`;
  const deg = (v) => `${Math.round(v)}°`;

  function stat(label, value, sub = "", state = "") {
    const it = el("div", "card glass stat-item");
    if (state) it.dataset.state = state;
    it.append(el("div", "stat-item__label", label), el("div", "stat-item__value", value ?? "—"), el("div", "stat-item__sub", sub));
    return it;
  }

  function setStats(items) {
    refs.stats.replaceChildren(...items.filter(Boolean).map((i) => stat(...i)));
  }

  function card(title, extraHead) {
    const c = el("div", "card glass");
    const head = el("div", "card__head");
    head.append(el("h3", null, title));
    if (extraHead) head.append(extraHead);
    c.append(head);
    return c;
  }

  // Großes Diagramm mit Hilfslinien
  function chartCard(title, opts, legend) {
    const c = card(title, legend);
    c.classList.add("chart-card");
    const canvas = el("canvas", "chart-big");
    c.append(canvas);
    const chart = new Sparkline(canvas, { grid: true, ...opts });
    extraCharts.add(chart);
    return { card: c, chart };
  }

  function legend(a, b) {
    const l = el("div", "legend");
    const item = (cls, text) => { const s = el("span"); s.append(el("i", cls), document.createTextNode(text)); return s; };
    l.append(item("l1", a));
    if (b) l.append(item("l2", b));
    return l;
  }

  function table(headers, rows, numCols = []) {
    const t = el("table", "dtable");
    const thead = el("thead");
    const hr = el("tr");
    headers.forEach((h, i) => hr.append(el("th", numCols.includes(i) ? "num" : null, h)));
    thead.append(hr);
    const tbody = el("tbody");
    rows.forEach((r) => {
      const tr = el("tr");
      r.forEach((v, i) => {
        const td = el("td", numCols.includes(i) ? "num" : null);
        if (v instanceof Node) td.append(v); else td.textContent = v ?? "—";
        tr.append(td);
      });
      tbody.append(tr);
    });
    t.append(thead, tbody);
    return t;
  }

  function tempSpan(t) {
    if (t == null) return "—";
    return el("span", `t-${tempState(t)}`, `${t.toFixed(1)} °C`);
  }

  function emptyHint(text, withSetup = true) {
    const box = el("div", "empty");
    box.append(el("p", null, text));
    if (withSetup && !slow?.lhm.connected) {
      const b = el("button", "btn btn--ghost btn--small", "Zu den Sensoren");
      b.dataset.goto = "sensors";
      b.style.marginTop = "10px";
      box.append(b);
    }
    return box;
  }

  // LHM-Sensoren einer Hardware-Art (Icon-Dateiname von LibreHardwareMonitor)
  const lhmSensors = (re) => (slow?.lhm.sensors ?? []).filter((s) => re.test(s.hwIcon));

  function sensorGroupsCard(title, sensors) {
    const c = card(title);
    if (!sensors.length) { c.append(emptyHint("Detail-Sensoren kommen vom Sensor-Dienst.")); return c; }
    const groups = new Map();
    sensors.forEach((s) => {
      const k = `${s.hw} › ${s.group}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    const multiHw = new Set(sensors.map((s) => s.hw)).size > 1;
    groups.forEach((list, k) => {
      c.append(el("p", "sensor-group__label", multiHw ? k : k.split(" › ")[1]));
      list.forEach((s) => {
        const row = el("div", "sensor-row");
        const val = el("span", null, sensorValue(s));
        if (s.unit.includes("°C")) val.className = `t-${tempState(s.value)}`;
        row.append(el("span", null, s.name), val);
        c.append(row);
      });
    });
    return c;
  }

  function twoCols(...children) {
    const g = el("div", "grid grid--2");
    g.append(...children);
    return g;
  }

  // =====================================================================
  // Prozessor
  // =====================================================================
  // Führt die LHM-Sensoren je Kern zusammen: Takt, Last, Temperatur
  // (Intel: „Core #1“, „P-Core #1“ · AMD: „Core #1“, Last „CPU Core #1“)
  function coreRows() {
    const cpu = lhmSensors(/\/cpu\.png$/i);
    const cores = new Map();
    const get = (key) => {
      if (!cores.has(key)) cores.set(key, { key, clock: null, temp: null, loads: [] });
      return cores.get(key);
    };
    cpu.forEach((s) => {
      const m = s.name.replace(/^CPU /, "").match(/^((?:[PE]-)?Core #(\d+))(?: Thread #\d+)?$/i);
      if (!m) return;
      const c = get(m[1]);
      if (s.type === "Clock") c.clock = s.value;
      else if (s.type === "Temperature") c.temp = s.value;
      else if (s.type === "Load") c.loads.push(s.value);
    });
    const order = (k) => (/^P-/i.test(k) ? 0 : /^E-/i.test(k) ? 2000 : 1000) + Number(k.match(/\d+/)?.[0] ?? 0);
    return [...cores.values()].sort((a, b) => order(a.key) - order(b.key)).map((c) => ({
      ...c,
      load: c.loads.length ? c.loads.reduce((a, b) => a + b, 0) / c.loads.length : null,
    }));
  }

  function cpuPower() {
    const p = lhmSensors(/\/cpu\.png$/i).filter((s) => s.type === "Power");
    return (p.find((s) => /package/i.test(s.name)) ?? p[0])?.value ?? null;
  }

  const cpuPage = {
    build(body) {
      const c = hw?.cpu ?? {};
      const title = el("div", "detail-title");
      title.append(el("h2", null, c.name ?? "Prozessor"),
        el("p", null, [c.cores && `${c.cores} Kerne, ${c.threads} Threads`, c.socket && `Sockel ${c.socket}`, c.maxGHz && `bis ${c.maxGHz} GHz`].filter(Boolean).join(", ")));
      refs.stats = el("div", "stats");

      const load = chartCard("Auslastung", { size: HIST_FAST, max: 100, format: pct });
      load.chart.seed(hist.cpu);
      refs.loadChart = load.chart;
      const temp = chartCard("Temperatur", { size: HIST_SLOW, max: 100, format: deg });
      temp.chart.seed(hist.cpuTemp);
      refs.tempChart = temp.chart;

      const threads = card("Threads", el("span", "muted", "Auslastung je logischem Prozessor"));
      refs.threads = el("div", "thread-grid");
      threads.append(refs.threads);

      refs.cores = card("Kerne", el("span", "muted", "Takt, Last und Temperatur je Kern"));
      refs.coresBody = el("div");
      refs.cores.append(refs.coresBody);

      const specs = card("Technische Daten");
      specs.append(infoList([
        ["Hersteller", c.manufacturer],
        ["Kerne / Threads", c.cores ? `${c.cores} / ${c.threads}` : null],
        ["Basistakt", c.baseGHz ? `${c.baseGHz} GHz` : null],
        ["Max. Takt", c.maxGHz ? `${c.maxGHz} GHz` : null],
        ["Sockel", c.socket],
        ["L2-Cache", c.l2 ? fmtBytes(c.l2) : null],
        ["L3-Cache", c.l3 ? fmtBytes(c.l3) : null],
        ["Virtualisierung", c.virtualization == null ? null : c.virtualization ? "Aktiv" : "Aus"],
      ]));

      body.append(title, refs.stats, twoCols(load.card, temp.card), threads, twoCols(refs.cores, specs));
    },
    fast(f) {
      refs.loadChart.push(f.cpu);
      const grid = refs.threads;
      if (grid.childElementCount !== f.cores.length) {
        grid.replaceChildren(...f.cores.map((_, i) => {
          const t = el("div", "thread");
          t.append(el("span", "thread__fill"), el("span", "thread__name", `Thread ${i + 1}`), el("span", "thread__val", "—"));
          return t;
        }));
      }
      [...grid.children].forEach((t, i) => {
        t.children[0].style.height = `${f.cores[i]}%`;
        t.children[2].textContent = `${f.cores[i]}%`;
      });
      this.stats();
    },
    slow() {
      refs.tempChart.push(slow.cpuTemp);
      const rows = coreRows();
      refs.coresBody.replaceChildren(rows.length
        ? table(["Kern", "Takt", "Last", "Temperatur"], rows.map((r) => [
            r.key,
            r.clock != null ? `${Math.round(r.clock)} MHz` : "—",
            r.load != null ? `${r.load.toFixed(0)} %` : "—",
            tempSpan(r.temp),
          ]), [1, 2, 3])
        : emptyHint("Takt und Temperatur je Kern liefert der Sensor-Dienst."));
      this.stats();
    },
    stats() {
      const f = fast ?? {};
      const t = slow?.cpuTemp ?? null;
      const w = cpuPower();
      setStats([
        ["Auslastung", f.cpu != null ? `${f.cpu} %` : "—", `${f.cores?.length ?? "?"} Threads`],
        ["Temperatur", t != null ? `${Math.round(t)} °C` : "—", t != null ? slow.cpuTempSource : "Sensor-Dienst nötig", tempState(t)],
        ["Takt", f.cpuSpeed ? `${f.cpuSpeed.toFixed(2)} GHz` : "—", hw?.cpu?.baseGHz ? `Basis ${hw.cpu.baseGHz} GHz` : ""],
        ["Leistung", w != null ? `${Math.round(w)} W` : "—", w != null ? "Package" : "Sensor-Dienst nötig"],
        ["Prozesse", procs?.processCount ?? "—", "laufend"],
        ["Laufzeit", f.uptime ? fmtUptime(f.uptime) : "—", "seit Windows-Start"],
      ]);
    },
  };

  // =====================================================================
  // Grafikkarte
  // =====================================================================
  const gpuPage = {
    build(body) {
      const spec = hw?.gpus?.[0] ?? {};
      const title = el("div", "detail-title");
      title.append(el("h2", null, spec.model ?? "Grafikkarte"),
        el("p", null, [spec.vendor, spec.vramMB && `${fmtBytes(spec.vramMB * 1024 ** 2)} Grafikspeicher`, spec.driver && `Treiber ${spec.driver}`].filter(Boolean).join(", ")));
      refs.stats = el("div", "stats");

      const load = chartCard("Auslastung", { size: HIST_SLOW, max: 100, format: pct });
      load.chart.seed(hist.gpuLoad);
      refs.loadChart = load.chart;
      const temp = chartCard("Temperatur", { size: HIST_SLOW, max: 100, format: deg });
      temp.chart.seed(hist.gpuTemp);
      refs.tempChart = temp.chart;

      refs.sensors = el("div");
      const specs = card("Technische Daten");
      (hw?.gpus ?? []).forEach((g, i, all) => {
        if (all.length > 1) specs.append(el("p", "sensor-group__label", g.model));
        specs.append(infoList([
          ["Modell", all.length > 1 ? null : g.model],
          ["Hersteller", g.vendor],
          ["Grafikspeicher", g.vramMB ? fmtBytes(g.vramMB * 1024 ** 2) : null],
          ["Treiber", g.driver],
          ["Anschluss", g.bus],
        ]));
      });
      if (!hw?.gpus?.length) specs.append(el("p", "empty", "Keine Grafikkarte erkannt."));

      body.append(title, refs.stats, twoCols(load.card, temp.card), twoCols(refs.sensors, specs));
    },
    fast() {},
    slow() {
      const g = slow.gpus[0];
      refs.loadChart.push(g?.load ?? null);
      refs.tempChart.push(g?.temp ?? null);
      refs.sensors.replaceChildren(sensorGroupsCard("Alle Sensoren", lhmSensors(/\/(nvidia|ati|intel)\.png$/i)));
      this.stats();
    },
    stats() {
      const g = slow?.gpus?.[0];
      if (!g) { setStats([["Grafikkarte", "—", "Keine erkannt"]]); return; }
      setStats([
        ["Auslastung", g.load != null ? `${g.load} %` : "—", g.loadSource ?? ""],
        ["Temperatur", g.temp != null ? `${Math.round(g.temp)} °C` : "—", g.tempSource ?? "Sensor-Dienst nötig", tempState(g.temp)],
        g.hotspot != null && ["Hotspot", `${Math.round(g.hotspot)} °C`, "heißester Punkt", tempState(g.hotspot)],
        g.memUsed != null && g.memTotal && ["Grafikspeicher", fmtBytes(g.memUsed * 1024 ** 2), `von ${fmtBytes(g.memTotal * 1024 ** 2)}`],
        g.clock != null && ["Takt", `${g.clock} MHz`, "GPU-Kern"],
        g.fan != null && ["Lüfter", `${g.fan} %`, ""],
        g.power != null && ["Leistung", `${Math.round(g.power)} W`, ""],
      ]);
    },
  };

  // =====================================================================
  // Arbeitsspeicher
  // =====================================================================
  const ramPage = {
    build(body) {
      const m = hw?.memory ?? { modules: [] };
      const first = m.modules[0] ?? {};
      const title = el("div", "detail-title");
      title.append(el("h2", null, `${fmtBytes(m.total, 0)} Arbeitsspeicher`),
        el("p", null, [first.type, first.clock && `${first.clock} MHz`, m.modules.length && `${m.modules.length} Riegel`].filter(Boolean).join(", ")));
      refs.stats = el("div", "stats");

      const usage = chartCard("Belegung", { size: HIST_FAST, max: 100, format: pct });
      usage.chart.seed(hist.ram);
      refs.chart = usage.chart;

      const mods = card("Speicherriegel");
      mods.append(m.modules.length
        ? table(["Steckplatz", "Größe", "Typ", "Takt", "Hersteller", "Teilenummer"],
            m.modules.map((x) => [x.bank || "—", fmtBytes(x.size, 0), x.type, x.clock ? `${x.clock} MHz` : "—", x.manufacturer, x.part]), [1, 3])
        : el("p", "empty", "Keine Angaben zu den Riegeln verfügbar."));

      const go = el("button", "link", "Alle Prozesse");
      go.dataset.goto = "processes";
      refs.top = card("Größte Speicherverbraucher", go);
      refs.topBody = el("div");
      refs.top.append(refs.topBody);

      body.append(title, refs.stats, twoCols(usage.card, refs.top), mods);
      this.top();
    },
    fast(f) {
      refs.chart.push(f.ramPercent);
      this.stats();
    },
    slow() { this.top(); },
    top() {
      const list = [...(procs?.processes ?? [])].sort((a, b) => b.mem - a.mem).slice(0, 8);
      if (!list.length) { refs.topBody.replaceChildren(el("p", "empty", "Prozesse werden gelesen…")); return; }
      const max = list[0].mem || 1;
      refs.topBody.replaceChildren(...list.map((p) => {
        const wrap = el("div", "volume");
        const head = el("div", "volume__head");
        head.append(el("span", null, p.isApp && p.description ? p.description : p.name), el("span", null, fmtBytes(p.mem)));
        const bar = el("div", "bar bar--thin");
        const fill = el("div", "bar__fill");
        fill.style.width = `${(p.mem / max) * 100}%`;
        bar.append(fill);
        wrap.append(head, bar);
        return wrap;
      }));
      refs.topBody.className = "volumes";
    },
    stats() {
      const f = fast;
      if (!f) return;
      setStats([
        ["Belegt", `${f.ramPercent} %`, `${fmtBytes(f.ramUsed)} von ${fmtBytes(f.ramTotal)}`, f.ramPercent >= 90 ? "hot" : f.ramPercent >= 80 ? "warm" : ""],
        ["Verfügbar", fmtBytes(f.ramTotal - f.ramUsed), "frei für Programme"],
        ["Gesamt", fmtBytes(f.ramTotal), "installiert"],
        f.swapTotal ? ["Auslagerungsdatei", fmtBytes(f.swapUsed), `von ${fmtBytes(f.swapTotal)}`] : null,
      ]);
    },
  };

  // =====================================================================
  // Laufwerke
  // =====================================================================
  const diskPage = {
    build(body) {
      const disks = hw?.disks ?? [];
      const title = el("div", "detail-title");
      title.append(el("h2", null, disks.length > 1 ? `${disks.length} Laufwerke` : disks[0]?.name ?? "Laufwerke"),
        el("p", null, `${fmtBytes(disks.reduce((s, d) => s + (d.size || 0), 0))} Gesamtkapazität`));
      refs.stats = el("div", "stats");
      refs.volumes = card("Partitionen");
      refs.volBody = el("div", "volumes");
      refs.volumes.append(refs.volBody);
      refs.disks = card("Laufwerke");
      refs.diskBody = el("div");
      refs.disks.append(refs.diskBody);
      refs.sensors = el("div");
      body.append(title, refs.stats, twoCols(refs.volumes, refs.disks), refs.sensors);
      if (slow) this.slow();
    },
    fast() {},
    slow() {
      const vols = slow.volumes ?? [];
      refs.volBody.replaceChildren(...vols.map((v) => {
        const wrap = el("div", "volume");
        const head = el("div", "volume__head");
        head.append(el("span", null, `${v.mount}  ${v.type ?? ""}`), el("span", null, `${fmtBytes(v.size - v.used)} frei von ${fmtBytes(v.size)}`));
        const bar = el("div", "bar bar--thin");
        const fill = el("div", "bar__fill" + (v.use >= 90 ? " warn" : ""));
        fill.style.width = `${v.use}%`;
        bar.append(fill);
        wrap.append(head, bar);
        return wrap;
      }));
      if (!vols.length) refs.volBody.replaceChildren(el("p", "empty", "Keine Partitionen erkannt."));

      // Temperatur je Laufwerk aus LHM, über den Namen zugeordnet
      const storage = lhmSensors(/\/hdd\.png$/i);
      const tempOf = (name) => {
        const n = (name || "").toLowerCase();
        const hit = storage.find((s) => s.type === "Temperature" && (s.hw.toLowerCase().includes(n) || n.includes(s.hw.toLowerCase())));
        return hit?.value ?? null;
      };
      const disks = hw?.disks ?? [];
      refs.diskBody.replaceChildren(disks.length
        ? table(["Name", "Typ", "Größe", "Zustand", "Temperatur"], disks.map((d) => [
            d.name, [d.type, d.iface].filter(Boolean).join(", ") || "—", fmtBytes(d.size),
            d.smart === "Ok" ? "OK" : d.smart ?? "—", tempSpan(tempOf(d.name)),
          ]), [2, 4])
        : el("p", "empty", "Keine Laufwerke erkannt."));

      refs.sensors.replaceChildren(storage.length ? sensorGroupsCard("Laufwerks-Sensoren", storage) : "");
      this.stats();
    },
    stats() {
      const vols = slow?.volumes ?? [];
      const size = vols.reduce((s, v) => s + v.size, 0);
      const used = vols.reduce((s, v) => s + v.used, 0);
      const sys = vols.find((v) => /^c:?$/i.test(v.mount)) ?? vols[0];
      setStats([
        ["Belegt", size ? `${Math.round((used / size) * 100)} %` : "—", `${fmtBytes(used)} von ${fmtBytes(size)}`],
        ["Frei", fmtBytes(size - used), "auf allen Partitionen"],
        sys && ["Systemlaufwerk", `${Math.round(sys.use)} %`, `${fmtBytes(sys.size - sys.used)} frei auf ${sys.mount}`, sys.use >= 90 ? "hot" : ""],
        ["Laufwerke", hw?.disks?.length ?? "—", `${vols.length} Partitionen`],
      ]);
    },
  };

  // =====================================================================
  // Netzwerk
  // =====================================================================
  const netPage = {
    build(body) {
      const def = hw?.network?.find((n) => n.isDefault) ?? hw?.network?.[0];
      const title = el("div", "detail-title");
      title.append(el("h2", null, def?.name ?? "Netzwerk"),
        el("p", null, [def?.ip4, def?.speed && `${def.speed} Mbit/s`, def?.type === "wireless" ? "WLAN" : def?.type === "wired" ? "Kabel" : null].filter(Boolean).join(", ")));
      refs.stats = el("div", "stats");
      const chart = chartCard("Datenverkehr", { series: 2, size: HIST_FAST, max: null, format: (v) => fmtRate(v) }, legend("Download", "Upload"));
      chart.chart.seed(hist.netRx, hist.netTx);
      refs.chart = chart.chart;

      const adapters = card("Netzwerkadapter");
      (hw?.network ?? []).forEach((n) => {
        adapters.append(el("p", "sensor-group__label", `${n.name}${n.isDefault ? " (aktiv)" : ""}`));
        adapters.append(infoList([
          ["Typ", n.type === "wireless" ? "WLAN" : n.type === "wired" ? "Kabel (Ethernet)" : n.type],
          ["IPv4", n.ip4],
          ["MAC", n.mac],
          ["Geschwindigkeit", n.speed ? `${n.speed} Mbit/s` : null],
          ["Status", n.up ? "Verbunden" : "Getrennt"],
        ]));
      });
      if (!hw?.network?.length) adapters.append(el("p", "empty", "Keine Netzwerkadapter erkannt."));
      refs.sensors = el("div");
      body.append(title, refs.stats, chart.card, twoCols(adapters, refs.sensors));
    },
    fast(f) {
      refs.chart.push(f.netRx, f.netTx);
      this.stats();
    },
    slow() {
      const nic = lhmSensors(/\/nic\.png$/i);
      refs.sensors.replaceChildren(nic.length ? sensorGroupsCard("Adapter-Sensoren", nic) : "");
    },
    stats() {
      const f = fast ?? {};
      setStats([
        ["Download", fmtRate(f.netRx), "gerade"],
        ["Upload", fmtRate(f.netTx), "gerade"],
        ["Empfangen", fmtBytes(totals.rx), "seit Nebula läuft"],
        ["Gesendet", fmtBytes(totals.tx), "seit Nebula läuft"],
      ]);
    },
  };

  const PAGES = { cpu: cpuPage, gpu: gpuPage, ram: ramPage, disk: diskPage, net: netPage };

  // =====================================================================
  // Öffentliche Schnittstelle
  // =====================================================================
  function open(kind) {
    const page = PAGES[kind];
    if (!page) return;
    close();
    current = kind;
    refs = {};
    const body = $("detail-body");
    body.replaceChildren();
    page.build(body);
    document.querySelectorAll("#detail-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.detail === kind));
    showView("detail");
    if (fast) page.fast(fast);
    if (slow) page.slow(slow);
    page.stats?.();
  }

  function close() {
    extraCharts.clear();
    current = null;
  }

  function onFast(f) {
    totals.rx += (f.netRx || 0) * (FAST_MS / 1000);
    totals.tx += (f.netTx || 0) * (FAST_MS / 1000);
    if (current) PAGES[current].fast(f);
  }

  function onSlow(s) {
    if (current) PAGES[current].slow(s);
  }

  $("detail-back").addEventListener("click", () => showView("dashboard"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current && $("modal").classList.contains("hidden")) showView("dashboard");
  });

  window.Details = { open, close, onFast, onSlow };
})();
