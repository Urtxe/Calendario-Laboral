const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const GENERATED_DATA = path.join(ROOT, "seo", "data", "convenios.generated.json");
const TOPIC_CONFIG = path.join(ROOT, "seo", "data", "convenios.derived-topics.json");
const NOT_FOUND = "No localizado en el texto disponible";

function isFound(value) {
  return Boolean(value && value !== NOT_FOUND);
}

function interpolate(pattern, values) {
  return String(pattern || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] || "");
}

function canGenerate(entry, topic) {
  const missing = (topic.minimumData || []).filter((field) => !isFound(entry.content && entry.content[field]));
  if (!missing.length) {
    return { status: "ready", missing };
  }
  if (topic.fallbackPolicy === "generate_prudent" && isFound(entry.content && entry.content.vigencia)) {
    return { status: "prudent", missing };
  }
  return { status: "blocked", missing };
}

function buildPlan(entries, config) {
  const topics = config.topics || [];
  const rows = [];

  entries.forEach((entry) => {
    topics.forEach((topic) => {
      const result = canGenerate(entry, topic);
      rows.push({
        convenioSlug: entry.slug,
        topicSlug: topic.slug,
        status: result.status,
        missing: result.missing,
        url: interpolate(config.urlPattern, {
          convenioSlug: entry.slug,
          topicSlug: topic.slug,
        }),
        output: interpolate(config.outputPattern, {
          convenioSlug: entry.slug,
          topicSlug: topic.slug,
        }),
        title: interpolate(topic.titlePattern, {
          title: entry.title,
        }),
      });
    });
  });

  return rows;
}

async function main() {
  const [inventoryRaw, configRaw] = await Promise.all([
    fsp.readFile(GENERATED_DATA, "utf8"),
    fsp.readFile(TOPIC_CONFIG, "utf8"),
  ]);
  const inventory = JSON.parse(inventoryRaw);
  const config = JSON.parse(configRaw);
  const entries = inventory.generated || [];
  const plan = buildPlan(entries, config);
  const summary = plan.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`Derived SEO generation enabled: ${config.generationEnabled === true}`);
  console.log(`Convenios base: ${entries.length}`);
  console.log(`Topics configured: ${(config.topics || []).length}`);
  console.log(`Potential derived pages: ${plan.length}`);
  console.log(`Ready: ${summary.ready || 0}`);
  console.log(`Prudent fallback candidates: ${summary.prudent || 0}`);
  console.log(`Blocked by missing data: ${summary.blocked || 0}`);
  console.log("No files were written.");
}

main().catch((error) => {
  console.error("Error planning derived SEO pages:", error);
  process.exitCode = 1;
});
