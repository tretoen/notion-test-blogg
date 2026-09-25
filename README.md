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

Et nytt eller endret innlegg i Notion er altså ute innen en time, eller med en gang om man kjører workflowen manuelt.
