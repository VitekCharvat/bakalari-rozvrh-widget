# Jak přispět

Díky, že chceš pomoct. Přispět se dá i bez programování: nahlásit chybu, navrhnout funkci nebo vyzkoušet widget s Bakaláři jiné školy.

## Chyby a nápady

- **Chyba:** založ [issue](https://github.com/VitekCharvat/bakalari-rozvrh-widget/issues/new/choose) podle šablony „Chyba". Přidej screenshot, verzi z menu skriptu a model iPhonu.
- **Nápad:** šablona „Nápad". U větší změny (nový typ widgetu, jiné API) nejdřív issue, ať se domluvíme, než nad tím strávíš večer.
- **Nikdy nevkládej heslo, token ani rozvrh se jmény učitelů.** Ani do issue, ani do kódu, ani do testovacích dat.

## Co potřebuješ

- [Node.js](https://nodejs.org) 20 nebo novější. Na nic jiného se nespoléhá, `npm install` není potřeba.
- Git a účet na GitHubu.
- Na vyzkoušení iPhone se [Scriptable](https://apps.apple.com/app/scriptable/id1405459188). Bez něj jde aspoň spustit testy.

## Struktura projektu

| Soubor | K čemu je |
| :-- | :-- |
| `src/BakalariRozvrh.js` | **Zdroják. Tady se dělají všechny změny.** Čitelná čeština, komentáře. |
| `BakalariRozvrh.js` | Vygenerovaný soubor, který si lidi kopírují do iPhonu. Jen ASCII, čeština jako `ě`. **Needituj ručně.** |
| `scripts/build.js` | Udělá z `src/` soubor v kořeni (`npm run build`). |
| `test/logika.test.js` | Testy čisté logiky: výběr dne, stránky, shrnutí, barvy učeben. |
| `test/scriptable.test.js` | Spustí celý skript proti napodobenému Scriptable API a kontroluje, co se vykreslí. |
| `test/build.test.js` | Hlídá, že build je aktuální a čistě ASCII. |
| `test/fixtures/` | Anonymizované odpovědi API Bakalářů. |

Skript má dvě části. **Čistá logika** nahoře nesahá na Scriptable API a testuje se v Node. **Scriptable část** (přihlášení, stahování, vzhled) běží jen na iPhonu. Novou logiku piš do čisté části a přidej k ní test.

## Postup pull requestu

1. **Fork:** na GitHubu klikni na **Fork**, vznikne tvoje kopie repozitáře.
2. **Naklonuj ji a založ větev:**
   ```bash
   git clone https://github.com/<tvuj-ucet>/bakalari-rozvrh-widget.git
   cd bakalari-rozvrh-widget
   git switch -c oprava-suplovani
   ```
3. **Uprav `src/BakalariRozvrh.js`** a k nové logice přidej test do `test/`.
4. **Sestav a otestuj:**
   ```bash
   npm run build
   npm test
   ```
   Všechny testy musí projít. Když zapomeneš na `npm run build`, test `build.test.js` selže, to je schválně.
5. **Vyzkoušej na iPhonu**, pokud měníš cokoli, co je vidět. Zkopíruj vygenerovaný `BakalariRozvrh.js` do Scriptable (jako nový skript, ať si nerozbiješ ten svůj) a udělej screenshot.
6. **Commitni a pushni:**
   ```bash
   git add -A
   git commit -m "Suplování: zobrazit i změnu učebny"
   git push -u origin oprava-suplovani
   ```
7. **Otevři pull request** na GitHubu (tlačítko **Compare & pull request**). Vyplň šablonu a přilož screenshot.

GitHub u každého pull requestu sám spustí testy. Když svítí červeně, klikni na **Details** a uvidíš, který test selhal.

## Pravidla kódu

- Piš jako okolní kód: **české názvy a komentáře**, bez středníků, dvě mezery odsazení.
- **Žádné závislosti.** Celý widget je jeden soubor, který se kopíruje do telefonu.
- Komentář vysvětluje **proč**, ne co. „Bakaláři občas posílají ID s mezerami" ano, „ořízne mezery" ne.
- Commit zprávy česky, krátký první řádek, co a proč.
- Testovací data musí být **anonymní**: místo jmen „Učitel A", žádné skutečné adresy škol. Skutečné odpovědi API si můžeš uložit jako `test/fixtures/skutecne-*.json`, git je ignoruje.

