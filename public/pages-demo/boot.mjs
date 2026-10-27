"use client";

import { rollFormations } from "./formations.js";

const runtimeBase = new URL("../match-runtime-min", import.meta.url).pathname;
window.__MATCH_RUNTIME_BASE__ = runtimeBase;
document.querySelector('script[type="application/vnd.core-settings+json"]').textContent = JSON.stringify({DATA_PREFIX: `${runtimeBase.replace(/^\/+/, '')}/data`, DEBUG:false});

const stylesheets = [
  `${runtimeBase}/fonts/cup-round.css`,
  `${runtimeBase}/styles/match.css`,
];

const baseScripts = [
  `${runtimeBase}/shim-early.js`,
  `${runtimeBase}/vendor/pixi.min.js`,
  `${runtimeBase}/vendor/swig.min.js`,
  `${runtimeBase}/shim.js`,
];

function getGameBundleScript() {
  return `${runtimeBase}/scripts/match.rebuilt.js`;
}

function installStylesheets() {
  for (const href of stylesheets) {
    if (document.querySelector(`link[data-game-style="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.gameStyle = href;
    document.head.appendChild(link);
  }
}

// Prefetch cache: filled by parallel download, consumed by loadScript
const _prefetchedScripts = {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[data-game-script="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.dataset.gameScript = src;

    // If we have prefetched text, use a blob URL (instant, no network)
    const text = _prefetchedScripts[src];
    if (text) {
      const blob = new Blob([text], { type: "application/javascript" });
      script.src = URL.createObjectURL(blob);
    } else {
      script.src = src;
    }

    script.async = false;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", reject, { once: true });
    document.body.appendChild(script);
  });
}

function installForceRefresh() {
  window.onerror = function (message, source, lineno, colno) {
    const match = String(source || "").match(
      /chrome-extension:\/\/[a-z]+\/(.*)/,
    );
    if (match) source = match[1];
    console.error(
      "[uncaught] " +
        message +
        "\n" +
        "File: " +
        source +
        "@" +
        lineno +
        "," +
        colno,
    );
  };

  window.ondrop = window.ondragover = function (event) {
    event.preventDefault();
    return false;
  };

  const leftTop = document.getElementById("forceRefreshCanvas1");
  const rightBottom = document.getElementById("forceRefreshCanvas2");
  if (!leftTop || !rightBottom || window.__gameForceRefreshInstalled) return;
  window.__gameForceRefreshInstalled = true;

  const leftTopContext = leftTop.getContext("2d");
  const rightBottomContext = rightBottom.getContext("2d");

  function forceRefresh() {
    leftTopContext.clearRect(0, 0, leftTop.width, leftTop.height);
    rightBottomContext.clearRect(0, 0, rightBottom.width, rightBottom.height);
    requestAnimationFrame(forceRefresh);
  }

  forceRefresh();
}

// post-mortem boot diagnostics: console never flushes once the main thread
// wedges, so stage marks + a heartbeat go to localStorage where a second
// same-origin tab can read them after the fact.
function markBoot(stage) {
  try {
    localStorage.setItem(
      "bootStages",
      (localStorage.getItem("bootStages") || "") + Date.now() + " " + stage + "\n",
    );
  } catch (e) {}
}

function emitStage(msg) {
  try { window.dispatchEvent(new CustomEvent("ab-load-stage", { detail: msg })); } catch (e) {}
}

async function bootRuntime() {
  if (window.__gameRuntimeBooted) return;
  window.__gameRuntimeBooted = true;

  const t0 = performance.now();
  const log = (msg) => { console.info(`[boot +${((performance.now() - t0) / 1000).toFixed(2)}s] ${msg}`); emitStage(msg); };

  try {
    localStorage.removeItem("bootStages");
    localStorage.removeItem("bootTrace");
  } catch (e) {}
  markBoot("bootRuntime:start");
  log("bootRuntime:start");
  setInterval(() => {
    try { localStorage.setItem("bootHeartbeat", String(Date.now())); } catch (e) {}
  }, 500);

  installStylesheets();
  installForceRefresh();
  log("stylesheets + forceRefresh installed");

  // Strategy: start data-bundle download in background (don't await it),
  // fetch scripts in parallel (much smaller, ~1.4MB total), execute them.
  // The shim needs the bundle when setupCollections() runs — by then the
  // 6.9MB bundle should be done (it downloads concurrently with scripts).
  // If not, the shim falls back to sync XHR (which hits SW cache if ready).
  const allScripts = [...baseScripts, getGameBundleScript(), `${runtimeBase}/standalone-match.js`];

  // Fire-and-forget: data bundle downloads in background
  const bundlePromise = fetch(`${runtimeBase}/__data-bundle.json`)
    .then(r => r.text())
    .then(text => {
      window.__dataBundleCache = text;
      log("data bundle ready (" + (text.length / 1024 | 0) + "KB)");
    })
    .catch(e => log("bundle fetch failed: " + e.message));

  // Also prefetch dirlist (small)
  fetch(`${runtimeBase}/__dirlist.json`)
    .then(r => r.text())
    .then(text => { window.__dirlistCache = text; })
    .catch(() => {});

  // Fetch scripts in parallel (total ~1.4MB, much faster than 6.9MB bundle)
  log("fetching scripts: " + allScripts.length + " files");
  const scriptResults = await Promise.allSettled(
    allScripts.map(url => fetch(url).then(r => r.text()).then(text => ({ url, text })))
  );
  for (const r of scriptResults) {
    if (r.status === "fulfilled") {
      _prefetchedScripts[r.value.url] = r.value.text;
    }
  }
  const fetchedCount = scriptResults.filter(r => r.status === "fulfilled").length;
  log("scripts fetched: " + fetchedCount + "/" + allScripts.length);

  // Now wait for the bundle — scripts are ready, we just need data before executing shim
  log("waiting for data bundle...");
  await bundlePromise;
  log("bundle ready, executing scripts");

  let formations = null;
  try {
    const stored = sessionStorage.getItem("matchFormations");
    if (stored) { formations = JSON.parse(stored); sessionStorage.removeItem("matchFormations"); }
  } catch (e) {}
  if (!formations) formations = rollFormations();
  window.__matchFormations = formations;
  try { window.dispatchEvent(new CustomEvent("ab-formations", { detail: formations })); } catch (e) {}

  // Execute scripts sequentially (order matters) — but network is already done
  log("executing scripts sequentially...");
  for (const src of allScripts) {
    await loadScript(src);
    markBoot("loaded " + src);
  }
  log("all scripts executed");

  // standalone-match.js already loaded above
  const params = new URLSearchParams(window.location.search);
  markBoot("loaded standalone-match.js");

  log("calling __startStandaloneMatch");
  window.__startStandaloneMatch({
    red: params.get("red") || "england",
    blue: params.get("blue") || "france",
    stadium: params.get("stadium") || "international",
    ball: params.get("ball") || "classic_1",
    time: params.get("time") || 2,
    // Watch mode defaults to ai 3 (tight, defensive AI-vs-AI). Play mode is a
    // human controlling one player against a whole AI team, so default to the
    // EASIEST level (0) — even 1 pressed too hard to enjoy. ?ai= still overrides.
    ai: params.get("ai") || (params.get("play") === "1" ? 0 : 3),
    // which kit YOUR team (red slot) wears: home / away (opponent gets contrast)
    side: params.get("side") || "home",
  });
  log("__startStandaloneMatch returned — waiting for ab-match-started event");
  markBoot("startStandaloneMatch returned");
}


const startButton=document.querySelector('#start-match');
document.querySelector('#blue-team').value='france';
window.addEventListener('ab-load-stage',e=>{document.querySelector('#load-status').textContent=e.detail;});
window.addEventListener('ab-match-started',()=>{document.querySelector('#setup').hidden=true;document.querySelector('#static-toolbar').hidden=false;document.querySelector('#load-status').textContent='比赛已启动';});
startButton.addEventListener('click',async()=>{
 startButton.disabled=true;
 const selected=new URLSearchParams(location.search);
 selected.set('red',document.querySelector('#red-team').value);
 selected.set('blue',document.querySelector('#blue-team').value);
 selected.set('time','2');selected.delete('lan');selected.delete('online');
 history.replaceState(null,'','?'+selected.toString());
 try{await bootRuntime();}catch(e){document.querySelector('#load-status').textContent='启动失败：'+e.message;startButton.disabled=false;}
});
document.querySelector('#restart-match').addEventListener('click',()=>location.reload());

setInterval(()=>{const pitch=window.__matchGame?.pitch;if(!pitch)return;const seconds=Math.floor(pitch.time||0);document.querySelector('#match-score').textContent=`${pitch.redTeam?.score||0} : ${pitch.blueTeam?.score||0}`;document.querySelector('#match-clock').textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;},500);
