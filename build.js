import { Client, collectPaginatedAPI } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { marked } from "marked";
import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { extname } from "node:path";

const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("Mangler NOTION_TOKEN eller NOTION_DATABASE_ID (se README.md).");
  process.exit(1);
}

const DIST = "dist";
const notion = new Client({ auth: NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });
const template = await readFile("template.html", "utf8");

const escape = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plain = (richText = []) => richText.map((t) => t.plain_text).join("");
const slugify = (s) =>
  s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-");
const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" }) : "";
const render = (vars) => template.replace(/{{(\w+)}}/g, (_, key) => vars[key] ?? "");

// Notion-hostede bilder ligger på S3-lenker som utløper etter ca. en time,
// så de lastes ned til dist/img/ og lenkene skrives om.
n2m.setCustomTransformer("image", async (block) => {
  const { type, caption } = block.image;
  const src = block.image[type].url;
  const alt = escape(plain(caption));
  if (type !== "file") return `![${alt}](${src})`;
  const file = `${block.id}${extname(new URL(src).pathname) || ".png"}`;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Klarte ikke laste ned bilde ${src}: ${res.status}`);
  await writeFile(`${DIST}/img/${file}`, Buffer.from(await res.arrayBuffer()));
  return `![${alt}](img/${file})`;
});

await rm(DIST, { recursive: true, force: true });
await mkdir(`${DIST}/img`, { recursive: true });

// API-versjon 2025-09-03: en database har én eller flere datakilder som spørres mot.
const database = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID });
const dataSource = await notion.dataSources.retrieve({ data_source_id: database.data_sources[0].id });

// Godtar både norske og engelske egenskapsnavn.
const findProp = (type, ...names) =>
  names.find((name) => dataSource.properties[name]?.type === type);
const PUBLISHED = findProp("checkbox", "Publisert", "Published");
const DATE = findProp("date", "Dato", "Date");
const SLUG = findProp("rich_text", "Slug");
const SUBTITLE = findProp("rich_text", "Undertittel", "Subtitle");
if (!PUBLISHED) throw new Error("Databasen mangler en avkrysningsboks «Publisert» eller «Published».");

const pages = await collectPaginatedAPI(notion.dataSources.query, {
  data_source_id: dataSource.id,
  filter: { property: PUBLISHED, checkbox: { equals: true } },
  sorts: DATE ? [{ property: DATE, direction: "descending" }] : [],
});

const posts = [];
for (const page of pages) {
  const props = page.properties;
  const title = plain(Object.values(props).find((p) => p.type === "title")?.title);
  const slug = slugify(plain(props[SLUG]?.rich_text) || title);
  const subtitle = plain(props[SUBTITLE]?.rich_text);
  const date = props[DATE]?.date?.start ?? "";
  if (!slug) {
    console.warn(`Hopper over side uten tittel/slug: ${page.url}`);
    continue;
  }

  const md = n2m.toMarkdownString(await n2m.pageToMarkdown(page.id)).parent ?? "";
  const content = `<article>
  <h1>${escape(title)}</h1>
  ${subtitle ? `<p class="subtitle">${escape(subtitle)}</p>` : ""}
  ${date ? `<time datetime="${date}">${formatDate(date)}</time>` : ""}
  ${marked.parse(md)}
</article>
<p><a href="./">← Alle innlegg</a></p>`;
  await writeFile(`${DIST}/${slug}.html`, render({ title: escape(title), content }));
  posts.push({ title, subtitle, slug, date });
  console.log(`✓ ${slug}.html`);
}

const list = posts
  .map((p) => `  <li><div><a href="${p.slug}.html">${escape(p.title)}</a>${p.subtitle ? `<p class="subtitle">${escape(p.subtitle)}</p>` : ""}</div>${p.date ? ` <time datetime="${p.date}">${formatDate(p.date)}</time>` : ""}</li>`)
  .join("\n");
await writeFile(`${DIST}/index.html`, render({ title: "Blogg", content: `<h1>Blogg</h1>\n<ul class="posts">\n${list}\n</ul>` }));
await copyFile("style.css", `${DIST}/style.css`);
console.log(`Ferdig: ${posts.length} innlegg i ${DIST}/`);
