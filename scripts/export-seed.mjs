import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const DB_PATH =
  ".wrangler-state/v3/d1/miniflare-D1DatabaseObject/a16e5ef16bdafb7968566035bd954c0b5f2ca2b37afc025d1fac2e838b1428de.sqlite";

const SKIP_TABLES = new Set(["_cf_METADATA"]);
// raw_articles: content 컬럼은 대용량이므로 NULL로 대체 (FK 충족용으로만 사용)
const NULLIFY_COLUMNS = { raw_articles: new Set(["content"]) };

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const TABLE_ORDER = ["sources", "raw_articles", "articles", "daily_digests"];
const allTables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  )
  .all()
  .map((r) => r.name)
  .filter((name) => !SKIP_TABLES.has(name));
const tables = [
  ...TABLE_ORDER.filter((t) => allTables.includes(t)),
  ...allTables.filter((t) => !TABLE_ORDER.includes(t)),
];

console.log("Tables to export:", tables);

const lines = [];

for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all();
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skip)`);
    continue;
  }
  console.log(`  ${table}: ${rows.length} rows`);

  const nullify = NULLIFY_COLUMNS[table] ?? new Set();
  lines.push(`-- ${table}`);
  for (const row of rows) {
    const entries = Object.entries(row);
    const cols = entries.map(([c]) => `"${c}"`).join(", ");
    const vals = entries
      .map(([c, v]) => {
        if (nullify.has(c)) return "NULL";
        if (v === null) return "NULL";
        if (typeof v === "number" || typeof v === "bigint") return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      })
      .join(", ");
    lines.push(`INSERT OR IGNORE INTO "${table}" (${cols}) VALUES (${vals});`);
  }
  lines.push("");
}


writeFileSync("seed-data.sql", lines.join("\n"), "utf8");
console.log("\nDone → seed-data.sql");
