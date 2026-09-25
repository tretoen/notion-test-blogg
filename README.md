# notion-test-blogg

Statisk blogg bygget fra en Notion-database. `build.js` henter alle innlegg der **Publisert** er huket av, konverterer dem til HTML via Markdown og skriver `dist/<slug>.html` + `dist/index.html`. Bilder lastes ned til `dist/img/` fordi Notion sine S3-lenker utløper etter ca. en time.

## Oppsett i Notion

1. Lag en database **Innlegg** med egenskapene:
   | Navn | Type |
   |---|---|
   | Tittel | Title |
   | Slug | Text (valgfri – lages fra tittelen hvis tom) |
   | Dato | Date |
   | Publisert | Checkbox |
2. Lag en intern integrasjon på <https://www.notion.so/profile/integrations> og kopier tokenet.
3. I databasen: **••• → Connections → legg til integrasjonen**.
4. Database-ID-en er den 32 tegn lange ID-en i URL-en til databasen (`notion.so/<workspace>/<ID>?v=...`).

## Kjøre lokalt

```sh
cp .env.example .env   # fyll inn NOTION_TOKEN og NOTION_DATABASE_ID
npm install
npm run build
npx serve dist         # eller åpne dist/index.html direkte
```

## GitHub Pages

1. Legg inn `NOTION_TOKEN` og `NOTION_DATABASE_ID` under **Settings → Secrets and variables → Actions**.
2. **Settings → Pages → Source: GitHub Actions**.
3. Workflowen bygger ved push til `main`, hver hele time og manuelt via **Actions → Bygg og publiser → Run workflow**.
