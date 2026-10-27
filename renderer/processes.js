// =====================================================================
// Nebula – Prozesse (wie im Task-Manager)
// Apps und Hintergrundprozesse getrennt, Suche, Sortierung,
// aufklappbare Einzelprozesse und „Task beenden“ mit Sicherheitsabfrage.
// Nutzt Helfer und Zustand aus renderer.js ($, el, api, procs, fmtBytes …)
// =====================================================================
(() => {
  const state = {
    sort: "cpu",        // name | count | cpu | mem
    asc: false,
    query: "",
    selected: null,     // { key, pid } – pid nur bei einzelner Instanz
    expanded: new Set(),
  };

  const CHEVRON = '<svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg>';

  // ---------- Hilfen ----------
  function avatarColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const ramp = ["--t1", "--t2", "--t3", "--cool"];
    return `var(${ramp[h % ramp.length]})`;
  }

  function displayName(g) {
    // Für Apps die Beschreibung bevorzugen (z. B. „Google Chrome“ statt „chrome“)
    return g.isApp && g.description ? g.description : g.name;
  }

  function sortList(list) {
    const dir = state.asc ? 1 : -1;
    const by = {
      name: (a, b) => displayName(a).localeCompare(displayName(b), "de") * dir,
      count: (a, b) => (a.count - b.count) * dir,
      cpu: (a, b) => (a.cpu - b.cpu) * dir || b.mem - a.mem,
      mem: (a, b) => (a.mem - b.mem) * dir,
    }[state.sort];
    return [...list].sort(by);
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    const list = procs?.processes ?? [];
    if (!q) return list;
    return list.filter((g) =>
      [g.name, g.description, g.title, ...g.instances.map((i) => String(i.pid))].some((t) => t && t.toLowerCase().includes(q))
    );
  }

  function findGroup(key) {
    return procs?.processes.find((g) => g.key === key);
  }

  // Wärme-Färbung: CPU relativ zu 25 %, RAM relativ zu 10 % des Arbeitsspeichers
  const heatCpu = (cpu) => Math.min(1, cpu / 25);
  const heatMem = (mem) => Math.min(1, mem / ((fast?.ramTotal || 16 * 1024 ** 3) * 0.1));

  function cell(cls, text, heat) {
    const c = el("span", cls, text);
    if (heat != null) c.style.setProperty("--heat", heat.toFixed(3));
    return c;
  }

  // ---------- Zeilen ----------
  function groupRow(g) {
    const row = el("div", "prow prow--item");
    row.dataset.key = g.key;
    const sel = state.selected;
    if (sel && sel.key === g.key && sel.pid == null) row.classList.add("selected");

    const name = el("span", "pname");
    const expand = el("button", `pexpand${g.count > 1 ? "" : " pexpand--none"}${state.expanded.has(g.key) ? " open" : ""}`);
    expand.innerHTML = CHEVRON;
    expand.title = state.expanded.has(g.key) ? "Zuklappen" : "Einzelne Prozesse anzeigen";
    expand.dataset.action = "expand";
    const av = el("span", "avatar", displayName(g).charAt(0).toUpperCase());
    av.style.background = avatarColor(g.name);
    const text = el("span", "ptext");
    const title = el("strong", null, displayName(g));
    if (g.protected) title.append(el("span", "lock", "geschützt"));
    const subtitle = g.isApp ? g.title || g.name : g.count > 1 ? `${g.count} Prozesse` : g.description || `PID ${g.instances[0]?.pid ?? "?"}`;
    text.append(title, el("small", null, subtitle));
    text.title = [displayName(g), g.title, `${g.name}.exe`].filter(Boolean).join("\n");
    name.append(expand, av, text);

    const act = el("span", "pact");
    if (!g.protected) {
      const kill = el("button", "pkill", "Beenden");
      kill.dataset.action = "kill";
      act.append(kill);
    }

    row.append(
      name,
      cell("num", g.count),
      cell("num heat", `${g.cpu.toFixed(1)} %`, heatCpu(g.cpu)),
      cell("num heat", fmtBytes(g.mem), heatMem(g.mem)),
      act
    );
    return row;
  }

  function instanceRow(g, inst) {
    const row = el("div", "prow prow--item prow--sub");
    row.dataset.key = g.key;
    row.dataset.pid = inst.pid;
    const sel = state.selected;
    if (sel && sel.key === g.key && sel.pid === inst.pid) row.classList.add("selected");

    const text = el("span", "ptext");
    text.append(el("strong", null, inst.title || `${g.name}.exe`), el("small", null, `PID ${inst.pid}`));
    const act = el("span", "pact");
    if (!g.protected) {
      const kill = el("button", "pkill", "Beenden");
      kill.dataset.action = "kill";
      act.append(kill);
    }
    row.append(text, cell("num", ""), cell("num heat", `${inst.cpu.toFixed(1)} %`, heatCpu(inst.cpu)), cell("num heat", fmtBytes(inst.mem), heatMem(inst.mem)), act);
    return row;
  }

  function section(title, count) {
    const s = el("div", "psection");
    s.append(el("span", null, title), el("span", "count", `(${count})`));
    return s;
  }

  // ---------- Rendern ----------
  function renderStats() {
    const list = procs?.processes ?? [];
    const apps = list.filter((g) => g.isApp).length;
    const cpuSum = list.reduce((s, g) => s + g.cpu, 0);
    const memSum = list.reduce((s, g) => s + g.mem, 0);
    const items = [
      ["Laufende Prozesse", procs?.processCount ?? "—", `${list.length} Programme`],
      ["Apps mit Fenster", apps, `${list.length - apps} im Hintergrund`],
      ["CPU gesamt", `${Math.min(100, cpuSum).toFixed(0)} %`, fast?.cpuSpeed ? `${fast.cpuSpeed.toFixed(2)} GHz` : ""],
      ["Arbeitsspeicher", fmtBytes(memSum), fast ? `von ${fmtBytes(fast.ramTotal)}` : ""],
    ];
    const box = $("proc-stats");
    box.replaceChildren(
      ...items.map(([label, value, sub]) => {
        const it = el("div", "card glass stat-item");
        it.append(el("div", "stat-item__label", label), el("div", "stat-item__value", String(value)), el("div", "stat-item__sub", sub));
        return it;
      })
    );
  }

  function renderMini() {
    const mini = $("proc-mini");
    mini.replaceChildren();
    const top = [...(procs?.processes ?? [])].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 6);
    $("proc-mini-count").textContent = procs?.processCount ? `${procs.processCount} laufend` : "—";
    if (!top.length) { mini.append(el("span", "muted", "Prozesse werden gelesen…")); return; }
    top.forEach((p) => {
      const row = el("span", "proc-mini__row");
      row.append(el("span", null, displayName(p)), el("span", null, `${p.cpu.toFixed(1)} %`), el("span", null, fmtBytes(p.mem)));
      mini.append(row);
    });
  }

  function renderHead() {
    document.querySelectorAll("#proc-head button").forEach((b) => {
      b.classList.toggle("sorted", b.dataset.sort === state.sort);
      b.classList.toggle("asc", b.dataset.sort === state.sort && state.asc);
    });
  }

  function render() {
    renderMini();
    renderStats();
    renderHead();

    const box = $("proc-list");
    const list = sortList(filtered());
    box.replaceChildren();

    if (!procs) {
      box.append(el("p", "empty", "Prozesse werden gelesen…"));
    } else if (!procs.processes.length) {
      box.append(el("p", "empty", "Keine Prozessdaten erhalten. Unter Sensoren → Datenquellen siehst du, woran es liegt."));
    } else if (!list.length) {
      box.append(el("p", "empty", `Kein Prozess passt zu „${state.query}“.`));
    } else {
      const apps = list.filter((g) => g.isApp);
      const background = list.filter((g) => !g.isApp);
      const addGroup = (g) => {
        box.append(groupRow(g));
        if (state.expanded.has(g.key)) g.instances.forEach((inst) => box.append(instanceRow(g, inst)));
      };
      if (apps.length) { box.append(section("Apps", apps.length)); apps.forEach(addGroup); }
      if (background.length) { box.append(section("Hintergrundprozesse", background.length)); background.forEach(addGroup); }
    }

    // Auswahl verwerfen, wenn der Prozess nicht mehr existiert
    const sel = state.selected;
    const g = sel && findGroup(sel.key);
    if (sel && (!g || (sel.pid != null && !g.instances.some((i) => i.pid === sel.pid)))) state.selected = null;
    // Nur aktiv, wenn die Auswahl sichtbar ist (nicht durch die Suche ausgeblendet) und nicht geschützt
    const visible = new Set(list.map((x) => x.key));
    $("proc-kill").disabled =
      !state.selected || !visible.has(state.selected.key) || Boolean(findGroup(state.selected.key)?.protected);

    $("proc-sub").textContent = procs?.processCount
      ? `${procs.processCount} Prozesse, gleiche Programme zusammengefasst`
      : "Prozesse werden gelesen…";
  }

  // ---------- Beenden ----------
  async function endTask(key, pid = null) {
    const g = findGroup(key);
    if (!g) return;
    const name = displayName(g);
    if (g.protected) {
      toast(`„${name}“ ist ein wichtiger Systemprozess und kann nicht beendet werden.`);
      return;
    }
    const pids = pid != null ? [pid] : g.instances.map((i) => i.pid).filter(Boolean);
    const many = pids.length > 1;
    let text = many
      ? `${pids.length} Prozesse von „${name}“ werden sofort geschlossen. Nicht gespeicherte Daten gehen verloren.`
      : "Das Programm wird sofort geschlossen. Nicht gespeicherte Daten gehen verloren.";
    if (g.risky) text += " Achtung: Das ist ein Teil von Windows. Taskleiste oder Startmenü können kurz verschwinden.";

    const ok = await confirmDialog({
      title: pid != null ? `Prozess ${pid} beenden?` : `„${name}“ beenden?`,
      text,
      ok: "Beenden",
      danger: true,
    });
    if (!ok) return;

    let result = await api.hw.kill(pids);
    if (!result.ok && result.needsAdmin) {
      const again = await confirmDialog({
        title: "Admin-Rechte nötig",
        text: `„${name}“ läuft mit Admin-Rechten. Soll Nebula ihn mit Admin-Rechten beenden? Windows fragt dafür einmal nach.`,
        ok: "Mit Admin-Rechten beenden",
        danger: true,
      });
      if (!again) return;
      result = await api.hw.kill(pids, true);
    }

    if (result.ok) {
      toast(`„${name}“ beendet`);
      state.selected = null;
      state.expanded.delete(key);
      updateProcs();
    } else {
      toast(result.error || "Beenden fehlgeschlagen");
    }
  }

  // ---------- Bedienung ----------
  $("proc-list").addEventListener("click", (e) => {
    const row = e.target.closest(".prow--item");
    if (!row) return;
    const key = row.dataset.key;
    const pid = row.dataset.pid ? Number(row.dataset.pid) : null;
    const action = e.target.closest("[data-action]")?.dataset.action;

    if (action === "expand") {
      state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
    } else if (action === "kill") {
      state.selected = { key, pid };
      render();
      endTask(key, pid);
      return;
    } else {
      state.selected = { key, pid };
    }
    render();
  });

  $("proc-list").addEventListener("dblclick", (e) => {
    const row = e.target.closest(".prow--item:not(.prow--sub)");
    if (!row || e.target.closest("[data-action]")) return;
    const key = row.dataset.key;
    if (findGroup(key)?.count > 1) {
      state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
      render();
    }
  });

  $("proc-head").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sort]");
    if (!b) return;
    if (state.sort === b.dataset.sort) state.asc = !state.asc;
    else { state.sort = b.dataset.sort; state.asc = b.dataset.sort === "name"; }
    render();
  });

  let searchTimer;
  $("proc-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; render(); }, 120);
  });

  $("proc-kill").addEventListener("click", () => {
    if (state.selected && !$("proc-kill").disabled) endTask(state.selected.key, state.selected.pid);
  });

  document.addEventListener("keydown", (e) => {
    if (currentView !== "processes" || !$("modal").classList.contains("hidden")) return;
    if (e.key === "Delete" && state.selected && !$("proc-kill").disabled && document.activeElement !== $("proc-search")) {
      e.preventDefault();
      endTask(state.selected.key, state.selected.pid);
    }
    if (e.key === "Escape" && state.query) {
      $("proc-search").value = "";
      state.query = "";
      render();
    }
  });

  window.Processes = { render };
})();
