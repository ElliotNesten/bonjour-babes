# 🥂 Bonjour Babes

En drinktävling för kompisgänget, med lite fransk cocktailbar-känsla. Alla gör var sin drink till resten av gänget. Efter varje drink röstar man direkt i mobilen. Kvällen avslutas med en dramatisk prisutdelning på storskärmen, med trumvirvel, prispall och konfetti.

- **Storskärm (TV/laptop):** visar QR-kod och PIN, vem som blandar, hur många som har röstat, prisutdelningen och statistiken.
- **Mobilen:** man går med via PIN (som i Kahoot), skriver sitt namn och sin drink och röstar sedan på varje drink.
- **Admin (värden):** styr allt från sin egen mobil och spelar samtidigt själv.
- **Resultatsida:** en länk alla kan öppna, med placeringar, betyg, kommentarer och statistik.
- **Instagram Story-bild:** en bild på 1080×1920 med prispallen, som kan delas direkt.
- **Hall of Fame:** alla kvällar sparas, med flest segrar och kvällens bästa drinkar genom tiderna.

---

## Så går kvällen till

1. **Admin** öppnar `/#/admin`, loggar in och trycker på *Skapa nytt spel*. Spelet får en 6-siffrig PIN.
2. **Storskärmen** öppnar `/#/tv` och skriver in PIN:en, eller öppnar länken *📺 Storskärm* från adminpanelen. Tryck på *Starta storskärmen* så att ljudet slås på.
3. **Alla gäster** skannar QR-koden eller går in på sidan och skriver PIN:en. Sedan fyller de i namn och namnet på sin drink.
4. Admin trycker på **🎲 Lotta ordningen**. Storskärmen visar lottningen.
5. För varje drink:
   - *Nästa drink är på väg*: storskärmen visar vem som blandar.
   - *Drinken är serverad*: admin öppnar röstningen och alla utom skaparen röstar i mobilen.
   - *Lås röstningen*, och sedan *Nästa drink*.
6. När alla drinkar är klara röstar gästerna fram **specialpriserna** i mobilen.
7. **Prisutdelningen:** admin bläddrar fram stegen och storskärmen avslöjar resultatet. Ingen ser några poäng innan dess, inte ens admin.
8. Admin trycker på **Avsluta & spara i Hall of Fame**. Resultatsidan blir då publik och alla kan dela sin Story-bild.

## Poängsystemet

Varje domare sätter **1–10** i fyra kategorier:

| Kategori | Vikt |
|---|---|
| 👅 Smak | ×4 |
| 🎨 Utseende | ×2 |
| 💡 Kreativitet | ×2 |
| 🔁 Skulle beställa igen | ×1 |

- En domares totalpoäng är `(4·smak + 2·utseende + 2·kreativitet + 1·igen) / 9 × 10`. Det blir **10–100 poäng**.
- **Drinkens slutpoäng** är snittet av alla domares totalpoäng, avrundat till en decimal.
- Man röstar aldrig på sin egen drink.
- **OS-regeln:** har en drink minst 5 röster stryks det högsta och det lägsta betyget, som i konståkning. Det motverkar taktikröstning. Regeln kan stängas av i admin.
- **Vid lika poäng** vinner den med högst snitt på smak, och därefter den med flest 10:or. Är allt lika delar drinkarna placering.
- **Specialpriser** ger bara ära, inga poäng: 🏷️ Bästa namn · 🌶️ Mest vågad · 💀 Träskmonstret · ⭐ Publikens favorit.
- **Statistik:** snällaste och hårdaste domaren, mest splittrade och mest eniga drinken, flest 10:or och kvällens högsta betyg.
- **Kommentarer** visas anonymt på storskärmen och på resultatsidan.

---

## Installation på Vercel (gratis, ungefär 10 minuter)

Allt körs på **Vercel**: sidan, API:t (Vercel Functions i `api/`) och databasen (**Postgres från Neon**, som du skapar direkt under fliken *Storage* i Vercel – inget separat konto behövs). Gratisnivåerna räcker gott för en kväll med ett tiotal mobiler.

### 1. Importera projektet

1. Logga in på [vercel.com](https://vercel.com) (gratisplanen *Hobby* räcker) och välj **Add New… → Project**.
2. Importera GitHub-repot `bonjour-babes`. Vercel känner igen Vite automatiskt – ändra inga bygginställningar.
3. Tryck på **Deploy**. Sidan fungerar inte fullt ut förrän databasen är kopplad (steg 2).

### 2. Skapa databasen

1. Öppna projektet i Vercel och gå till **Storage → Create Database → Neon (Serverless Postgres)**.
2. Välj regionen **Frankfurt (eu-central-1)** – samma region som API:t körs i (`vercel.json`) – och gratisplanen.
3. **Connect** databasen till projektet (alla miljöer). Vercel lägger då in `DATABASE_URL` automatiskt.
4. Gå till **Deployments**, välj den senaste deployen och **Redeploy**, så att den får med databasen. Tabellen skapas automatiskt första gången sidan används.

> Säkerheten sköts av servern: alla läsningar och skrivningar kontrolleras mot reglerna i [`server/rules.ts`](server/rules.ts). Bara admin kan styra spelet, och man kan bara rösta på den drink som är aktuell medan röstningen är öppen.

### 3. Välj adminlösenord

Öppna `https://<ditt-projekt>.vercel.app/#/admin` direkt efter publiceringen och välj ett lösenord (minst 8 tecken – välj något som gästerna inte kan gissa). Den som först väljer ett lösenord blir admin. Lösenordet sparas som en hash som ingen kan läsa, och felaktiga inloggningsförsök begränsas.

*Glömt lösenordet?* Gå till **Storage → din Neon-databas → Open in Neon → SQL Editor** och kör:

```sql
DELETE FROM bb_docs WHERE key IN ('secret', 'setup');
```

Välj sedan ett nytt lösenord på `/#/admin`.

---

## Utveckling

```bash
npm install
npm run dev         # appen + API:t lokalt; utan databas sparas allt i .data/dev-db.json
npm run dev:local   # demoläge helt i webbläsaren (varje flik = egen användare)
npm test            # enhetstester: poäng, spellogik, säkerhetsregler, API
npm run build       # typkontroll + produktionsbygge till dist/
```

Vill du köra mot en riktig Postgres lokalt sätter du `DATABASE_URL` (t.ex. med `vercel env pull .env.local` eller en lokal Postgres) innan `npm run dev`. `npm run test:pg` kör databastesterna mot `TEST_DATABASE_URL`.

I utvecklingsläge kan du skapa ett demospel med påhittade deltagare från webbläsarkonsolen (i fliken där du är inloggad som admin):

```js
await __bb.seed({ status: 'ceremony', step: 3, players: 9 })
// status: 'lobby' | 'running' | 'awards' | 'ceremony' | 'finished'
```

### Struktur

```
src/
  lib/          datamodell, poängsystem (scoring.ts), spel-actions (game.ts), databaslager (backend/)
  components/   delade komponenter (logo, avatar, QR, Story-knapp …)
  views/
    player/     mobilvyn: gå med, rösta, specialpriser, resultat
    admin/      adminpanelen
    tv/         storskärmen och prisutdelningen (ljud via Web Audio, konfetti)
    results/    resultatsidan och Hall of Fame
api/            Vercel Functions: session, läsning och skrivning
server/         API-logik, säkerhetsregler (rules.ts) och lagring i Postgres
vercel.json     region för API:t (Frankfurt)
```
