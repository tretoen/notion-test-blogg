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

Med Notion-reléet under (anbefalt) er endringer ute etter et par minutter. Uten det er de ute innen en time, eller med en gang om man kjører workflowen manuelt.

## Oppdatering med en gang når noe endres i Notion

I tillegg til timesbyggingen kan Notion si fra når et innlegg endres, så bygges siden med en gang:

```
Notion (webhook) → Cloudflare Worker (notion-webhook/) → GitHub Actions (repository_dispatch) → GitHub Pages
```

Notion samler opp tekstendringer, så et bygg starter ca. 1–2 minutter etter at noen har sluttet å skrive. Workeren sjekker signaturen fra Notion, så ingen andre kan starte bygg. Timesbyggingen blir liggende som sikkerhetsnett.

Oppsettet gjøres én gang:

1. **GitHub-token.** Gå til <https://github.com/settings/personal-access-tokens> → *Generate new token* (fine-grained).
   - *Resource owner*: `tretoen` (organisasjonen må kanskje godkjenne tokenet)
   - *Repository access*: kun `notion-test-blogg`
   - *Permissions → Repository → Contents*: **Read and write**
2. **Deploy workeren** (krever en gratis Cloudflare-konto):
   ```sh
   cd notion-webhook
   npx wrangler login
   npx wrangler deploy                      # gir en adresse som https://notion-blogg-webhook.<konto>.workers.dev
   npx wrangler secret put GITHUB_TOKEN     # lim inn tokenet fra steg 1
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

Feilsøking: `npx wrangler tail` viser hva workeren gjør med hver melding (startet bygg, ugyldig signatur, eller svar fra GitHub).
