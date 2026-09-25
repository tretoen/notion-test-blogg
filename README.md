# notion-test-blogg

Statisk blogg for 321, bygget fra en Notion-database og publisert med GitHub Pages. Designet følger 321.no (IBM Plex, mørk header og footer, kremfarget bakgrunn).

`build.js` henter alle innlegg der **Publisert** er huket av, konverterer dem til HTML via Markdown og skriver:

- `dist/index.html` – forsiden med alle innlegg i sin helhet, nyeste først. Tittelen lenker til innleggets egen side.
- `dist/<slug>.html` – én side per innlegg, som kan deles.
- `dist/om.html` – «Om bloggen».

Bilder lastes ned til `dist/img/` fordi Notion sine S3-lenker utløper etter ca. en time. Bilder som står rett etter hverandre i Notion vises side om side.

## Filer

| Fil | Hva |
|---|---|
| `build.js` | Henter innlegg fra Notion og bygger siden |
| `template.html` | Felles ramme for alle sider (header, meny, footer) |
| `style.css` | Utseendet |
| `pages/om.html` | Innholdet på «Om bloggen» |
| `assets/` | Logo og andre faste filer |
| `.github/workflows/build.yml` | Bygger og publiserer til GitHub Pages |
| `watch-notion.js` | Valgfri: starter bygg når Notion endres (kjøres lokalt, `npm run watch`) |
| `notion-webhook/` | Valgfri: samme, men som Cloudflare Worker |

Teksten øverst på alle sider («Blogg» og undertittelen) endres i `SITE` øverst i `build.js`.

## Oppsett i Notion

1. Databasen trenger disse egenskapene (norske eller engelske navn):
   | Navn | Type |
   |---|---|
   | Tittel / Name | Title |
   | Undertittel / Subtitle | Text (valgfri) |
   | Dato / Date | Date |
   | Publisert / Published | Checkbox |
   | Slug | Text (valgfri – lages fra tittelen hvis tom) |
2. Lag en intern integrasjon på <https://www.notion.so/profile/integrations> og kopier tokenet.
3. I databasen: **••• → Connections → legg til integrasjonen**.
4. Database-ID-en er den 32 tegn lange ID-en i URL-en til databasen.

## GitHub Pages

1. Legg inn `NOTION_TOKEN` og `NOTION_DATABASE_ID` under **Settings → Secrets and variables → Actions**.
2. **Settings → Pages → Source: GitHub Actions**.
3. Workflowen bygger ved push til `main`, hver hele time og manuelt via **Actions → Bygg og publiser → Run workflow**.

Med automatisk oppdatering (se under) er endringer ute etter sekunder eller et par minutter. Uten det er de ute innen en time, eller med en gang om man kjører workflowen manuelt.

## Oppdatering med en gang når noe endres i Notion

Det finnes to måter å gjøre dette på. Begge starter samme workflow (`repository_dispatch` med typen `notion-updated`), så man kan bytte mellom dem uten å endre noe annet. Bruk bare én av gangen – ellers starter hver endring to bygg.

| | A: `watch-notion.js` (lokalt) | B: `notion-webhook/` (Cloudflare) |
|---|---|---|
| Hvordan | Sjekker Notion hvert 10. sekund | Notion sender beskjed ved endring |
| Kjører | På en maskin som står på | I Cloudflare, alltid på |
| Trenger | GitHub-token i `.env` | Cloudflare-konto, GitHub-token, webhook i Notion |
| Forsinkelse | ca. 10 sekunder | ca. 1–2 minutter (Notion samler opp endringer) |

Timesbyggingen blir liggende som sikkerhetsnett uansett.

### A: Lokal overvåking med watch-notion.js

`watch-notion.js` følger med på Notion-databasen og starter GitHub-bygget når et publisert innlegg endres – nytt innlegg, endret tekst eller bilder, avpublisert eller slettet. Kladder som ikke er publisert starter ikke bygg.

```
watch-notion.js (sjekker Notion hvert 10. sekund) → GitHub Actions (repository_dispatch) → GitHub Pages
```

Scriptet kjører på en maskin som står på (f.eks. en laptop eller en server). Det trenger ingen offentlig adresse. Når maskinen er av, tar timesbyggingen over.

Notion lagrer «sist endret» bare med minutt-presisjon, så scriptet sender alltid ett ekstra bygg like etter at minuttet med siste endring er over. Da kommer også endringer gjort i samme minutt med.

Oppsett:

1. **GitHub-token.** Gå til <https://github.com/settings/personal-access-tokens> → *Generate new token* (fine-grained).
   - *Resource owner*: `tretoen` (organisasjonen må kanskje godkjenne tokenet)
   - *Repository access*: kun `notion-test-blogg`
   - *Permissions → Repository → Contents*: **Read and write**
2. **`.env`.** Kopier `.env.example` til `.env` og fyll inn `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `GITHUB_TOKEN` og `GITHUB_REPO`.
3. **Start:**
   ```sh
   npm install
   npm run watch
   ```
   Scriptet skriver en linje hver gang det starter et bygg. Stopp med Ctrl+C.

Hvor ofte det sjekkes kan endres med `POLL_SECONDS` i `.env` (standard 10). Skal det kjøre hele tiden på Windows, kan det startes automatisk med Oppgaveplanlegging (Task Scheduler) ved pålogging.

### B: Cloudflare-relé (notion-webhook/)

Notion sender en webhook til en liten Cloudflare Worker, som sjekker signaturen fra Notion og ber GitHub starte bygget:

```
Notion (webhook) → Cloudflare Worker (notion-webhook/) → GitHub Actions (repository_dispatch) → GitHub Pages
```

Oppsett:

1. **GitHub-token** – samme type som over (fine-grained, kun `notion-test-blogg`, *Contents: Read and write*).
2. **Deploy workeren** (krever en gratis Cloudflare-konto):
   ```sh
   cd notion-webhook
   npx wrangler login
   npx wrangler deploy                      # gir en adresse som https://notion-blogg-webhook.<konto>.workers.dev
   npx wrangler secret put GITHUB_TOKEN     # lim inn tokenet
   ```
3. **Koble til Notion.** Start `npx wrangler tail` i et eget vindu (viser loggen fra workeren). Så:
   - Åpne integrasjonen på <https://www.notion.so/profile/integrations> → fanen **Webhooks** → **Create a subscription**.
   - URL: adressen fra steg 2.
   - Hendelser: `page.created`, `page.content_updated`, `page.properties_updated`, `page.deleted`, `page.undeleted`, `page.moved`.
   - Notion sender et verifiseringstoken. Det dukker opp i `wrangler tail` som `Notion verification_token: ...`.
   - Lim tokenet inn i Notion under **Verify**, og lagre det også i workeren:
     ```sh
     npx wrangler secret put NOTION_VERIFICATION_TOKEN
     ```
4. **Test.** Endre et innlegg i Notion. Etter 1–2 minutter skal det dukke opp en kjøring av «Bygg og publiser» under **Actions**, utløst av `repository_dispatch`.
5. **Stopp `npm run watch`** hvis den kjører, så det ikke startes dobbelt.

Feilsøking: `npx wrangler tail` viser hva workeren gjør med hver melding (startet bygg, ugyldig signatur, eller svar fra GitHub).
