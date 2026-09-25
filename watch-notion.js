// Følger med på Notion-databasen og starter GitHub-bygget når et publisert innlegg endres.
//
// Kjøres lokalt:  npm run watch   (stopp med Ctrl+C)
// Trenger i .env: NOTION_TOKEN, NOTION_DATABASE_ID, GITHUB_TOKEN, GITHUB_REPO
//
// Hvert 10. sekund (POLL_SECONDS) hentes id og «sist endret» for alle publiserte innlegg.
// Endrer det seg – nytt innlegg, endret innlegg, avpublisert eller slettet – ber scriptet
// GitHub starte «Bygg og publiser» (repository_dispatch «notion-updated»).
// Kladder som ikke er publisert starter ikke bygg.
//
// Notion lagrer «sist endret» bare med minutt-presisjon, så to endringer i samme minutt
// ser like ut. Derfor sendes det alltid ett ekstra bygg like etter at minuttet er over.

import { Client, collectPaginatedAPI } from "@notionhq/client";

const { NOTION_TOKEN, NOTION_DATABASE_ID, GITHUB_TOKEN, GITHUB_REPO } = process.env;
const POLL_MS = (Number(process.env.POLL_SECONDS) || 10) * 1000;

const missing = ["NOTION_TOKEN", "NOTION_DATABASE_ID", "GITHUB_TOKEN", "GITHUB_REPO"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Mangler ${missing.join(", ")} i .env (se README.md).`);
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const time = () => new Date().toLocaleTimeString("nb-NO");
const log = (msg) => console.log(`[${time()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Finn datakilden og avkrysningsboksen, på samme måte som build.js.
const database = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID });
const dataSource = await notion.dataSources.retrieve({ data_source_id: database.data_sources[0].id });
const PUBLISHED = ["Publisert", "Published"].find((n) => dataSource.properties[n]?.type === "checkbox");
if (!PUBLISHED) throw new Error("Databasen mangler en avkrysningsboks «Publisert» eller «Published».");

// «Fingeravtrykk» av alt som er publisert: endres når noe som vises på bloggen endres.
async function snapshot() {
  const pages = await collectPaginatedAPI(notion.dataSources.query, {
    data_source_id: dataSource.id,
    filter: { property: PUBLISHED, checkbox: { equals: true } },
  });
  const latest = pages.reduce((max, p) => (p.last_edited_time > max ? p.last_edited_time : max), "");
  const fingerprint = pages.map((p) => `${p.id}@${p.last_edited_time}`).sort().join("|");
  return { fingerprint, latest, count: pages.length };
}

async function startBuild(reason) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "321-notion-watch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "notion-updated", client_payload: { reason } }),
  });
  if (res.ok) log(`Bygg startet (${reason}).`);
  else log(`GitHub avviste forespørselen (${res.status}): ${await res.text()}`);
}

let followUp; // tidtaker for ekstra-bygget etter at minuttet er over
function scheduleFollowUp(latestEdit) {
  clearTimeout(followUp);
  const at = Date.parse(latestEdit) + 60_000 + 5_000; // litt etter at minuttet er over
  const wait = at - Date.now();
  if (wait > 0) followUp = setTimeout(() => startBuild("oppfølging etter siste endring"), wait);
}

let previous = await snapshot();
log(`Følger med på «${dataSource.title?.[0]?.plain_text ?? "databasen"}»: ${previous.count} publiserte innlegg. Sjekker hvert ${POLL_MS / 1000}. sekund.`);

while (true) {
  await sleep(POLL_MS);
  try {
    const current = await snapshot();
    if (current.fingerprint !== previous.fingerprint) {
      const what =
        current.count > previous.count ? "nytt innlegg publisert"
        : current.count < previous.count ? "innlegg avpublisert eller slettet"
        : "innlegg endret";
      previous = current;
      await startBuild(what);
      scheduleFollowUp(current.latest);
    }
  } catch (err) {
    log(`Feil: ${err.message}. Prøver igjen om 30 sekunder.`);
    await sleep(30_000);
  }
}
