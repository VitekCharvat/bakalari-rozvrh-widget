// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-alt;

// Bakaláři rozvrh – widget pro Scriptable (iOS)
// Ukazuje dnešní rozvrh (po vyučování zítřejší) s časem, předmětem a učebnou.
// Licence MIT. Přihlašovací údaje zůstávají jen v Klíčence (Keychain) tohoto iPhonu.

const VERZE = "1.1.0"
const KLIC = "bakalari-rozvrh."
const CACHE = "bakalari-rozvrh-cache.json"
const DNY = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"]

// ---------------------------------------------------------------------------
// Čistá logika (bez Scriptable API, testuje se v Node: npm test)
// ---------------------------------------------------------------------------

class ChybaPrihlaseni extends Error {}

// Z adresy vložené z prohlížeče udělá základ pro API, např.
// "bakalari.skola.cz/bakaweb/next/rozvrh.aspx" -> "https://bakalari.skola.cz/bakaweb"
function normalizujUrl(vstup) {
  let url = String(vstup || "").trim()
  if (!url) return ""
  if (!/^https?:\/\//i.test(url)) url = "https://" + url
  url = url.replace(/[?#].*$/, "")
  url = url.replace(/\/(next|login|dashboard|api)(\/.*)?$/i, "")
  url = url.replace(/\/[^/]+\.aspx$/i, "")
  return url.replace(/\/+$/, "")
}

const dvojmistne = n => String(n).padStart(2, "0")

// Date -> "YYYY-MM-DD" v místním čase
function datumKlic(d) {
  return `${d.getFullYear()}-${dvojmistne(d.getMonth() + 1)}-${dvojmistne(d.getDate())}`
}

// ("2026-10-27", "8:05") -> Date v místním čase
function casNaDatum(datum, cas) {
  const [r, m, d] = datum.split("-").map(Number)
  const [h, min] = cas.split(":").map(Number)
  return new Date(r, m - 1, d, h, min)
}

// Pondělí týdne, do kterého datum patří (klíč pro cache)
function pondeliKlic(datum) {
  const d = casNaDatum(datum, "0:00")
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return datumKlic(d)
}

// Bakaláři občas posílají ID s mezerami na okrajích
const id = v => (v == null ? null : String(v).trim())

// Odpověď z /api/3/timetable/actual -> [{ datum, typ, popis, hodiny: [...] }]
function sestavDny(odpoved) {
  const mapa = seznam => {
    const m = {}
    for (const x of seznam || []) m[id(x.Id)] = x
    return m
  }
  const hodiny = mapa(odpoved.Hours)
  const predmety = mapa(odpoved.Subjects)
  const ucebny = mapa(odpoved.Rooms)
  const ucitele = mapa(odpoved.Teachers)

  return (odpoved.Days || []).map(den => {
    const datum = String(den.Date).slice(0, 10)
    const polozky = []
    for (const a of den.Atoms || []) {
      const h = hodiny[id(a.HourId)]
      if (!h) continue
      const predmet = predmety[id(a.SubjectId)]
      const zmena = a.Change
        ? { typ: a.Change.ChangeType || "", popis: (a.Change.Description || "").trim() }
        : null
      if (!predmet && !zmena) continue // prázdná hodina
      const ucebna = ucebny[id(a.RoomId)]
      const ucitel = ucitele[id(a.TeacherId)]
      polozky.push({
        cislo: String(h.Caption).trim(),
        cas: `${h.BeginTime} – ${h.EndTime}`,
        zacatek: casNaDatum(datum, h.BeginTime),
        konec: casNaDatum(datum, h.EndTime),
        predmet: predmet ? (predmet.Abbrev || predmet.Name || "").trim() : "",
        predmetNazev: predmet ? (predmet.Name || predmet.Abbrev || "").trim() : "",
        ucebna: ucebna ? (ucebna.Abbrev || ucebna.Name || "").trim() : "",
        ucitel: ucitel ? (ucitel.Name || ucitel.Abbrev || "").trim() : "",
        tema: (a.Theme || "").trim(),
        zmena,
        // Canceled a Removed = hodina odpadá, ostatní typy jsou suplování nebo přesun
        zrusena: !!zmena && /^(Canceled|Removed)$/i.test(zmena.typ),
      })
    }
    polozky.sort((a, b) => a.zacatek - b.zacatek)
    return {
      datum,
      typ: den.DayType || "",
      popis: (den.DayDescription || "").trim(),
      hodiny: polozky,
    }
  })
}

// Dnešek, pokud ještě neskončila poslední hodina, jinak nejbližší další den s výukou.
// null = v tomhle týdnu už nic není.
function vyberDen(dny, ted) {
  const dnes = datumKlic(ted)
  for (const den of dny) {
    if (den.datum < dnes) continue
    const probehnou = den.hodiny.filter(h => !h.zrusena)
    if (!probehnou.length) continue
    const konec = Math.max(...probehnou.map(h => h.konec.getTime()))
    if (den.datum === dnes && konec <= ted.getTime()) continue
    return den
  }
  return null
}

// Projde až `tydnu` týdnů (kvůli prázdninám), nactiTyden(datum) vrací odpověď API.
async function najdiDen(ted, nactiTyden, tydnu = 4) {
  for (let i = 0; i < tydnu; i++) {
    const d = new Date(ted.getFullYear(), ted.getMonth(), ted.getDate() + 7 * i)
    const den = vyberDen(sestavDny(await nactiTyden(datumKlic(d))), ted)
    if (den) return den
  }
  return null
}

// Hodiny jedné stránky widgetu. U dneška začíná probíhající nebo příští hodinou.
// Stránky se listují v zásobníku widgetů (Smart Stack), číslo stránky je parametr widgetu.
function stranka(den, ted, naStranku, cislo = 1) {
  let hodiny = den.hodiny
  if (den.datum === datumKlic(ted)) hodiny = hodiny.filter(h => h.konec > ted)
  const od = (cislo - 1) * naStranku
  return {
    hodiny: hodiny.slice(od, od + naStranku),
    stranek: Math.max(1, Math.ceil(hodiny.length / naStranku)),
    posledni: od + naStranku >= hodiny.length,
  }
}

const probiha = (h, ted) => h.zacatek <= ted && ted < h.konec

function tvarHodin(n) {
  if (n === 1) return "hodina"
  return n >= 2 && n <= 4 ? "hodiny" : "hodin"
}

// Konec poslední hodiny, která neodpadá
function konecDne(den) {
  const probehnou = den.hodiny.filter(h => !h.zrusena)
  return probehnou.length ? probehnou[probehnou.length - 1].konec : null
}

// Šedý text v hlavičce: „ještě 8 hodin · do 16:45“ nebo „9 hodin · 7:10–16:45“
function shrnutiDne(den, ted) {
  const probehnou = den.hodiny.filter(h => !h.zrusena)
  if (!probehnou.length) return ""
  const konec = casText(konecDne(den))
  if (den.datum === datumKlic(ted)) {
    const zbyva = probehnou.filter(h => h.konec > ted).length
    return `ještě ${zbyva} ${tvarHodin(zbyva)} · do ${konec}`
  }
  return `${probehnou.length} ${tvarHodin(probehnou.length)} · ${casText(probehnou[0].zacatek)}–${konec}`
}

// Stejný předmět má vždycky stejnou barvu, bez ohledu na týden nebo pořadí v rozvrhu
function barvaPredmetu(zkratka, pocetBarev) {
  let hash = 5381
  for (const znak of String(zkratka || "")) hash = (hash * 33 + znak.charCodeAt(0)) >>> 0
  return hash % pocetBarev
}

function popisDne(datum, ted) {
  const d = casNaDatum(datum, "0:00")
  const zitra = new Date(ted.getFullYear(), ted.getMonth(), ted.getDate() + 1)
  const text = `${DNY[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`
  if (datum === datumKlic(ted)) return "Dnes · " + text
  if (datum === datumKlic(zitra)) return "Zítra · " + text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Kdy má iOS widget znovu načíst: nejbližší začátek nebo konec hodiny, nejpozději za hodinu.
function dalsiObnova(den, ted) {
  const zaHodinu = ted.getTime() + 60 * 60 * 1000
  const hranice = (den ? den.hodiny : [])
    .flatMap(h => [h.zacatek.getTime(), h.konec.getTime()])
    .filter(t => t > ted.getTime())
  return new Date(Math.min(zaHodinu, ...hranice))
}

const casText = d => `${d.getHours()}:${dvojmistne(d.getMinutes())}`

// ---------------------------------------------------------------------------
// Scriptable: přihlášení, stahování, cache
// ---------------------------------------------------------------------------

const Ulozene = {
  get: k => (Keychain.contains(KLIC + k) ? Keychain.get(KLIC + k) : null),
  set: (k, v) => Keychain.set(KLIC + k, String(v)),
  smaz: k => {
    if (Keychain.contains(KLIC + k)) Keychain.remove(KLIC + k)
  },
}

async function prihlasit(parametry) {
  const req = new Request(Ulozene.get("url") + "/api/login")
  req.method = "POST"
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" }
  req.body = Object.entries({ client_id: "ANDR", ...parametry })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")
  const text = await req.loadString()
  let odp = {}
  try {
    odp = JSON.parse(text)
  } catch (e) {}
  const stav = req.response.statusCode
  if (stav === 400 || stav === 401) {
    throw new ChybaPrihlaseni(odp.error_description || "Špatné jméno nebo heslo.")
  }
  if (stav !== 200 || !odp.access_token) {
    throw new Error(`Bakaláři odpověděli chybou ${stav}. Zkontroluj adresu školy.`)
  }
  Ulozene.set("access", odp.access_token)
  Ulozene.set("expirace", Date.now() + ((odp.expires_in || 3600) - 60) * 1000)
  if (odp.refresh_token) Ulozene.set("refresh", odp.refresh_token)
  return odp.access_token
}

async function ziskejToken() {
  const token = Ulozene.get("access")
  if (token && Number(Ulozene.get("expirace") || 0) > Date.now()) return token
  const refresh = Ulozene.get("refresh")
  if (refresh) {
    try {
      return await prihlasit({ grant_type: "refresh_token", refresh_token: refresh })
    } catch (e) {
      if (!(e instanceof ChybaPrihlaseni)) throw e
      Ulozene.smaz("refresh")
    }
  }
  const jmeno = Ulozene.get("jmeno")
  const heslo = Ulozene.get("heslo")
  if (!jmeno || !heslo) throw new ChybaPrihlaseni("Nejsi přihlášený.")
  return prihlasit({ grant_type: "password", username: jmeno, password: heslo })
}

async function stahniTyden(datum) {
  for (let pokus = 0; pokus < 2; pokus++) {
    const req = new Request(`${Ulozene.get("url")}/api/3/timetable/actual?date=${datum}`)
    req.headers = { Authorization: "Bearer " + (await ziskejToken()) }
    const text = await req.loadString()
    const stav = req.response.statusCode
    if (stav === 401) {
      Ulozene.smaz("access") // token vypršel dřív, než jsme čekali
      continue
    }
    if (stav !== 200) throw new Error(`Rozvrh se nepodařilo načíst (chyba ${stav}).`)
    return JSON.parse(text)
  }
  throw new ChybaPrihlaseni("Přihlášení vypršelo.")
}

function cestaCache() {
  const fm = FileManager.local()
  return fm.joinPath(fm.documentsDirectory(), CACHE)
}

function nactiCache() {
  try {
    return JSON.parse(FileManager.local().readString(cestaCache())) || {}
  } catch (e) {
    return {}
  }
}

function ulozDoCache(datum, data, ted) {
  const cache = nactiCache()
  cache[pondeliKlic(datum)] = { ulozeno: ted.toISOString(), data }
  const stare = pondeliKlic(datumKlic(new Date(ted.getTime() - 7 * 86400000)))
  for (const k of Object.keys(cache)) if (k < stare) delete cache[k]
  FileManager.local().writeString(cestaCache(), JSON.stringify(cache))
}

// Online, a když to nejde, z cache. `info` sbírá, odkud data jsou (pro hlavičku widgetu).
async function nactiTyden(datum, info, ted) {
  try {
    const data = await stahniTyden(datum)
    ulozDoCache(datum, data, ted)
    if (!info.aktualizace) info.aktualizace = ted
    return data
  } catch (e) {
    const zCache = nactiCache()[pondeliKlic(datum)]
    if (!zCache) throw e
    info.problem = e instanceof ChybaPrihlaseni ? "přihlas se" : "offline"
    const ulozeno = new Date(zCache.ulozeno)
    if (!info.aktualizace || ulozeno < info.aktualizace) info.aktualizace = ulozeno
    return zCache.data
  }
}

async function nactiStav(ted) {
  if (!Ulozene.get("url")) {
    return { chyba: "Otevři skript ve Scriptable a přihlas se do Bakalářů." }
  }
  const info = { aktualizace: null, problem: null }
  try {
    const den = await najdiDen(ted, d => nactiTyden(d, info, ted))
    if (!den) return { chyba: "V příštích 4 týdnech žádná výuka. Užij si volno!" }
    return { den, info }
  } catch (e) {
    if (e instanceof ChybaPrihlaseni) {
      return { chyba: "Přihlášení nevyšlo. Otevři skript ve Scriptable a přihlas se znovu." }
    }
    return { chyba: "Rozvrh se nepodařilo načíst a v paměti nic není. Zkus to později." }
  }
}

// ---------------------------------------------------------------------------
// Scriptable: vzhled
// ---------------------------------------------------------------------------

const MOTIVY = { auto: "Automaticky", tmavy: "Tmavý", svetly: "Světlý" }

// Barvy předmětů: [světlý režim, tmavý režim]. Oranžová chybí schválně, patří změnám v rozvrhu.
const PALETA = [
  ["#0A66D8", "#64B5FF"],
  ["#1E7F45", "#5BD68A"],
  ["#7B3FC4", "#C792FF"],
  ["#C2255C", "#FF7AA8"],
  ["#0B7A8C", "#4FD1E0"],
  ["#8A5A00", "#FFD54F"],
  ["#4A4FD1", "#8C9EFF"],
  ["#0F7A5C", "#7EE0C3"],
]

// "auto" se řídí tmavým režimem iPhonu, "tmavy" a "svetly" ho přebijí
function barvy(motiv = "auto") {
  const vyber = (svetla, tmava, alfaSvetla = 1, alfaTmava = alfaSvetla) => {
    if (motiv === "svetly") return new Color(svetla, alfaSvetla)
    if (motiv === "tmavy") return new Color(tmava, alfaTmava)
    return Color.dynamic(new Color(svetla, alfaSvetla), new Color(tmava, alfaTmava))
  }
  const stitek = (svetla, tmava) => ({ text: vyber(svetla, tmava), pozadi: vyber(svetla, tmava, 0.12, 0.18) })
  return {
    pozadi: vyber("#FFFFFF", "#1C1C1E"),
    text: vyber("#111114", "#F2F2F7"),
    tlumeny: vyber("#6E6E73", "#98989F"),
    akcent: vyber("#0A66D8", "#64B5FF"),
    zmena: vyber("#B35C00", "#FFB340"),
    zvyrazneni: vyber("#000000", "#FFFFFF", 0.05, 0.08),
    teckaNeaktivni: vyber("#D1D1D6", "#48484A"),
    stitekZmena: stitek("#B35C00", "#FFB340"),
    stitekPredmetu: zkratka => stitek(...PALETA[barvaPredmetu(zkratka, PALETA.length)]),
  }
}

const zvolenyMotiv = () => (MOTIVY[Ulozene.get("motiv")] ? Ulozene.get("motiv") : "auto")

function pridejText(kam, text, font, barva, zmenseni) {
  const t = kam.addText(text)
  t.font = font
  t.textColor = barva
  t.lineLimit = 1
  if (zmenseni) t.minimumScaleFactor = zmenseni
  return t
}

// Tečky v hlavičce ukazují, na které stránce zásobníku widgetů jsi
function pridejTecky(kam, pocet, aktivni, B) {
  const tecky = kam.addStack()
  tecky.centerAlignContent()
  tecky.spacing = 4
  for (let i = 1; i <= pocet; i++) {
    const t = tecky.addStack()
    t.size = new Size(5, 5)
    t.cornerRadius = 2.5
    t.backgroundColor = i === aktivni ? B.text : B.teckaNeaktivni
  }
}

// Rozložení podle velikosti widgetu: kolik sloupců a hodin v jednom sloupci
function rozlozeni(rodina) {
  if (rodina === "small") return { sloupcu: 1, naSloupec: 3 }
  if (rodina === "large") return { sloupcu: 2, naSloupec: 7 }
  return { sloupcu: 2, naSloupec: 3 }
}

// Spacer na konci řádku roztáhne blok na celou šířku sloupce. Sloupce jsou tím pádem
// pružné a dělí si šířku widgetu napůl, ať je telefon jakkoli velký.
function pridejHodinu(sloupec, h, ted, B) {
  const blok = sloupec.addStack()
  blok.layoutVertically()
  blok.setPadding(2, 6, 2, 6)
  blok.cornerRadius = 8
  const prave = probiha(h, ted)
  if (prave) blok.backgroundColor = B.zvyrazneni

  const horni = blok.addStack()
  horni.centerAlignContent()
  pridejText(horni, h.cas, Font.regularMonospacedSystemFont(10), B.tlumeny)
  if (prave) {
    pridejText(horni, " · zbývá ", Font.semiboldSystemFont(10), B.akcent)
    // Odpočet běží živě, nečeká na to, až iOS widget obnoví
    const odpocet = horni.addDate(h.konec)
    odpocet.applyTimerStyle()
    odpocet.font = Font.semiboldMonospacedSystemFont(10)
    odpocet.textColor = B.akcent
    odpocet.lineLimit = 1
    odpocet.leftAlignText()
  } else if (h.zmena && !h.zrusena) {
    const druh = /Subst/i.test(h.zmena.typ) ? " · supl." : " · změna"
    pridejText(horni, druh, Font.semiboldSystemFont(10), B.zmena)
  }
  horni.addSpacer()

  const radek = blok.addStack()
  radek.centerAlignContent()
  const barvaPredmetu = h.zrusena ? B.tlumeny : h.zmena ? B.zmena : B.text
  pridejText(radek, h.predmet || "—", Font.boldSystemFont(15), barvaPredmetu, 0.7)
  radek.addSpacer()

  const stitek = radek.addStack()
  stitek.setPadding(1, 6, 1, 6)
  stitek.cornerRadius = 5
  const barva = h.zmena ? B.stitekZmena : B.stitekPredmetu(h.predmet)
  stitek.backgroundColor = barva.pozadi
  const fontStitku = h.zrusena ? Font.semiboldSystemFont(11) : Font.boldSystemFont(13)
  pridejText(stitek, h.zrusena ? "odpadá" : h.ucebna || "—", fontStitku, barva.text, 0.7)
}

function vytvorWidget(stav, ted, cisloStranky = 1) {
  const B = barvy(zvolenyMotiv())
  const rodina = config.widgetFamily || "medium"
  const w = new ListWidget()
  w.backgroundColor = B.pozadi
  w.setPadding(10, 14, 10, 14)
  w.url = URLScheme.forRunningScript() + "?zobraz=den"

  if (stav.chyba) {
    const t = w.addText(stav.chyba)
    t.font = Font.mediumSystemFont(13)
    t.textColor = B.tlumeny
    w.refreshAfterDate = new Date(ted.getTime() + 30 * 60 * 1000)
    return w
  }

  const { den, info } = stav
  const { sloupcu, naSloupec } = rozlozeni(rodina)
  const naStranku = sloupcu * naSloupec
  const st = stranka(den, ted, naStranku, cisloStranky)

  const hlava = w.addStack()
  hlava.centerAlignContent()
  pridejText(hlava, popisDne(den.datum, ted), Font.semiboldSystemFont(13), B.text)
  hlava.addSpacer(6)
  const shrnuti = info.problem ? `${info.problem} · ${casText(info.aktualizace)}` : shrnutiDne(den, ted)
  pridejText(hlava, shrnuti, Font.regularSystemFont(11), info.problem ? B.zmena : B.tlumeny, 0.8)
  hlava.addSpacer()
  const stranek = Math.max(st.stranek, cisloStranky)
  if (stranek > 1) pridejTecky(hlava, stranek, cisloStranky, B)
  w.addSpacer(6)

  // Poslední stránka s volným místem dostane řádek o konci vyučování
  const konec = casText(konecDne(den))
  const zaver =
    st.posledni && st.hodiny.length < naStranku
      ? den.datum === datumKlic(ted)
        ? `To je pro dnešek vše. Konec v ${konec}.`
        : `Konec v ${konec}.`
      : null
  // Do tří položek stačí jeden široký sloupec
  const pocetSloupcu = st.hodiny.length + (zaver ? 1 : 0) > naSloupec ? sloupcu : 1

  const radek = w.addStack()
  radek.topAlignContent()
  const sloupce = []
  for (let i = 0; i < pocetSloupcu; i++) {
    if (i > 0) radek.addSpacer(10)
    const s = radek.addStack()
    s.layoutVertically()
    s.spacing = 3
    sloupce.push(s)
  }
  const sloupecPro = i => sloupce[Math.min(Math.floor(i / naSloupec), pocetSloupcu - 1)]
  st.hodiny.forEach((h, i) => pridejHodinu(sloupecPro(i), h, ted, B))
  if (zaver) {
    const z = sloupecPro(st.hodiny.length).addStack()
    z.setPadding(6, 6, 2, 6)
    pridejText(z, zaver, Font.regularSystemFont(11), B.tlumeny, 0.8)
    z.addSpacer()
  }
  w.addSpacer()
  w.refreshAfterDate = dalsiObnova(den, ted)
  return w
}

async function ukazRozvrh(ted) {
  const stav = await nactiStav(ted)
  if (stav.chyba) return upozorneni("Rozvrh", stav.chyba)
  const { den } = stav
  // Tabulka má vždycky barvy systému, s vynuceným motivem by byl text na pozadí neviditelný
  const B = barvy("auto")
  const tabulka = new UITable()
  tabulka.showSeparators = true

  const hlava = new UITableRow()
  hlava.isHeader = true
  hlava.height = 50
  hlava.addText(popisDne(den.datum, ted)).titleFont = Font.boldSystemFont(20)
  tabulka.addRow(hlava)

  for (const h of den.hodiny) {
    const r = new UITableRow()
    r.height = 64
    if (probiha(h, ted)) r.backgroundColor = B.zvyrazneni
    const kdy = r.addText(`${h.cislo}. hod`, h.cas)
    kdy.widthWeight = 34
    kdy.subtitleColor = B.tlumeny
    kdy.subtitleFont = Font.regularMonospacedSystemFont(12) // aby se „12:40 – 13:25“ nezalomilo
    const podrobnosti = [h.ucitel, h.zmena && h.zmena.popis ? h.zmena.popis : h.tema]
    const co = r.addText(h.predmetNazev || h.predmet || "—", podrobnosti.filter(Boolean).join(" · "))
    co.widthWeight = 48
    co.titleColor = h.zrusena ? B.tlumeny : h.zmena ? B.zmena : B.text
    co.subtitleColor = B.tlumeny
    const kde = r.addText(h.zrusena ? "odpadá" : h.ucebna)
    kde.widthWeight = 18
    kde.rightAligned()
    kde.titleFont = Font.boldSystemFont(17)
    kde.titleColor = h.zrusena || h.zmena ? B.zmena : B.akcent
    tabulka.addRow(r)
  }
  await tabulka.present()
}

async function upozorneni(titulek, zprava) {
  const a = new Alert()
  a.title = titulek
  a.message = zprava
  a.addAction("OK")
  await a.present()
}

async function prihlasovaciDialog() {
  const a = new Alert()
  a.title = "Přihlášení do Bakalářů"
  a.message =
    "Adresu školy zkopíruj z prohlížeče, když jsi přihlášený do webových Bakalářů " +
    "(např. https://bakalari.skola.cz/bakaweb). Jméno a heslo zůstanou jen v Klíčence tohoto iPhonu."
  a.addTextField("adresa školy", Ulozene.get("url") || "")
  a.addTextField("uživatelské jméno", Ulozene.get("jmeno") || "")
  a.addSecureTextField("heslo", "")
  a.addAction("Přihlásit")
  a.addCancelAction("Zrušit")
  if ((await a.present()) === -1) return false

  const url = normalizujUrl(a.textFieldValue(0))
  const jmeno = a.textFieldValue(1).trim()
  const heslo = a.textFieldValue(2)
  if (!url || !jmeno || !heslo) {
    await upozorneni("Chybí údaje", "Vyplň adresu školy, jméno i heslo.")
    return prihlasovaciDialog()
  }
  odhlasit()
  Ulozene.set("url", url)
  Ulozene.set("jmeno", jmeno)
  Ulozene.set("heslo", heslo)
  try {
    await ziskejToken()
    return true
  } catch (e) {
    await upozorneni("Přihlášení nevyšlo", e.message || "Zkontroluj adresu školy a připojení.")
    return prihlasovaciDialog()
  }
}

function odhlasit() {
  for (const k of ["url", "jmeno", "heslo", "access", "expirace", "refresh"]) Ulozene.smaz(k)
  const fm = FileManager.local()
  if (fm.fileExists(cestaCache())) fm.remove(cestaCache())
}

async function menu(ted) {
  const a = new Alert()
  a.title = "Bakaláři rozvrh"
  a.message = `Přihlášen: ${Ulozene.get("jmeno")}\n${Ulozene.get("url")}\nVerze ${VERZE}`
  a.addAction("Zobrazit rozvrh")
  a.addAction("Náhled widgetu")
  a.addAction(`Vzhled: ${MOTIVY[zvolenyMotiv()]}`)
  a.addDestructiveAction("Odhlásit / změnit školu")
  a.addCancelAction("Zavřít")
  const volba = await a.present()
  if (volba === 0) await ukazRozvrh(ted)
  if (volba === 1) await vytvorWidget(await nactiStav(ted), ted).presentMedium()
  if (volba === 2) await vyberMotiv()
  if (volba === 3) {
    odhlasit()
    await prihlasovaciDialog()
  }
}

async function vyberMotiv() {
  const a = new Alert()
  a.title = "Vzhled widgetu"
  a.message = "Automaticky se řídí tmavým režimem iPhonu. Na ploše se změna projeví při další obnově widgetu."
  const klice = Object.keys(MOTIVY)
  for (const k of klice) a.addAction(MOTIVY[k] + (k === zvolenyMotiv() ? " ✓" : ""))
  a.addCancelAction("Zrušit")
  const volba = await a.present()
  if (volba >= 0) Ulozene.set("motiv", klice[volba])
}

async function main() {
  const ted = new Date()
  if (config.runsInWidget) {
    // Parametr widgetu = číslo stránky (1, 2…) pro listování v zásobníku widgetů
    const cislo = Math.max(1, parseInt(args.widgetParameter, 10) || 1)
    Script.setWidget(vytvorWidget(await nactiStav(ted), ted, cislo))
    return
  }
  if (!Ulozene.get("url") && !(await prihlasovaciDialog())) return
  const parametry = args.queryParameters || {}
  if (parametry.zobraz === "den") await ukazRozvrh(ted)
  else await menu(ted)
}

if (typeof Script !== "undefined") {
  main()
    .catch(async e => {
      if (config.runsInWidget) Script.setWidget(vytvorWidget({ chyba: e.message }, new Date()))
      else await upozorneni("Chyba", e.message)
    })
    .finally(() => Script.complete())
}

if (typeof module !== "undefined") {
  module.exports = {
    normalizujUrl,
    datumKlic,
    casNaDatum,
    pondeliKlic,
    sestavDny,
    vyberDen,
    najdiDen,
    stranka,
    probiha,
    tvarHodin,
    konecDne,
    shrnutiDne,
    barvaPredmetu,
    popisDne,
    dalsiObnova,
  }
}
