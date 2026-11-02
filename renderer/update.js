// =====================================================================
// Nebula 1.7 – Update-Knopf, ATLAS-Start und „Was ist neu“
// (eigener Gültigkeitsbereich, nutzt $ und toast aus renderer.js)
// =====================================================================
(() => {
  const nb = window.nebula;
  const pill = $("update-pill");
  const pillText = $("update-pill-text");
  const status = $("update-status");
  const notes = $("update-notes");
  const progress = $("update-progress");
  const progressFill = $("update-progress-fill");
  const btnCheck = $("btn-update-check");
  const btnMain = $("btn-update-main");
  let state = null;

  const when = (ms) => (ms ? new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "");

  function render(s) {
    state = s;
    const busy = s.phase === "checking" || s.phase === "downloading";

    // Knopf in der Titelleiste: nur sichtbar, wenn es wirklich etwas zu tun gibt
    const showPill = s.phase === "available" || s.phase === "downloading" || s.phase === "ready";
    pill.classList.toggle("hidden", !showPill);
    pill.classList.toggle("is-busy", s.phase === "downloading");
    if (s.phase === "available") {
      pillText.textContent = s.portable ? `Version ${s.version} herunterladen` : `Update auf ${s.version}`;
      pill.title = "Klicken, um das Update zu laden";
    } else if (s.phase === "downloading") {
      pillText.textContent = `Update lädt … ${s.percent} %`;
      pill.title = "Das Update wird heruntergeladen";
    } else if (s.phase === "ready") {
      pillText.textContent = "Neu starten & aktualisieren";
      pill.title = `Version ${s.version} installieren`;
    }

    // Bereich in den Einstellungen
    const texts = {
      idle: `Installiert: Version ${s.current}`,
      checking: "Suche nach Updates …",
      available: `Version ${s.version} ist verfügbar (installiert: ${s.current}).`,
      downloading: `Version ${s.version} wird heruntergeladen … ${s.percent} %`,
      ready: `Version ${s.version} ist bereit. Nebula startet zum Installieren kurz neu.`,
      uptodate: `Nebula ist aktuell (Version ${s.current}).${s.checkedAt ? ` Zuletzt geprüft um ${when(s.checkedAt)}.` : ""}`,
      error: `Update-Prüfung fehlgeschlagen: ${s.error}`,
      unsupported: s.error || "Updates sind in dieser Version nicht verfügbar.",
    };
    status.textContent = texts[s.phase] ?? "";
    notes.textContent = s.notes ? `Neu in ${s.version}: ${s.notes}` : "";
    notes.classList.toggle("hidden", !(s.notes && (s.phase === "available" || s.phase === "ready")));
    progress.classList.toggle("hidden", s.phase !== "downloading");
    progressFill.style.width = `${s.percent}%`;

    btnCheck.disabled = busy || s.phase === "unsupported" || s.phase === "ready";
    btnCheck.textContent = s.phase === "checking" ? "Suche …" : "Nach Updates suchen";
    const mainLabel = s.phase === "available" ? (s.portable ? "Download-Seite öffnen" : "Update laden")
      : s.phase === "ready" ? "Jetzt installieren" : null;
    btnMain.classList.toggle("hidden", !mainLabel);
    if (mainLabel) btnMain.textContent = mainLabel;
  }

  async function primaryAction() {
    if (!state) return;
    if (state.phase === "available") {
      await nb.update.download();
      if (state.portable) toast("Die Download-Seite wurde im Browser geöffnet.");
    } else if (state.phase === "ready") {
      toast("Nebula wird aktualisiert und startet neu …");
      await nb.update.install();
    }
  }

  pill.addEventListener("click", primaryAction);
  btnMain.addEventListener("click", primaryAction);
  btnCheck.addEventListener("click", async () => {
    const s = await nb.update.check();
    if (s?.phase === "uptodate") toast("Nebula ist auf dem neuesten Stand.");
  });
  nb.update.onState(render);
  nb.update.get().then(render);

  // Wer „Animationen reduzieren“ eingestellt hat: der Mond steht still
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".atlas-logo animateMotion, .atlas-logo animate").forEach((n) => n.remove());
    document.querySelectorAll(".atlas-logo .logo-moon").forEach((m) => { m.setAttribute("cx", "54"); m.setAttribute("cy", "40"); });
  }

  // ---------- ATLAS ----------
  async function openAtlas() {
    const r = await nb.atlas.open();
    if (!r?.ok) toast(r?.error ?? "ATLAS konnte nicht geöffnet werden.");
  }
  $("btn-atlas").addEventListener("click", openAtlas);

  // ---------- „Was ist neu“ – einmalig nach dem Update auf 1.7 ----------
  const WHATS_NEW = "1.7";
  const dialog = $("whatsnew");
  const close = async () => {
    dialog.classList.add("hidden");
    const store = await nb.store.get();
    await nb.store.saveSettings({ ...store.settings, whatsNewSeen: WHATS_NEW });
  };
  $("whatsnew-later").addEventListener("click", close);
  $("whatsnew-open").addEventListener("click", async () => { await close(); openAtlas(); });
  dialog.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  nb.store.get().then((store) => {
    if (store?.settings?.whatsNewSeen !== WHATS_NEW) {
      setTimeout(() => {
        dialog.classList.remove("hidden");
        // SVG-Animationen starten nicht, solange sie in einem unsichtbaren Bereich stehen – deshalb neu einsetzen
        dialog.querySelectorAll(".atlas-logo").forEach((svg) => svg.replaceWith(svg.cloneNode(true)));
        $("whatsnew-open").focus();
      }, 1200);
    }
  });
})();
