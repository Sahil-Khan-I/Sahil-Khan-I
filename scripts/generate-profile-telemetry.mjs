import { mkdir, writeFile } from "node:fs/promises";

const OWNER = "Sahil-Khan-I";
const API = "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Sahil-Khan-I-profile-telemetry",
};

async function githubJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

async function getOwnedPublicRepos() {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubJson(
      `${API}/users/${OWNER}/repos?type=owner&per_page=100&sort=updated&page=${page}`
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }

  return all.filter((repo) => (
    repo.private === false &&
    repo.fork === false &&
    repo.archived === false
  ));
}

async function getLanguageTotals(repos) {
  const totals = new Map();
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (cursor < repos.length) {
      const index = cursor;
      cursor += 1;
      const repo = repos[index];
      const data = await githubJson(`${API}/repos/${OWNER}/${repo.name}/languages`);
      for (const [language, bytes] of Object.entries(data)) {
        totals.set(language, (totals.get(language) ?? 0) + bytes);
      }
    }
  });
  await Promise.all(workers);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function createSvg({ theme, repos, stars, forks, languages, updatedAt }) {
  const dark = theme === "dark";
  const colors = dark
    ? { bg: "#0d1117", panel: "#111821", text: "#e6edf3", muted: "#8b949e", line: "#30363d", accent: "#938bff", track: "#242c36" }
    : { bg: "#ffffff", panel: "#f8fafc", text: "#111827", muted: "#64748b", line: "#e2e8f0", accent: "#5b5ce2", track: "#e8edf3" };

  const width = 1080;
  const height = 338;
  const cardY = 54;
  const cardW = 326;
  const cardH = 92;
  const gap = 18;
  const metricCards = [
    { label: "PUBLIC PROJECTS", value: repos, x: 30 },
    { label: "STARS EARNED", value: stars, x: 30 + cardW + gap },
    { label: "FORKS RECEIVED", value: forks, x: 30 + (cardW + gap) * 2 },
  ].map((metric) => `
    <rect x="${metric.x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="9" fill="${colors.panel}" stroke="${colors.line}"/>
    <text x="${metric.x + 20}" y="${cardY + 29}" fill="${colors.muted}" font-size="11" font-weight="700" letter-spacing="1.5">${metric.label}</text>
    <text x="${metric.x + 20}" y="${cardY + 69}" fill="${colors.text}" font-size="31" font-weight="700">${metric.value.toLocaleString("en-US")}</text>
  `).join("");

  const totalBytes = languages.reduce((sum, [, bytes]) => sum + bytes, 0);
  const topLanguages = languages.slice(0, 8);
  const languageRows = topLanguages.map(([name, bytes], index) => {
    const col = index < 4 ? 0 : 1;
    const row = index % 4;
    const x = col === 0 ? 35 : 560;
    const y = 202 + row * 31;
    const percentage = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;
    const barWidth = Math.max(2, (percentage / 100) * 260);
    return `
      <text x="${x}" y="${y}" fill="${colors.text}" font-size="12" font-weight="600">${xml(name)}</text>
      <rect x="${x + 125}" y="${y - 9}" width="260" height="7" rx="3.5" fill="${colors.track}"/>
      <rect x="${x + 125}" y="${y - 9}" width="${barWidth.toFixed(1)}" height="7" rx="3.5" fill="${colors.accent}"/>
      <text x="${x + 400}" y="${y}" fill="${colors.muted}" font-size="11" text-anchor="end">${percentage.toFixed(1)}%</text>
    `;
  }).join("");

  const emptyLanguages = '<text x="35" y="217" fill="' + colors.muted + '" font-size="13">No language data was returned by GitHub.</text>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">GitHub public repository telemetry for ${OWNER}</title>
  <desc id="desc">Live public repository count, stars, forks and language byte distribution, sourced from the GitHub REST API.</desc>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="12" fill="${colors.bg}" stroke="${colors.line}"/>
  <text x="30" y="31" fill="${colors.text}" font-size="15" font-weight="700" letter-spacing="1.2">PUBLIC REPOSITORY TELEMETRY</text>
  <text x="1050" y="31" fill="${colors.muted}" font-size="10" text-anchor="end">GITHUB REST API · ${updatedAt}</text>
  ${metricCards}
  <text x="30" y="179" fill="${colors.text}" font-size="12" font-weight="700" letter-spacing="1">LANGUAGE SHARE</text>
  <text x="1050" y="179" fill="${colors.muted}" font-size="10" text-anchor="end">SHARE OF REPORTED CODE BYTES · TOP 8</text>
  ${languageRows || emptyLanguages}
  <text x="30" y="319" fill="${colors.muted}" font-size="10">Scope: public, non-fork, non-archived repositories only. Private repositories are excluded.</text>
  </svg>`;
}

const repos = await getOwnedPublicRepos();
const languageTotals = await getLanguageTotals(repos);
const stars = repos.reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0);
const forks = repos.reduce((sum, repo) => sum + (repo.forks_count ?? 0), 0);
const updatedAt = new Date().toISOString().slice(0, 10);

await mkdir("assets", { recursive: true });
for (const theme of ["light", "dark"]) {
  const svg = createSvg({
    theme,
    repos: repos.length,
    stars,
    forks,
    languages: languageTotals,
    updatedAt,
  });
  await writeFile(`assets/github-telemetry-${theme}.svg`, svg, "utf8");
}

console.log(JSON.stringify({
  scope: "public, non-fork, non-archived repositories",
  repositories: repos.length,
  stars,
  forks,
  languages: languageTotals.slice(0, 8),
  updatedAt,
}, null, 2));
