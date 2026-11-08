#!/usr/bin/env node
/**
 * Warm-cache proof for R2 Item 2 loan-return import-chain versioning.
 *
 * Warm a browser on base 1867753, switch the same origin to the candidate
 * worktree without clearing cache, then assert revised modules load with
 * bumped ?v= query strings and that the loan-return fixture path works.
 *
 *   CHROME_PATH=... node scripts/qaWarmCacheLoanReturnImportChain.mjs
 */
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_COMMIT = process.env.BASE_COMMIT || "186775393ce1b433543758816ee2bda4f68c0f32";
const OUT_DIR = join(root, "qa/r2-02-evidence/warm-cache");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const WATCH = [
  "main.js",
  "loanMarket.js",
  "contractLifecycle.js",
  "seasonSimulator.js",
  "chronologicalSeason.js",
  "membershipBrowserFixture.js",
];

const NEED = {
  "loanMarket.js": 104,
  "contractLifecycle.js": 103,
  "seasonSimulator.js": 106,
  "chronologicalSeason.js": 105,
  "membershipBrowserFixture.js": 106,
  "main.js": 112,
};

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

function exportCommitTree(commit, dest) {
  mkdirSync(dest, { recursive: true });
  execFileSync(
    "bash",
    ["-lc", `git -C ${JSON.stringify(root)} archive --format=tar ${JSON.stringify(commit)} | tar -xf -`],
    { cwd: dest, stdio: ["ignore", "inherit", "inherit"] }
  );
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
        server.listen(process.env.PORT ? Number(process.env.PORT) : 0, "127.0.0.1", () =>
          resolve(server.address().port)
        );
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "r2-02-warm-"));
  const baseRoot = join(work, "base");
  note("exporting base commit tree", { BASE_COMMIT, baseRoot });
  exportCommitTree(BASE_COMMIT, baseRoot);

  const switcher = createSwitchableServer(baseRoot);
  const port = await switcher.listen();
  const baseUrl = `http://127.0.0.1:${port}/`;
  note("server listening", { baseUrl });

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const report = {
    baseCommit: BASE_COMMIT,
    candidateRoot: root,
    origin: baseUrl,
    cacheCleared: false,
  };

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    const baseMods = await page.evaluate((watch) => {
      const allJs = (performance.getEntriesByType("resource") || [])
        .map((e) => e.name)
        .filter((u) => /\.m?js(\?|$)/i.test(u));
      const byName = {};
      for (const w of watch) byName[w] = allJs.filter((u) => u.includes(w));
      return { byName, main: allJs.filter((u) => /\/main\.js/.test(u)) };
    }, WATCH);
    report.baseModules = baseMods;
    await writeFile(join(OUT_DIR, "base-modules.json"), JSON.stringify(baseMods, null, 2));

    switcher.state.docRoot = root;
    note("switched origin to candidate (cache retained)");

    const page2 = await context.newPage();
    const requested = [];
    page2.on("request", (req) => {
      const u = req.url();
      if (/\.m?js(\?|$)/i.test(u)) requested.push(u);
    });
    await page2.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    await page.close().catch(() => {});

    const classified = {};
    for (const name of WATCH) {
      const urls = requested.filter((u) => u.includes(name));
      classified[name] = urls.map((u) => {
        const version = (u.match(/\?v=(\d+)/) || [])[1] || null;
        return { url: u, versioned: Boolean(version), version };
      });
    }
    report.candidateModules = { requested, classified };
    await writeFile(join(OUT_DIR, "candidate-modules.json"), JSON.stringify(report.candidateModules, null, 2));

    const failures = [];
    for (const [name, minV] of Object.entries(NEED)) {
      const rows = classified[name] || [];
      const ok = rows.some((r) => r.versioned && Number(r.version) >= minV);
      const bare = rows.some((r) => !r.versioned);
      if (!ok) failures.push({ name, reason: `missing ?v>=${minV}`, rows });
      if (bare) failures.push({ name, reason: "unversioned URL still requested", rows });
    }
    report.importChainOk = failures.length === 0;
    report.importChainFailures = failures;
    assert(report.importChainOk, "candidate must load versioned Item 2 modules after warm switch", {
      failures,
    });

    const fixture = await page2.evaluate(async () => {
      const loaded = window.__loadMembershipBrowserFixture?.({ mode: "ui-loan-return-ready", seed: 42 });
      const debug = window.__getLiveCareerDebug?.() || {};
      return {
        ok: Boolean(loaded?.ok),
        parentSnap: debug.parentClubSnapshotLeagueId || null,
        loanStatus: debug.activeLoan?.status || null,
        parentWorld: loaded?.loan?.parentWorldLeagueId || null,
      };
    });
    report.fixtureProbe = fixture;
    assert(fixture.ok, "loan-return fixture loads on warm-switched candidate", fixture);
    assert(fixture.parentSnap === "league:england-premier-league", "debug exposes stale PL snapshot", fixture);
    assert(fixture.parentWorld === "league:england-championship", "live parent CH", fixture);

    const endLoanProbe = await page2.evaluate(async () => {
      const urls = [...performance.getEntriesByType("resource")].map((e) => e.name);
      const lmUrl = urls.find((u) => u.includes("loanMarket.js?v="));
      if (!lmUrl) return { ok: false, reason: "loanMarket-url-missing" };
      const mod = await import(lmUrl);
      return {
        ok: typeof mod.endLoan === "function" && typeof mod.resolveLoanReturnEffectiveDate === "function",
        lmUrl,
        hasResolveLoanReturnEffectiveDate: typeof mod.resolveLoanReturnEffectiveDate === "function",
      };
    });
    report.endLoanProbe = endLoanProbe;
    assert(endLoanProbe.ok, "warm-loaded loanMarket exposes return helpers", endLoanProbe);

    report.ok = true;
    await writeFile(join(OUT_DIR, "warm-cache-report.json"), JSON.stringify(report, null, 2));
    note("warm-cache proof PASS", { out: join(OUT_DIR, "warm-cache-report.json") });
  } catch (err) {
    report.ok = false;
    report.error = { message: String(err?.message || err), data: err?.data || null };
    await writeFile(join(OUT_DIR, "warm-cache-report.json"), JSON.stringify(report, null, 2)).catch(() => {});
    throw err;
  } finally {
    await browser.close().catch(() => {});
    await switcher.close().catch(() => {});
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("FAIL", err?.message || err, err?.data || "");
  process.exit(1);
});
