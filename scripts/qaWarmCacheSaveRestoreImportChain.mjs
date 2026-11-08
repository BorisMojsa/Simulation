#!/usr/bin/env node
/**
 * Warm-cache proof for R2 Item 1 import-chain versioning.
 *
 * 1. Serve ea38a16 on an origin and warm a Playwright browser (module cache populated).
 * 2. Switch the same origin to the candidate worktree without clearing the cache.
 * 3. Reload and assert production paths load the fixed modules (?v=91+).
 * 4. Run CASES=B06 against the candidate root on that origin.
 *
 *   CHROME_PATH=... node scripts/qaWarmCacheSaveRestoreImportChain.mjs
 *
 * Env: CHROME_PATH, BASE_COMMIT (default ea38a16), PORT (optional), SKIP_B06=1
 */
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_COMMIT = process.env.BASE_COMMIT || "ea38a16";
const OUT_DIR = join(root, "qa/r2-01-evidence/warm-cache");
const SKIP_B06 = process.env.SKIP_B06 === "1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const WATCH = [
  "leagueMembership.js",
  "matchEngine.js",
  "teamStrength.js",
  "destinationSchedule.js",
  "seasonSimulator.js",
  "chronologicalSeason.js",
  "main.js",
];

function note(msg, data) {
  console.log(`• ${msg}`, data ? JSON.stringify(data) : "");
}

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
}

async function loadPlaywright() {
  return import("playwright-core");
}

function exportCommitTree(commit, dest) {
  mkdirSync(dest, { recursive: true });
  execFileSync("bash", ["-lc", `git -C ${JSON.stringify(root)} archive --format=tar ${JSON.stringify(commit)} | tar -xf -`], {
    cwd: dest,
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function createSwitchableServer(initialRoot) {
  const state = { docRoot: initialRoot };
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0] || "/");
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
      const filePath = normalize(join(state.docRoot, rel));
      if (!filePath.startsWith(state.docRoot)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      // HTML must revalidate so the candidate entry (main.js?v=…) is used after switch.
      // JS modules are cached aggressively so unversioned base URLs would still hit cache.
      const ext = extname(filePath);
      const cacheControl =
        ext === ".html" ? "no-store" : "public, max-age=31536000, immutable";
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
      });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err?.message || err));
    }
  });
  return {
    state,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        const port = process.env.PORT ? Number(process.env.PORT) : 0;
        server.listen(port, "127.0.0.1", () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function collectModuleUrls(page) {
  return page.evaluate((watch) => {
    const entries = performance.getEntriesByType("resource") || [];
    const allJs = entries
      .map((e) => e.name)
      .filter((u) => /\.m?js(\?|$)/i.test(u));
    const watched = allJs.filter((u) => watch.some((w) => u.includes(w)));
    const byName = {};
    for (const w of watch) {
      byName[w] = allJs.filter((u) => u.includes(`/${w}`) || u.endsWith(w) || u.includes(`${w}?`));
    }
    return {
      watched,
      byName,
      main: allJs.filter((u) => /\/main\.js/.test(u)),
      fix14Sentinel: Boolean(globalThis.__fix14DomStartupLinked),
      restoreReady: typeof globalThis.__restoreCareerSnapshot === "function",
      exportReady: typeof globalThis.__exportCareerSnapshot === "function",
    };
  }, WATCH);
}

function classifyUrls(byName) {
  const out = {};
  for (const [name, urls] of Object.entries(byName)) {
    out[name] = urls.map((u) => {
      const q = u.includes("?") ? u.slice(u.indexOf("?")) : "";
      const versioned = /\?v=\d+/.test(u);
      const version = (u.match(/\?v=(\d+)/) || [])[1] || null;
      return { url: u, query: q, versioned, version };
    });
  }
  return out;
}

function assertCandidateChain(classified, requestedJs = []) {
  const need = {
    "leagueMembership.js": 91,
    "matchEngine.js": 91,
    "teamStrength.js": 91,
    "destinationSchedule.js": 91,
    "seasonSimulator.js": 94,
  };
  const failures = [];
  for (const [name, minV] of Object.entries(need)) {
    const rows = classified[name] || [];
    const reqRows = requestedJs
      .filter((u) => u.includes(name))
      .map((u) => {
        const version = (u.match(/\?v=(\d+)/) || [])[1] || null;
        return { url: u, versioned: Boolean(version), version };
      });
    const pool = reqRows.length ? reqRows : rows;
    const ok = pool.some((r) => r.versioned && Number(r.version) >= minV);
    const bare = pool.some((r) => !r.versioned);
    if (!ok) failures.push({ name, reason: `missing ?v>=${minV}`, rows: pool });
    // Bare unversioned requests after switch would indicate the candidate still links stale URLs.
    if (bare) failures.push({ name, reason: "unversioned URL still requested after candidate switch", rows: pool });
  }
  return failures;
}

async function runB06(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, "scripts/browserEarnedContinentalQualificationChecklist.mjs")],
      {
        cwd: root,
        env: {
          ...process.env,
          BASE_URL: baseUrl,
          CASES: "B06",
          CHROME_PATH: CHROME,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "r2-01-warm-"));
  const baseRoot = join(work, "base");
  note("exporting base commit tree", { BASE_COMMIT, baseRoot });
  exportCommitTree(BASE_COMMIT, baseRoot);

  const switcher = createSwitchableServer(baseRoot);
  const port = await switcher.listen();
  const origin = `http://127.0.0.1:${port}`;
  const baseUrl = `${origin}/`;
  note("server listening", { baseUrl, docRoot: "base" });

  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({
    executablePath: CHROME,
    headless: process.env.HEADED !== "1",
  });
  // Single context retained across switch — cache must survive.
  const context = await browser.newContext();
  const page = await context.newPage();

  const report = {
    baseCommit: BASE_COMMIT,
    candidateRoot: root,
    origin,
    warmedOn: "base",
    switchedTo: "candidate",
    cacheCleared: false,
  };

  try {
    note("warming browser on base", { baseUrl });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    const baseMods = await collectModuleUrls(page);
    report.baseModules = {
      ...baseMods,
      classified: classifyUrls(baseMods.byName),
    };
    await writeFile(join(OUT_DIR, "base-modules.json"), JSON.stringify(report.baseModules, null, 2));
    note("base modules captured", {
      watched: baseMods.watched.length,
      leagueMembership: baseMods.byName["leagueMembership.js"],
      destinationSchedule: baseMods.byName["destinationSchedule.js"],
      matchEngine: baseMods.byName["matchEngine.js"],
      teamStrength: baseMods.byName["teamStrength.js"],
    });

    // Switch same origin to candidate files without clearing browser cache.
    switcher.state.docRoot = root;
    note("switched origin docRoot to candidate (cache retained)");

    // New page in the SAME context: HTTP cache is shared; module map is fresh.
    // Do NOT clearCookies / newContext / launch a new browser.
    const page2 = await context.newPage();
    const candidateRequests = [];
    const candidateFromCache = [];
    const criticalInitiators = [];
    const cdp = await context.newCDPSession(page2);
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (evt) => {
      const u = evt?.request?.url || "";
      if (!/\.m?js(\?|$)/i.test(u)) return;
      candidateRequests.push(u);
      const critical =
        /\/(leagueMembership|matchEngine|teamStrength|destinationSchedule|seasonSimulator|seniorClubs|recruitmentModel|dealPipeline|playerDevelopment|academyLifecycle|contractLifecycle|proContractOffers|narrativeAcademySeason)\.js/.test(
          u
        );
      const bareOrStale = critical && !/\?v=\d+/.test(u);
      if (bareOrStale || /destinationSchedule\.js\?v=81/.test(u)) {
        criticalInitiators.push({
          url: u,
          initiatorType: evt?.initiator?.type || null,
          initiatorUrl: evt?.initiator?.url || null,
          stack: (evt?.initiator?.stack?.callFrames || []).slice(0, 6).map((f) => ({
            url: f.url,
            line: f.lineNumber,
            func: f.functionName,
          })),
        });
      }
    });
    page2.on("response", (res) => {
      const u = res.url();
      if (!/\.m?js(\?|$)/i.test(u)) return;
      candidateFromCache.push({
        url: u,
        status: res.status(),
        fromServiceWorker: res.fromServiceWorker(),
      });
    });

    await page2.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    await page2.evaluate(() => Boolean(window.__fix14DomStartupLinked));
    const candMods = await collectModuleUrls(page2);
    candMods.requestedJs = [...new Set(candidateRequests)];
    candMods.responseMeta = candidateFromCache;
    candMods.criticalInitiators = criticalInitiators;
    await writeFile(join(OUT_DIR, "critical-initiators.json"), JSON.stringify(criticalInitiators, null, 2));
    note("critical initiators", { count: criticalInitiators.length, sample: criticalInitiators.slice(0, 8) });
    // Keep the warm page alive until after candidate load so the shared cache is meaningful.
    await page.close().catch(() => {});
    const classified = classifyUrls(candMods.byName);
    report.candidateModules = { ...candMods, classified };
    await writeFile(
      join(OUT_DIR, "candidate-modules.json"),
      JSON.stringify(report.candidateModules, null, 2)
    );

    const failures = assertCandidateChain(classified, candMods.requestedJs || []);
    report.importChainOk = failures.length === 0;
    report.importChainFailures = failures;
    note("candidate import chain", {
      ok: report.importChainOk,
      failures: failures.length,
      leagueMembership: classified["leagueMembership.js"]?.map((r) => r.url),
      matchEngine: classified["matchEngine.js"]?.map((r) => r.url),
      teamStrength: classified["teamStrength.js"]?.map((r) => r.url),
      destinationSchedule: classified["destinationSchedule.js"]?.map((r) => r.url),
      seasonSimulator: classified["seasonSimulator.js"]?.map((r) => r.url),
      bareCritical: (candMods.requestedJs || []).filter((u) =>
        /\/(leagueMembership|matchEngine|teamStrength|destinationSchedule|seasonSimulator)\.js$/.test(
          u.split("?")[0]
        )
      ),
    });
    assert(report.importChainOk, "candidate must load versioned fixed modules after warm-cache switch", {
      failures,
      bareCritical: report.candidateModules && null,
      requestedSample: (candMods.requestedJs || []).filter((u) =>
        /(leagueMembership|matchEngine|teamStrength|destinationSchedule|seasonSimulator)\.js/.test(u)
      ),
    });

    // Prove membershipBoundaryTimeMs / snapshotSportingProfile are present on loaded modules
    // by fetching the versioned URLs directly from the page context (same origin).
    const probe = await page2.evaluate(async () => {
      const lmUrl = [...performance.getEntriesByType("resource")]
        .map((e) => e.name)
        .find((u) => u.includes("leagueMembership.js?v="));
      const tsUrl = [...performance.getEntriesByType("resource")]
        .map((e) => e.name)
        .find((u) => u.includes("teamStrength.js?v="));
      const lm = lmUrl ? await import(lmUrl) : null;
      const ts = tsUrl ? await import(tsUrl) : null;
      return {
        lmUrl,
        tsUrl,
        hasMembershipBoundaryTimeMs: typeof lm?.membershipBoundaryTimeMs === "function",
        boundarySample: lm?.membershipBoundaryTimeMs?.(2026) ?? null,
        hasSnapshotSportingProfile: typeof ts?.snapshotSportingProfile === "function",
        cloneOk: (() => {
          if (!ts?.snapshotSportingProfile) return false;
          const src = { overall: 70, replacementOvr: { ST: 60 } };
          const snap = ts.snapshotSportingProfile(src);
          snap.replacementOvr.ST = 99;
          return src.replacementOvr.ST === 60 && snap.replacementOvr.ST === 99;
        })(),
      };
    });
    report.fixProbe = probe;
    assert(probe.hasMembershipBoundaryTimeMs, "loaded leagueMembership exposes membershipBoundaryTimeMs", probe);
    assert(probe.boundarySample === Date.UTC(2026, 5, 1), "boundary ms is June 1 UTC", probe);
    assert(probe.cloneOk, "loaded teamStrength deep-clones replacementOvr", probe);
    note("fix probe on warm-switched modules", probe);

    let b06 = null;
    if (!SKIP_B06) {
      note("running B06 on candidate origin", { baseUrl });
      // Close warm browser before B06 (B06 launches its own browser); server stays on candidate.
      await browser.close();
      b06 = await runB06(baseUrl);
      // CASES=B06 is a subset run: checklist sets process.exitCode=1 when subsetOnly,
      // but selectedOk/cases.B06 remain the authoritative single-case result.
      const selectedOk = /"selectedOk":\s*true/.test(b06.stdout);
      const caseOk = /"B06":\s*true/.test(b06.stdout) && /\[browser\] pass B06/.test(b06.stdout);
      report.b06 = {
        exitCode: b06.code,
        selectedOk,
        caseOk,
        ok: selectedOk && caseOk,
        stdoutTail: b06.stdout.slice(-4000),
      };
      assert(report.b06.ok, "B06 must pass on candidate after warm-cache switch", {
        code: b06.code,
        selectedOk,
        caseOk,
        stderrTail: b06.stderr.slice(-2000),
      });
    } else {
      await browser.close();
      report.b06 = { skipped: true };
    }

    report.ok = true;
    await writeFile(join(OUT_DIR, "warm-cache-report.json"), JSON.stringify(report, null, 2));
    note("warm-cache proof PASS", { out: join(OUT_DIR, "warm-cache-report.json") });
  } catch (err) {
    report.ok = false;
    report.error = { message: String(err?.message || err), data: err?.data || null };
    await writeFile(join(OUT_DIR, "warm-cache-report.json"), JSON.stringify(report, null, 2)).catch(() => {});
    throw err;
  } finally {
    await switcher.close().catch(() => {});
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("FAIL", err?.message || err, err?.data || "");
  process.exit(1);
});
