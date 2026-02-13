import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const readmePath = process.env.README_PATH || "README.md";
const historyPath = process.env.HISTORY_PATH || ".github/traffic/history.json";
const markerStart = "<!-- TRAFFIC_START -->";
const markerEnd = "<!-- TRAFFIC_END -->";

if (!token) throw new Error("Missing GITHUB_TOKEN");
if (!repository || !repository.includes("/")) {
  throw new Error("Missing or invalid GITHUB_REPOSITORY");
}

const [owner, repo] = repository.split("/");

async function getTraffic(endpoint) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/traffic/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${endpoint} failed (${res.status}): ${body}`);
  }

  return res.json();
}

function loadHistory() {
  if (!existsSync(historyPath)) {
    return { generatedAt: null, days: {} };
  }
  return JSON.parse(readFileSync(historyPath, "utf8"));
}

function saveHistory(history) {
  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (row[field] || 0), 0);
}

function updateReadme(rows, generatedAtIso) {
  const last14 = rows.slice(0, 14);
  const totalViews = sum(last14, "views");
  const totalUniqueViews = sum(last14, "uniqueViews");
  const totalClones = sum(last14, "clones");
  const totalUniqueClones = sum(last14, "uniqueClones");

  const tableHeader = [
    "| Date | Views | Unique Views | Clones | Unique Clones |",
    "|---|---:|---:|---:|---:|",
  ];
  const tableRows = last14.map((row) => `| ${row.date} | ${row.views} | ${row.uniqueViews} | ${row.clones} | ${row.uniqueClones} |`);

  const block = [
    markerStart,
    "## Traffic Dashboard",
    "",
    "GitHub traffic snapshot (rolling window reported by GitHub API).",
    "",
    `Last 14 days totals: **${totalViews} views** (${totalUniqueViews} unique) and **${totalClones} clones** (${totalUniqueClones} unique).`,
    "",
    ...tableHeader,
    ...tableRows,
    "",
    `_Updated automatically: ${generatedAtIso}_`,
    markerEnd,
  ].join("\n");

  const readme = readFileSync(readmePath, "utf8");
  let updated;

  const startIndex = readme.indexOf(markerStart);
  const endIndex = readme.indexOf(markerEnd);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    updated = `${readme.slice(0, startIndex)}${block}${readme.slice(endIndex + markerEnd.length)}`;
  } else {
    updated = `${readme.trimEnd()}\n\n${block}\n`;
  }

  writeFileSync(readmePath, updated, "utf8");
}

const views = await getTraffic("views");
const clones = await getTraffic("clones");
const generatedAt = new Date().toISOString();

const history = loadHistory();
history.generatedAt = generatedAt;

for (const entry of views.views || []) {
  const date = String(entry.timestamp).slice(0, 10);
  history.days[date] = history.days[date] || { views: 0, uniqueViews: 0, clones: 0, uniqueClones: 0 };
  history.days[date].views = entry.count;
  history.days[date].uniqueViews = entry.uniques;
}

for (const entry of clones.clones || []) {
  const date = String(entry.timestamp).slice(0, 10);
  history.days[date] = history.days[date] || { views: 0, uniqueViews: 0, clones: 0, uniqueClones: 0 };
  history.days[date].clones = entry.count;
  history.days[date].uniqueClones = entry.uniques;
}

saveHistory(history);

const rows = Object.entries(history.days)
  .map(([date, metrics]) => ({
    date,
    views: metrics.views || 0,
    uniqueViews: metrics.uniqueViews || 0,
    clones: metrics.clones || 0,
    uniqueClones: metrics.uniqueClones || 0,
  }))
  .sort((a, b) => b.date.localeCompare(a.date));

updateReadme(rows, generatedAt);
