// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-alt;

// VYGENEROVANO z src/BakalariRozvrh.js (npm run build). Upravuj zdroj, ne tenhle soubor.

// Bakalari rozvrh \u2013 widget pro Scriptable (iOS)
// Ukazuje dnesni rozvrh (po vyucovani zitrejsi) s casem, predmetem a ucebnou.
// Licence MIT. Prihlasovaci udaje zustavaji jen v Klicence (Keychain) tohoto iPhonu.

const VERZE = "1.0.1"
const KLIC = "bakalari-rozvrh."
const CACHE = "bakalari-rozvrh-cache.json"
const DNY = ["ned\u011ble", "pond\u011bl\u00ed", "\u00fater\u00fd", "st\u0159eda", "\u010dtvrtek", "p\u00e1tek", "sobota"]

// ---------------------------------------------------------------------------
// Cista logika (bez Scriptable API, testuje se v Node: npm test)
// ---------------------------------------------------------------------------

class ChybaPrihlaseni extends Error {}

// Z adresy vlozene z prohlizece udela zaklad pro API, napr.
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

// Date -> "YYYY-MM-DD" v mistnim case
function datumKlic(d) {
  return `${d.getFullYear()}-${dvojmistne(d.getMonth() + 1)}-${dvojmistne(d.getDate())}`
}

// ("2026-10-27", "8:05") -> Date v mistnim case
function casNaDatum(datum, cas) {
  const [r, m, d] = datum.split("-").map(Number)
  const [h, min] = cas.split(":").map(Number)
  return new Date(r, m - 1, d, h, min)
}

// Pondeli tydne, do ktereho datum patri (klic pro cache)
function pondeliKlic(datum) {
  const d = casNaDatum(datum, "0:00")
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return datumKlic(d)
}

// Bakalari obcas posilaji ID s mezerami na okrajich
const id = v => (v == null ? null : String(v).trim())

// Odpoved z /api/3/timetable/actual -> [{ datum, typ, popis, hodiny: [...] }]
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
      if (!predmet && !zmena) continue // pr\u00e1zdn\u00e1 hodina
      const ucebna = ucebny[id(a.RoomId)]
      const ucitel = ucitele[id(a.TeacherId)]
      polozky.push({
        cislo: String(h.Caption).trim(),
        cas: `${h.BeginTime} \u2013 ${h.EndTime}`,
        zacatek: casNaDatum(datum, h.BeginTime),
        konec: casNaDatum(datum, h.EndTime),
        predmet: predmet ? (predmet.Abbrev || predmet.Name || "").trim() : "",
        predmetNazev: predmet ? (predmet.Name || predmet.Abbrev || "").trim() : "",
        ucebna: ucebna ? (ucebna.Abbrev || ucebna.Name || "").trim() : "",
        ucitel: ucitel ? (ucitel.Name || ucitel.Abbrev || "").trim() : "",
        tema: (a.Theme || "").trim(),
        zmena,
        // Canceled a Removed = hodina odpada, ostatni typy jsou suplovani nebo presun
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

// Dnesek, pokud jeste neskoncila posledni hodina, jinak nejblizsi dalsi den s vyukou.
// null = v tomhle tydnu uz nic neni.
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

// Projde az `tydnu` tydnu (kvuli prazdninam), nactiTyden(datum) vraci odpoved API.
async function najdiDen(ted, nactiTyden, tydnu = 4) {
  for (let i = 0; i < tydnu; i++) {
    const d = new Date(ted.getFullYear(), ted.getMonth(), ted.getDate() + 7 * i)
    const den = vyberDen(sestavDny(await nactiTyden(datumKlic(d))), ted)
    if (den) return den
  }
  return null
}

// Hodiny, ktere se vejdou do widgetu. U dneska zacina probihajici nebo pristi hodinou.
// Kdyz se nevejdou vsechny, posledni misto zabere \u201e+N dalsi\u201c.
function oknoOd(den, ted, max) {
  let hodiny = den.hodiny
  if (den.datum === datumKlic(ted)) hodiny = hodiny.filter(h => h.konec > ted)
  if (hodiny.length <= max) return { hodiny, dalsi: 0 }
  return { hodiny: hodiny.slice(0, max - 1), dalsi: hodiny.length - (max - 1) }
}

const probiha = (h, ted) => h.zacatek <= ted && ted < h.konec

function popisDne(datum, ted) {
  const d = casNaDatum(datum, "0:00")
  const zitra = new Date(ted.getFullYear(), ted.getMonth(), ted.getDate() + 1)
  const text = `${DNY[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`
  if (datum === datumKlic(ted)) return "Dnes \u00b7 " + text
  if (datum === datumKlic(zitra)) return "Z\u00edtra \u00b7 " + text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Kdy ma iOS widget znovu nacist: nejblizsi zacatek nebo konec hodiny, nejpozdeji za hodinu.
function dalsiObnova(den, ted) {
  const zaHodinu = ted.getTime() + 60 * 60 * 1000
  const hranice = (den ? den.hodiny : [])
    .flatMap(h => [h.zacatek.getTime(), h.konec.getTime()])
    .filter(t => t > ted.getTime())
  return new Date(Math.min(zaHodinu, ...hranice))
}

const casText = d => `${d.getHours()}:${dvojmistne(d.getMinutes())}`

// ---------------------------------------------------------------------------
// Scriptable: prihlaseni, stahovani, cache
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
    throw new ChybaPrihlaseni(odp.error_description || "\u0160patn\u00e9 jm\u00e9no nebo heslo.")
  }
  if (stav !== 200 || !odp.access_token) {
    throw new Error(`Bakal\u00e1\u0159i odpov\u011bd\u011bli chybou ${stav}. Zkontroluj adresu \u0161koly.`)
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
  if (!jmeno || !heslo) throw new ChybaPrihlaseni("Nejsi p\u0159ihl\u00e1\u0161en\u00fd.")
  return prihlasit({ grant_type: "password", username: jmeno, password: heslo })
}

async function stahniTyden(datum) {
  for (let pokus = 0; pokus < 2; pokus++) {
    const req = new Request(`${Ulozene.get("url")}/api/3/timetable/actual?date=${datum}`)
    req.headers = { Authorization: "Bearer " + (await ziskejToken()) }
    const text = await req.loadString()
    const stav = req.response.statusCode
    if (stav === 401) {
      Ulozene.smaz("access") // token vypr\u0161el d\u0159\u00edv, ne\u017e jsme \u010dekali
      continue
    }
    if (stav !== 200) throw new Error(`Rozvrh se nepoda\u0159ilo na\u010d\u00edst (chyba ${stav}).`)
    return JSON.parse(text)
  }
  throw new ChybaPrihlaseni("P\u0159ihl\u00e1\u0161en\u00ed vypr\u0161elo.")
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

// Online, a kdyz to nejde, z cache. `info` sbira, odkud data jsou (pro hlavicku widgetu).
async function nactiTyden(datum, info, ted) {
  try {
    const data = await stahniTyden(datum)
    ulozDoCache(datum, data, ted)
    if (!info.aktualizace) info.aktualizace = ted
    return data
  } catch (e) {
    const zCache = nactiCache()[pondeliKlic(datum)]
    if (!zCache) throw e
    info.problem = e instanceof ChybaPrihlaseni ? "p\u0159ihlas se" : "offline"
    const ulozeno = new Date(zCache.ulozeno)
    if (!info.aktualizace || ulozeno < info.aktualizace) info.aktualizace = ulozeno
    return zCache.data
  }
}

async function nactiStav(ted) {
  if (!Ulozene.get("url")) {
    return { chyba: "Otev\u0159i skript ve Scriptable a p\u0159ihlas se do Bakal\u00e1\u0159\u016f." }
  }
  const info = { aktualizace: null, problem: null }
  try {
    const den = await najdiDen(ted, d => nactiTyden(d, info, ted))
    if (!den) return { chyba: "V p\u0159\u00ed\u0161t\u00edch 4 t\u00fddnech \u017e\u00e1dn\u00e1 v\u00fduka. U\u017eij si volno!" }
    return { den, info }
  } catch (e) {
    if (e instanceof ChybaPrihlaseni) {
      return { chyba: "P\u0159ihl\u00e1\u0161en\u00ed nevy\u0161lo. Otev\u0159i skript ve Scriptable a p\u0159ihlas se znovu." }
    }
    return { chyba: "Rozvrh se nepoda\u0159ilo na\u010d\u00edst a v pam\u011bti nic nen\u00ed. Zkus to pozd\u011bji." }
  }
}

// ---------------------------------------------------------------------------
// Scriptable: vzhled
// ---------------------------------------------------------------------------

function barvy() {
  const dyn = (svetla, tmava) => Color.dynamic(new Color(svetla), new Color(tmava))
  return {
    pozadi: dyn("#FFFFFF", "#1C1C1E"),
    text: dyn("#111114", "#F2F2F7"),
    tlumeny: dyn("#6E6E73", "#98989F"),
    akcent: dyn("#0A66D8", "#4EA1FF"),
    zmena: dyn("#C25E00", "#FF9F0A"),
    zvyrazneni: Color.dynamic(new Color("#0A66D8", 0.1), new Color("#4EA1FF", 0.2)),
  }
}

// Rozlozeni podle velikosti widgetu: kolik sloupcu a hodin v jednom sloupci
function rozlozeni(rodina) {
  if (rodina === "small") return { sloupcu: 1, naSloupec: 3 }
  if (rodina === "large") return { sloupcu: 2, naSloupec: 7 }
  return { sloupcu: 2, naSloupec: 3 }
}

// Spacer na konci radku roztahne blok na celou sirku sloupce. Sloupce jsou tim padem
// pruzne a deli si sirku widgetu napul, at je telefon jakkoli velky.
function pridejHodinu(sloupec, h, ted, B) {
  const blok = sloupec.addStack()
  blok.layoutVertically()
  blok.setPadding(2, 6, 2, 6)
  blok.cornerRadius = 6
  if (probiha(h, ted)) blok.backgroundColor = B.zvyrazneni

  const horni = blok.addStack()
  const cas = horni.addText(h.cas)
  cas.font = Font.regularMonospacedSystemFont(10)
  cas.textColor = B.tlumeny
  cas.lineLimit = 1
  horni.addSpacer()

  const radek = blok.addStack()
  radek.centerAlignContent()
  const barva = h.zrusena ? B.tlumeny : h.zmena ? B.zmena : B.text

  const predmet = radek.addText(h.predmet || "\u2014")
  predmet.font = Font.semiboldSystemFont(15)
  predmet.textColor = barva
  predmet.lineLimit = 1
  predmet.minimumScaleFactor = 0.7
  radek.addSpacer()

  const ucebna = radek.addText(h.zrusena ? "odpad\u00e1" : h.ucebna)
  ucebna.font = h.zrusena ? Font.mediumSystemFont(11) : Font.boldSystemFont(15)
  ucebna.textColor = h.zrusena ? B.zmena : h.zmena ? B.zmena : B.akcent
  ucebna.lineLimit = 1
  ucebna.minimumScaleFactor = 0.7
}

function vytvorWidget(stav, ted) {
  const B = barvy()
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
  const hlava = w.addStack()
  hlava.centerAlignContent()
  const nadpis = hlava.addText(popisDne(den.datum, ted))
  nadpis.font = Font.semiboldSystemFont(13)
  nadpis.textColor = B.akcent
  nadpis.lineLimit = 1
  hlava.addSpacer()
  if (info.aktualizace) {
    const kdy = casText(info.aktualizace)
    const t = hlava.addText(info.problem ? `${info.problem} \u00b7 ${kdy}` : kdy)
    t.font = Font.regularSystemFont(10)
    t.textColor = info.problem ? B.zmena : B.tlumeny
  }
  w.addSpacer(6)

  const { sloupcu, naSloupec } = rozlozeni(rodina)
  const okno = oknoOd(den, ted, sloupcu * naSloupec)
  // Do tri hodin staci jeden siroky sloupec
  const pocetSloupcu = okno.hodiny.length + (okno.dalsi ? 1 : 0) > naSloupec ? sloupcu : 1

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
  okno.hodiny.forEach((h, i) => {
    pridejHodinu(sloupce[Math.min(Math.floor(i / naSloupec), pocetSloupcu - 1)], h, ted, B)
  })
  if (okno.dalsi) {
    const dalsi = sloupce[pocetSloupcu - 1].addStack()
    dalsi.setPadding(4, 6, 0, 6)
    const t = dalsi.addText(`+${okno.dalsi} dal\u0161\u00ed \u203a`)
    t.font = Font.mediumSystemFont(11)
    t.textColor = B.tlumeny
    dalsi.addSpacer()
  }
  w.addSpacer()
  w.refreshAfterDate = dalsiObnova(den, ted)
  return w
}

async function ukazRozvrh(ted) {
  const stav = await nactiStav(ted)
  if (stav.chyba) return upozorneni("Rozvrh", stav.chyba)
  const { den } = stav
  const B = barvy()
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
    kdy.subtitleFont = Font.regularMonospacedSystemFont(12) // aby se \u201e12:40 \u2013 13:25\u201c nezalomilo
    const podrobnosti = [h.ucitel, h.zmena && h.zmena.popis ? h.zmena.popis : h.tema]
    const co = r.addText(h.predmetNazev || h.predmet || "\u2014", podrobnosti.filter(Boolean).join(" \u00b7 "))
    co.widthWeight = 48
    co.titleColor = h.zrusena ? B.tlumeny : h.zmena ? B.zmena : B.text
    co.subtitleColor = B.tlumeny
    const kde = r.addText(h.zrusena ? "odpad\u00e1" : h.ucebna)
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
  a.title = "P\u0159ihl\u00e1\u0161en\u00ed do Bakal\u00e1\u0159\u016f"
  a.message =
    "Adresu \u0161koly zkop\u00edruj z prohl\u00ed\u017ee\u010de, kdy\u017e jsi p\u0159ihl\u00e1\u0161en\u00fd do webov\u00fdch Bakal\u00e1\u0159\u016f " +
    "(nap\u0159. https://bakalari.skola.cz/bakaweb). Jm\u00e9no a heslo z\u016fstanou jen v Kl\u00ed\u010dence tohoto iPhonu."
  a.addTextField("adresa \u0161koly", Ulozene.get("url") || "")
  a.addTextField("u\u017eivatelsk\u00e9 jm\u00e9no", Ulozene.get("jmeno") || "")
  a.addSecureTextField("heslo", "")
  a.addAction("P\u0159ihl\u00e1sit")
  a.addCancelAction("Zru\u0161it")
  if ((await a.present()) === -1) return false

  const url = normalizujUrl(a.textFieldValue(0))
  const jmeno = a.textFieldValue(1).trim()
  const heslo = a.textFieldValue(2)
  if (!url || !jmeno || !heslo) {
    await upozorneni("Chyb\u00ed \u00fadaje", "Vypl\u0148 adresu \u0161koly, jm\u00e9no i heslo.")
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
    await upozorneni("P\u0159ihl\u00e1\u0161en\u00ed nevy\u0161lo", e.message || "Zkontroluj adresu \u0161koly a p\u0159ipojen\u00ed.")
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
  a.title = "Bakal\u00e1\u0159i rozvrh"
  a.message = `P\u0159ihl\u00e1\u0161en: ${Ulozene.get("jmeno")}\n${Ulozene.get("url")}\nVerze ${VERZE}`
  a.addAction("Zobrazit rozvrh")
  a.addAction("N\u00e1hled widgetu")
  a.addDestructiveAction("Odhl\u00e1sit / zm\u011bnit \u0161kolu")
  a.addCancelAction("Zav\u0159\u00edt")
  const volba = await a.present()
  if (volba === 0) await ukazRozvrh(ted)
  if (volba === 1) await vytvorWidget(await nactiStav(ted), ted).presentMedium()
  if (volba === 2) {
    odhlasit()
    await prihlasovaciDialog()
  }
}

async function main() {
  const ted = new Date()
  if (config.runsInWidget) {
    Script.setWidget(vytvorWidget(await nactiStav(ted), ted))
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
    oknoOd,
    probiha,
    popisDne,
    dalsiObnova,
  }
}
