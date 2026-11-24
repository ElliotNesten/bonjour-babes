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

## Installation (gratis, ungefär 10 minuter)

Sidan körs på **GitHub Pages**. Data sparas i **Firebase Realtime Database**. Båda är gratis i den här skalan: Firebase gratisplan "Spark" klarar 100 samtidiga anslutningar och 1 GB lagring.

### 1. Skapa ett Firebase-projekt

1. Gå till [console.firebase.google.com](https://console.firebase.google.com) och välj **Skapa projekt**, till exempel med namnet `bonjour-babes`. Google Analytics behövs inte.
2. Aktivera databasen:
   1. Gå till **Build → Realtime Database → Skapa databas**.
   2. Välj platsen **Belgien (europe-west1)**.
   3. Starta i **låst läge**.
3. Under fliken **Regler**: ersätt allt med innehållet i [`database.rules.json`](database.rules.json) och tryck på **Publicera**.
4. Aktivera inloggning:
   1. Gå till **Build → Authentication → Kom igång → Sign-in method**.
   2. Aktivera **Anonymous**.
5. Hämta konfigurationen:
   1. Gå till **Projektinställningar** (kugghjulet) **→ Allmänt → Dina appar** och klicka på webbikonen `</>`.
   2. Registrera en app. Firebase Hosting behövs inte.
   3. Kopiera `firebaseConfig`.
6. Klistra in konfigurationen i [`src/config.ts`](src/config.ts). Kontrollera att `databaseURL` finns med.

> Värdena i `firebaseConfig` är inte hemliga. Säkerheten sköts av databasreglerna: bara admin kan styra spelet, och man kan bara rösta på den drink som är aktuell medan röstningen är öppen.

### 2. Publicera på GitHub Pages

1. Gå till **Settings → Pages** i GitHub-repot och välj **Source: GitHub Actions**.
2. Pusha till standardgrenen. Flödet i `.github/workflows/deploy.yml` bygger, testar och publicerar sidan.
3. Sidan hamnar på `https://<användarnamn>.github.io/bonjour-babes/`.

### 3. Välj adminlösenord

Öppna `https://…/bonjour-babes/#/admin` direkt efter publiceringen och välj ett lösenord (minst 8 tecken – välj något som gästerna inte kan gissa). Den som först väljer ett lösenord blir admin. Lösenordet sparas som en hash som ingen kan läsa.

*Glömt lösenordet?* Radera noderna `secret` och `setup` under fliken **Data** i Realtime Database och välj ett nytt.

---

## Utveckling

```bash
npm install
npm run dev:local   # demoläge utan Firebase – allt sparas i webbläsaren (varje flik = egen användare)
npm run dev         # mot riktiga Firebase (kräver src/config.ts)
npm run dev:emu     # mot lokala Firebase-emulatorer (kör `npm run emulators` i en annan terminal)
npm test            # enhetstester för poäng- och spellogik
npm run test:rules  # tester av databasreglerna mot Firebase-emulatorn (kräver Java + firebase-tools)
npm run build       # typkontroll + produktionsbygge till dist/
```

I utvecklingsläge kan du skapa ett demospel med påhittade deltagare från webbläsarkonsolen:

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
database.rules.json   säkerhetsregler för Firebase
```
