# Bakaláři rozvrh – widget pro iPhone

Rozvrh z Bakalářů přímo na ploše iPhonu. Widget ukazuje čas hodiny, předmět a učebnu, takže kvůli rozvrhu nemusíš otvírat appku.

```
┌───────────────────────────────────────────────────┐
│ Dnes · pondělí 2. 11.  ještě 8 hodin · do 16:45 ●○│
│ 8:00 – 8:45 · zbývá 12:03 │ 11:45 – 12:30 · supl. │
│ EKO                [234]  │ ANJ            [236]  │
│ 8:55 – 9:40               │ 12:40 – 13:25         │
│ MAT                [234]  │ VIK            [238]  │
│ 9:50 – 10:35              │ 13:30 – 14:15         │
│ CJL                [234]  │ VIK            [238]  │
└───────────────────────────────────────────────────┘
```

## Co umí

- **Dnešní rozvrh od aktuální hodiny dál.** Odučené hodiny z widgetu zmizí. Probíhající hodina je zvýrazněná a ukazuje živý odpočet do konce.
- **Posouvání po stránkách.** Když se den nevejde, dáš na plochu dva widgety do zásobníku a listuješ mezi nimi prstem (návod níž). Tečky v hlavičce ukazují, na které stránce jsi.
- **Učebna v barevném štítku**, každý předmět má svou stálou barvu.
- **Po vyučování ukáže další školní den.** Večer zítřek, v pátek pondělí, přes prázdniny první den, kdy se zase učí.
- **Suplování a změny** jsou oranžově, hodina, která odpadá, má místo učebny „odpadá".
- **Klepnutím na widget** se otevře celý den včetně učitele, tématu a popisu změny.
- **Funguje i bez internetu.** Ukáže poslední stažený rozvrh a v hlavičce napíše „offline" s časem, kdy se data stáhla.
- **Světlý, tmavý nebo automatický vzhled**, přepíná se v menu skriptu. Střední widget, počítá i s malým a velkým.

## Instalace

Potřebuješ iPhone s iOS 16 nebo novějším a přihlašovací údaje do Bakalářů. Mac ani placený účet nejsou potřeba.

1. Z App Store si stáhni zdarma appku **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)**.
2. Otevři soubor [`BakalariRozvrh.js`](BakalariRozvrh.js), klikni na **Raw** a zkopíruj celý text.
3. Ve Scriptable klepni na **+** vpravo nahoře, vlož text a skript přejmenuj na `BakalariRozvrh` (klepnutím na název nahoře).
4. Klepni na ▶︎ a vyplň:
   - **adresu školy** – stačí ji zkopírovat z prohlížeče, když jsi přihlášený do webových Bakalářů, např. `https://bakalari.skola.cz/bakaweb`. Zbytek adresy (`/next/…`, `/login`) se ořízne sám,
   - **uživatelské jméno a heslo** do Bakalářů.
5. Na ploše podrž prst na volném místě → **+** vlevo nahoře → najdi **Scriptable** → vyber **střední** widget → **Přidat**.
6. Podrž prst na widgetu → **Upravit widget** → u **Script** vyber `BakalariRozvrh` a u **When Interacting** nech **Run Script**.

Hotovo. Kdybys chtěl změnit vzhled, školu nebo se odhlásit, spusť skript ve Scriptable a vyber to v menu.

### Posouvání: druhá stránka v zásobníku

Widgety na iPhonu se posouvat nedají, ale dají se skládat na sebe a listovat mezi nimi prstem.

1. Přidej na plochu druhý **střední** widget Scriptable se skriptem `BakalariRozvrh`.
2. U něj v **Upravit widget** vyplň **Parameter** číslem `2`. První widget nech prázdný (nebo `1`).
3. Podrž prst na druhém widgetu a přetáhni ho přímo na první. Vznikne zásobník.
4. Mezi stránkami listuješ tahem prstem nahoru a dolů. Když iPhone stránky přepíná sám, vypni v úpravě zásobníku **Inteligentní otáčení**.

Při dlouhém dni přidej klidně i třetí stránku s parametrem `3`.

## Bezpečnost

- Jméno a heslo se ukládají jen do **Klíčenky (Keychain) tvého iPhonu**. Nikam jinam se neposílají, jen na adresu tvé školy.
- Skript mluví přímo s Bakaláři tvé školy přes jejich oficiální mobilní API, stejné, které používá appka Bakaláři. Žádný server mezi tím není.
- Kód je krátký a celý čitelný v jednom souboru, než ho vložíš, můžeš si ho projít.

## Omezení

- **Widget se nedá posouvat.** Tohle iOS u widgetů nedovoluje vůbec, ani nativním appkám. Proto widget ukazuje jen hodiny od teď dál a celý den najdeš po klepnutí.
- **iOS rozhoduje, jak často se widget obnoví.** Skript si říká o obnovu na začátku a konci každé hodiny, ale iPhone to může o pár minut posunout, hlavně v úsporném režimu.
- Typy změn v rozvrhu (`Canceled`, `Removed`, `Substitution`…) jsou převzaté z neoficiální dokumentace API. Kdyby se u tvé školy nějaká změna zobrazovala divně, založ issue.

## Vývoj

Zdroják se upravuje v [`src/BakalariRozvrh.js`](src/BakalariRozvrh.js). Soubor `BakalariRozvrh.js` v kořeni je z něj vygenerovaný a obsahuje jen ASCII znaky (čeština je přepsaná jako `ě` apod.). Důvod: při přenosu e-mailem nebo zprávou iPhone někdy přečte UTF-8 špatně a z „Pondělí" se stane „Pond?l�". Po každé změně spusť:

```bash
npm run build
```

Logika (výběr dne, okno hodin, zpracování odpovědi API) je napsaná bez Scriptable API, takže jde testovat v Node. Druhá sada testů spustí celý vygenerovaný skript proti napodobenému Scriptable a třetí hlídá, že build je aktuální a čistě ASCII.

```bash
npm test
```

Ukázková data jsou v `test/fixtures/` (anonymizovaná).

## Licence

[MIT](LICENSE). Projekt není nijak spojený se společností BAKALÁŘI software s.r.o.
