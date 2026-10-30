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

Funguje s Bakaláři jakékoli školy. Je to skript pro aplikaci [Scriptable](https://scriptable.app), takže nepotřebuješ Mac ani placený účet u Applu.

## Co umí

- **Dnešní rozvrh od aktuální hodiny dál.** Odučené hodiny z widgetu zmizí. Probíhající hodina je zvýrazněná a ukazuje živý odpočet do konce.
- **Posouvání po stránkách.** Když se den nevejde, dáš na plochu dva widgety do zásobníku a listuješ mezi nimi prstem (návod níž). Tečky v hlavičce ukazují, na které stránce jsi.
- **Učebna v barevném štítku**, každá učebna má svou barvu. Nejčastější učebna v týdnu (kmenová třída) je vždycky modrá.
- **Po vyučování ukáže další školní den.** Večer zítřek, v pátek pondělí, přes prázdniny první den, kdy se zase učí.
- **Suplování a změny** jsou oranžově, hodina, která odpadá, má místo učebny „odpadá".
- **Klepnutím na widget** se otevře celý den včetně učitele, tématu a popisu změny.
- **Upozornění na změny (volitelné).** Když zapneš v menu skriptu „Upozornění na změny", přijde ti zpráva o suplování nebo zrušené hodině kdykoli v následujícím týdnu. Chodí při obnově widgetu, takže se můžou o pár desítek minut zpozdit. V noci (22:00–6:00) se nic neposílá, změna přijde ráno.
- **Funguje i bez internetu.** Ukáže poslední stažený rozvrh a v hlavičce napíše „offline" s časem, kdy se data stáhla.
- **Světlý, tmavý nebo automatický vzhled**, přepíná se v menu skriptu. Střední widget, počítá i s malým a velkým.

## Jak stáhnout a nainstalovat

Potřebuješ iPhone s iOS 16 nebo novějším a přihlašovací údaje do Bakalářů.

1. Z App Store si stáhni zdarma appku **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)**.
2. Na iPhonu otevři v Safari tenhle odkaz:
   **https://raw.githubusercontent.com/VitekCharvat/bakalari-rozvrh-widget/main/BakalariRozvrh.js**
   Ukáže se text skriptu. Podrž na něm prst → **Vybrat vše** → **Kopírovat**.
3. Ve Scriptable klepni na **+** vpravo nahoře, vlož text a skript přejmenuj na `BakalariRozvrh` (klepnutím na název nahoře).
4. Klepni na ▶︎ a vyplň:
   - **adresu školy** – stačí ji zkopírovat z prohlížeče, když jsi přihlášený do webových Bakalářů, např. `https://bakalari.skola.cz/bakaweb`. Zbytek adresy (`/next/…`, `/login`) se ořízne sám,
   - **uživatelské jméno a heslo** do Bakalářů.
5. Na ploše podrž prst na volném místě → **+** vlevo nahoře → najdi **Scriptable** → vyber **střední** widget → **Přidat**.
6. Podrž prst na widgetu → **Upravit widget** → u **Script** vyber `BakalariRozvrh` a u **When Interacting** nech **Run Script**.

Hotovo. Kdybys chtěl změnit vzhled, školu nebo se odhlásit, spusť skript ve Scriptable a vyber to v menu.

Skript v textu nemá diakritiku, ale znaky jako `ě`. To je schválně: kdyby se při kopírování pokazilo kódování, čeština by se rozbila. Na widgetu se zobrazí normálně.

### Posouvání: druhá stránka v zásobníku

Jeden widget se posouvat nedá, ale widgety jdou skládat na sebe a listovat mezi nimi prstem.

1. Přidej na plochu druhý **střední** widget Scriptable se skriptem `BakalariRozvrh`.
2. U něj v **Upravit widget** vyplň **Parameter** číslem `2`. První widget nech prázdný (nebo `1`).
3. Podrž prst na druhém widgetu a přetáhni ho přímo na první. Vznikne zásobník.
4. Mezi stránkami listuješ tahem prstem nahoru a dolů. Když iPhone stránky přepíná sám, vypni v úpravě zásobníku **Inteligentní otáčení**.

Při dlouhém dni přidej klidně i třetí stránku s parametrem `3`. V **Náhledu widgetu** ve Scriptable se posouvat nedá, náhled se proto zeptá, kterou stránku ukázat.

## Jak aktualizovat

1. Otevři znovu [odkaz na skript](https://raw.githubusercontent.com/VitekCharvat/bakalari-rozvrh-widget/main/BakalariRozvrh.js) a zkopíruj celý text.
2. Ve Scriptable otevři skript `BakalariRozvrh`, smaž celý starý text a vlož nový.

Přihlašovat se znovu nemusíš, údaje zůstávají v Klíčence. Jakou verzi máš, uvidíš v menu skriptu. Co se v které verzi změnilo, je v [Releases](https://github.com/VitekCharvat/bakalari-rozvrh-widget/releases).

## Bezpečnost

- Jméno a heslo se ukládají jen do **Klíčenky (Keychain) tvého iPhonu**. Nikam jinam se neposílají, jen na adresu tvé školy.
- Skript mluví přímo s Bakaláři tvé školy přes jejich mobilní API, stejné, které používá appka Bakaláři. Žádný server mezi tím není.
- Kód je celý v jednom souboru a dá se přečíst, než ho vložíš. Čitelná verze s diakritikou je v [`src/BakalariRozvrh.js`](src/BakalariRozvrh.js).

## Omezení

- **iOS rozhoduje, jak často se widget obnoví.** Skript si říká o obnovu na začátku a konci každé hodiny, ale iPhone to může o pár minut posunout, hlavně v úsporném režimu. Rozvrh se ze školy stahuje nejvýš jednou za 15 minut, mezitím widget bere uložená data, aby se stihl vykreslit. Kdy se widget naposledy obnovil a jestli doběhl, uvidíš v menu skriptu v **Diagnostice obnovy widgetu**.
- Typy změn v rozvrhu (`Canceled`, `Removed`, `Substitution`…) jsou převzaté z neoficiální dokumentace API. Kdyby se u tvé školy nějaká změna zobrazovala divně, [nahlas to](https://github.com/VitekCharvat/bakalari-rozvrh-widget/issues/new/choose).

## Něco nefunguje?

Založ [issue](https://github.com/VitekCharvat/bakalari-rozvrh-widget/issues/new/choose). Pomůže screenshot widgetu, verze z menu skriptu a popis, co jsi čekal. Když se widget neobnovuje, přidej i screenshot z **Diagnostiky obnovy widgetu** v menu skriptu. **Nikdy do issue nedávej heslo ani svůj rozvrh se jmény učitelů.**

## Jak přispět

Pull requesty jsou vítané, od opravy překlepu po novou funkci. Postup, struktura projektu a pravidla jsou v [CONTRIBUTING.md](CONTRIBUTING.md). Ve zkratce:

```bash
git clone https://github.com/<tvuj-ucet>/bakalari-rozvrh-widget.git
cd bakalari-rozvrh-widget
git switch -c moje-zmena
# upravuj src/BakalariRozvrh.js
npm run build
npm test
```

## Licence

[MIT](LICENSE). Projekt není nijak spojený se společností BAKALÁŘI software s.r.o.
