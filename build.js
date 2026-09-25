import { Client, collectPaginatedAPI } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { marked } from "marked";
import { cp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { extname } from "node:path";

const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("Mangler NOTION_TOKEN eller NOTION_DATABASE_ID (se README.md).");
  process.exit(1);
}

// Tekst i toppen av alle sider. Endre her.
const SITE = {
  name: "Blogg",
  lead: "Nytt, tanker og erfaringer fra oss i 321",
};

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
// Rene datoer (2026-09-25) tolkes som UTC-midnatt, så de formateres i UTC for å ikke havne på feil dag.
const formatDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("nb-NO", {
        day: "numeric", month: "long", year: "numeric",
        timeZone: iso.length === 10 ? "UTC" : "Europe/Oslo",
      })
    : "";

// Fyller inn template.html. `current` markerer aktiv lenke i menyen.
const CURRENT = ' aria-current="page"';
const render = ({ title, content, current = "" }) =>
  template.replace(/{{(\w+)}}/g, (_, key) => ({
    title,
    content,
    siteName: escape(SITE.name),
    siteLead: escape(SITE.lead),
    navBlogg: current === "blogg" ? CURRENT : "",
    navOm: current === "om" ? CURRENT : "",
  })[key] ?? "");

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

// Overskrifter inne i et innlegg skal være mindre enn innleggets tittel (h2):
// Notion-overskrift 1 og 2 blir h3, overskrift 3 blir h4.
marked.use({
  walkTokens(token) {
    if (token.type === "heading") token.depth = Math.min(Math.max(token.depth + 1, 3), 6);
  },
});

// Bilder som står rett etter hverandre i Notion samles i ett galleri:
// ett bilde vises stort, to eller flere side om side (se .gallery i style.css).
const galleries = (html) =>
  html
    .replace(/<p>((?:\s*<img\b[^>]*>\s*)+)<\/p>/g, (_, imgs) => `\u0000${imgs.trim()}\u0001`)
    .replace(/(?:\u0000[^\u0001]*\u0001\s*)+/g, (run) =>
      `<div class="gallery">${run.replace(/[\u0000\u0001]/g, "").replace(/>\s+</g, "><").trim()}</div>\n`)
    .replace(/<img /g, '<img loading="lazy" ')
    // Brede tabeller kan rulles sidelengs på mobil.
    .replace(/<table>/g, '<div class="table"><table>')
    .replace(/<\/table>/g, "</table></div>");

// Ett innlegg. På forsiden lenker tittelen til innleggets egen side.
const article = (post, { linkTitle }) => `<article class="post">
  ${post.date ? `<time datetime="${post.date}">${formatDate(post.date)}</time>` : ""}
  <h2>${linkTitle ? `<a href="${post.slug}.html">${escape(post.title)}</a>` : escape(post.title)}</h2>
  ${post.subtitle ? `<p class="subtitle">${escape(post.subtitle)}</p>` : ""}
  ${post.html}
</article>`;

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

// Filnavn som allerede er i bruk (og ikke kan brukes av innlegg).
const usedSlugs = new Set(["index", "om", "404"]);

const posts = [];
for (const page of pages) {
  const props = page.properties;
  const title = plain(Object.values(props).find((p) => p.type === "title")?.title);
  let slug = slugify(plain(props[SLUG]?.rich_text) || title);
  const subtitle = plain(props[SUBTITLE]?.rich_text);
  const date = props[DATE]?.date?.start ?? "";
  if (!slug) {
    console.warn(`Hopper over side uten tittel/slug: ${page.url}`);
    continue;
  }
  // To innlegg med samme tittel skal ikke overskrive hverandre.
  if (usedSlugs.has(slug)) {
    let n = 2;
    while (usedSlugs.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  usedSlugs.add(slug);

  const md = n2m.toMarkdownString(await n2m.pageToMarkdown(page.id)).parent ?? "";
  const post = { title, subtitle, slug, date, html: galleries(marked.parse(md)) };

  const content = `<div class="posts">
${article(post, { linkTitle: false })}
</div>
<p class="back"><a href="./">← Alle innlegg</a></p>`;
  await writeFile(`${DIST}/${slug}.html`, render({ title: `${escape(title)} – 321`, content }));
  posts.push(post);
  console.log(`✓ ${slug}.html`);
}

// Forsiden: alle innlegg i sin helhet, nyeste først.
const list = posts.length
  ? posts.map((p) => article(p, { linkTitle: true })).join("\n")
  : `<p class="empty">Ingen innlegg ennå – kom tilbake snart.</p>`;
await writeFile(
  `${DIST}/index.html`,
  render({ title: `${escape(SITE.name)} – 321`, content: `<div class="posts">\n${list}\n</div>`, current: "blogg" })
);

// «Om bloggen»-siden.
const om = await readFile("pages/om.html", "utf8");
await writeFile(`${DIST}/om.html`, render({ title: "Om bloggen – 321", content: om, current: "om" }));

await copyFile("style.css", `${DIST}/style.css`);
await cp("assets", `${DIST}/assets`, { recursive: true });
console.log(`Ferdig: ${posts.length} innlegg i ${DIST}/`);
