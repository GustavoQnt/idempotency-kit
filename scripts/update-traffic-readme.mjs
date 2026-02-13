import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const token = process.env.TRAFFIC_TOKEN || process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const readmePath = process.env.README_PATH || "README.md";
const historyPath = process.env.HISTORY_PATH || ".github/traffic/history.json";
const trackingStartDate = process.env.TRACKING_START_DATE || "";
const markerStart = "<!-- TRAFFIC_START -->";
const markerEnd = "<!-- TRAFFIC_END -->";

if (!token) throw new Error("Missing TRAFFIC_TOKEN or GITHUB_TOKEN");
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

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid TRACKING_START_DATE: ${value}. Use YYYY-MM-DD.`);
  }
  return parsed.toISOString().slice(0, 10);
}

function updateReadme(rows, generatedAtIso) {
  const startDate = normalizeDate(trackingStartDate);
  const allRows = startDate ? rows.filter((row) => row.date >= startDate) : rows;
  const totalViews = sum(allRows, "views");
  const totalClones = sum(allRows, "clones");

  const tableHeader = [
    "| Date | Views | Clones |",
    "|---|---:|---:|",
  ];
  const tableRows = allRows.length
    ? allRows.map((row) => `| ${row.date} | ${row.views} | ${row.clones} |`)
    : ["| pending first workflow run | 0 | 0 |"];

  const block = [
    markerStart,
    "## Traffic Dashboard",
    "",
    "GitHub traffic snapshot (rolling window reported by GitHub API).",
    "",
    startDate
      ? `Totals since ${startDate}: **${totalViews} views** and **${totalClones} clones**.`
      : `Totals since tracking started: **${totalViews} views** and **${totalClones} clones**.`,
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
    clones: metrics.clones || 0,
  }))
  .sort((a, b) => b.date.localeCompare(a.date));

updateReadme(rows, generatedAt);
