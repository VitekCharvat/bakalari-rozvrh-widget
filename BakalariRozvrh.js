// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-alt;

// VYGENEROVANO z src/BakalariRozvrh.js (npm run build). Upravuj zdroj, ne tenhle soubor.

// Bakalari rozvrh \u2013 widget pro Scriptable (iOS)
// Ukazuje dnesni rozvrh (po vyucovani zitrejsi) s casem, predmetem a ucebnou.
// Licence MIT. Prihlasovaci udaje zustavaji jen v Klicence (Keychain) tohoto iPhonu.
// Nova verze a navod: https://github.com/VitekCharvat/bakalari-rozvrh-widget

const VERZE = "1.2.1"
const KLIC = "bakalari-rozvrh."
const CACHE = "bakalari-rozvrh-cache.json"
const DENIK = "bakalari-rozvrh-denik.json"
const OZNAMENO = "bakalari-rozvrh-oznameno.json"
// Widget stahuje nejvys jednou za tuto dobu, jinak bere ulozena data
const CERSTVA_PAMET_MIN = 15
// Na kolik dni dopredu se hlidaji zmeny v rozvrhu
const HLIDAT_DNU = 7
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
  const nazevUcebny = u => (u ? (u.Abbrev || u.Name || "").trim() : "")

  // Kazda ucebna ma svou barvu. Poradi podle toho, jak casto se v ni v tydnu uci,
  // takze kmenova trida dostane vzdycky prvni barvu (modrou).
  const pocty = {}
  for (const den of odpoved.Days || []) {
    for (const a of den.Atoms || []) {
      const nazev = nazevUcebny(ucebny[id(a.RoomId)])
      if (nazev) pocty[nazev] = (pocty[nazev] || 0) + 1
    }
  }
  const poradiUceben = {}
  Object.keys(pocty)
    .sort((a, b) => pocty[b] - pocty[a] || (a < b ? -1 : a > b ? 1 : 0))
    .forEach((nazev, i) => (poradiUceben[nazev] = i))

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
      const ucebna = nazevUcebny(ucebny[id(a.RoomId)])
      const ucitel = ucitele[id(a.TeacherId)]
      polozky.push({
        cislo: String(h.Caption).trim(),
        cas: `${h.BeginTime} \u2013 ${h.EndTime}`,
        zacatek: casNaDatum(datum, h.BeginTime),
        konec: casNaDatum(datum, h.EndTime),
        predmet: predmet ? (predmet.Abbrev || predmet.Name || "").trim() : "",
        predmetNazev: predmet ? (predmet.Name || predmet.Abbrev || "").trim() : "",
        ucebna,
        barvaUcebny: ucebna in poradiUceben ? poradiUceben[ucebna] : null,
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

// Hodiny jedne stranky widgetu. U dneska zacina probihajici nebo pristi hodinou.
// Stranky se listuji v zasobniku widgetu (Smart Stack), cislo stranky je parametr widgetu.
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

// Konec posledni hodiny, ktera neodpada
function konecDne(den) {
  const probehnou = den.hodiny.filter(h => !h.zrusena)
  return probehnou.length ? probehnou[probehnou.length - 1].konec : null
}

// Sedy text v hlavicce: \u201ejeste 8 hodin \u00b7 do 16:45\u201c nebo \u201e9 hodin \u00b7 7:10\u201316:45\u201c
function shrnutiDne(den, ted) {
  const probehnou = den.hodiny.filter(h => !h.zrusena)
  if (!probehnou.length) return ""
  const konec = casText(konecDne(den))
  if (den.datum === datumKlic(ted)) {
    const zbyva = probehnou.filter(h => h.konec > ted).length
    return `je\u0161t\u011b ${zbyva} ${tvarHodin(zbyva)} \u00b7 do ${konec}`
  }
  return `${probehnou.length} ${tvarHodin(probehnou.length)} \u00b7 ${casText(probehnou[0].zacatek)}\u2013${konec}`
}


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

// Ulozena data mladsi nez CERSTVA_PAMET_MIN se znovu nestahuji
function cerstvaPamet(ulozeno, ted) {
  const vek = ted.getTime() - new Date(ulozeno).getTime()
  return vek >= 0 && vek < CERSTVA_PAMET_MIN * 60 * 1000
}

// Odkud jsou data ve widgetu, pro denik obnov
function popisZdroje(stav) {
  if (stav.chyba) return "chyba"
  if (stav.info.problem) return stav.info.problem
  return stav.info.stazene.length ? "sta\u017eeno" : "z pam\u011bti"
}

// Radek Diagnostiky: \u201e29. 10. 13:45 \u00b7 1,2 s \u00b7 stazeno\u201c
function radekDeniku(z) {
  const d = new Date(z.start)
  const kdy = `${d.getDate()}. ${d.getMonth() + 1}. ${casText(d)}`
  if (!z.hotovo) return `${kdy} \u00b7 nedob\u011bhl`
  const casti = [kdy, `${(z.ms / 1000).toFixed(1).replace(".", ",")} s`, z.zdroj]
  if (z.chyba) casti.push(z.chyba)
  return casti.join(" \u00b7 ")
}

// V noci se upozorneni neposilaji, pockaji na rano
function tichyRezim(ted) {
  const h = ted.getHours()
  return h >= 22 || h < 6
}

// Podle klice se pozna, jestli uz o zmene vime. Jiny popis nebo ucebna = nova zmena.
function klicZmeny(den, h) {
  return [den.datum, h.cislo, h.zmena.typ, h.zmena.popis, h.ucebna].join("|")
}

const posunDny = (ted, n) => new Date(ted.getFullYear(), ted.getMonth(), ted.getDate() + n)

// Zmeny, o kterych ma smysl dat vedet: dnesni hodiny, ktere jeste neskoncily,
// a vsechny hodiny v nasledujicich HLIDAT_DNU dnech. Vraci jen dny, kde nejaka zmena je.
function zmenyKOznameni(dny, ted) {
  const dnes = datumKlic(ted)
  const posledni = datumKlic(posunDny(ted, HLIDAT_DNU))
  return dny
    .filter(d => d.datum >= dnes && d.datum <= posledni)
    .map(d => ({ den: d, hodiny: d.hodiny.filter(h => h.zmena && (d.datum > dnes || h.konec > ted)) }))
    .filter(x => x.hodiny.length)
}

// Pondeli tydnu, do kterych hlidane dny spadaji (vzdycky tenhle a pristi)
function tydnyKHlidani(ted) {
  const tydny = [0, HLIDAT_DNU].map(n => pondeliKlic(datumKlic(posunDny(ted, n))))
  return [...new Set(tydny)]
}

const druhZmeny = h => (h.zrusena ? "odpad\u00e1" : /Subst/i.test(h.zmena.typ) ? "suplov\u00e1n\u00ed" : "zm\u011bna")

// Titulek a text upozorneni na zmeny jednoho dne
function textUpozorneni(den, hodiny, ted) {
  const kdy = popisDne(den.datum, ted).split(" \u00b7 ")[0]
  if (hodiny.length === 1) {
    const h = hodiny[0]
    const ucebna = !h.zrusena && h.ucebna ? `u\u010debna ${h.ucebna}` : ""
    return {
      titulek: `${kdy}, ${h.cislo}. hodina: ${druhZmeny(h)}`,
      text: [h.predmet, ucebna, h.zmena.popis].filter(Boolean).join(" \u00b7 "),
    }
  }
  const n = hodiny.length
  return {
    titulek: `${kdy}: ${n} ${n >= 5 ? "zm\u011bn" : "zm\u011bny"} v rozvrhu`,
    text: hodiny.map(h => `${h.cislo}. hodina: ${druhZmeny(h)}${h.predmet ? ` (${h.predmet})` : ""}`).join("\n"),
  }
}

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

// Widget ma od iOS jen par sekund. Pomaly server nesmi beh zdrzet tak, aby ho iOS
// ukoncil driv, nez se widget vykresli (vychozi limit Request je 60 s).
const limitPozadavku = () => (config.runsInWidget ? 8 : 30)

async function prihlasit(parametry) {
  const req = new Request(Ulozene.get("url") + "/api/login")
  req.timeoutInterval = limitPozadavku()
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
    req.timeoutInterval = limitPozadavku()
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

function cestaSouboru(jmeno) {
  const fm = FileManager.local()
  return fm.joinPath(fm.documentsDirectory(), jmeno)
}

function nactiJson(jmeno, vychozi) {
  try {
    return JSON.parse(FileManager.local().readString(cestaSouboru(jmeno))) || vychozi
  } catch (e) {
    return vychozi
  }
}

const ulozJson = (jmeno, data) => FileManager.local().writeString(cestaSouboru(jmeno), JSON.stringify(data))

function smazSoubor(jmeno) {
  const fm = FileManager.local()
  if (fm.fileExists(cestaSouboru(jmeno))) fm.remove(cestaSouboru(jmeno))
}

const nactiCache = () => nactiJson(CACHE, {})

function ulozDoCache(datum, data, ted) {
  const cache = nactiCache()
  cache[pondeliKlic(datum)] = { ulozeno: ted.toISOString(), data }
  const stare = pondeliKlic(datumKlic(new Date(ted.getTime() - 7 * 86400000)))
  for (const k of Object.keys(cache)) if (k < stare) delete cache[k]
  ulozJson(CACHE, cache)
}

// Denik poslednich 30 behu widgetu pro Diagnostiku. Zaznam se stejnym id se prepise.
function zapisDoDeniku(zaznam) {
  const denik = nactiJson(DENIK, [])
  const ostatni = (Array.isArray(denik) ? denik : []).filter(z => z.id !== zaznam.id)
  ulozJson(DENIK, [...ostatni, zaznam].slice(-30))
}

// Online, a kdyz to nejde, z cache. `info` sbira, odkud data jsou (pro hlavicku widgetu).
// S `info.zPameti` bere cerstvou cache bez stahovani, aby widget dobehl rychle.
async function nactiTyden(datum, info, ted) {
  info.nactene.push(pondeliKlic(datum))
  const zCache = nactiCache()[pondeliKlic(datum)]
  const zCacheData = () => {
    const ulozeno = new Date(zCache.ulozeno)
    if (!info.aktualizace || ulozeno < info.aktualizace) info.aktualizace = ulozeno
    return zCache.data
  }
  if (info.zPameti && zCache && cerstvaPamet(zCache.ulozeno, ted)) return zCacheData()
  try {
    const data = await stahniTyden(datum)
    ulozDoCache(datum, data, ted)
    if (!info.aktualizace) info.aktualizace = ted
    info.stazene.push(data)
    return data
  } catch (e) {
    if (!zCache) throw e
    info.problem = e instanceof ChybaPrihlaseni ? "p\u0159ihlas se" : "offline"
    return zCacheData()
  }
}

async function nactiStav(ted, { zPameti = false } = {}) {
  if (!Ulozene.get("url")) {
    return { chyba: "Otev\u0159i skript ve Scriptable a p\u0159ihlas se do Bakal\u00e1\u0159\u016f." }
  }
  const info = { aktualizace: null, problem: null, zPameti, stazene: [], nactene: [] }
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
// Scriptable: upozorneni na zmeny
// ---------------------------------------------------------------------------

async function posliOznameni(titulek, text) {
  const n = new Notification()
  n.title = titulek
  n.body = text
  n.threadIdentifier = "bakalari-rozvrh-zmeny"
  n.openURL = URLScheme.forRunningScript() + "?zobraz=den"
  await n.schedule()
}

// Ohlasi nove zmeny z prave stazenych dat (z pameti nic nehlasi, ta uz prosla).
// Vraci pocet odeslanych upozorneni.
async function ohlasZmeny(stav, ted) {
  if (Ulozene.get("upozorneni") !== "1" || !stav.info) return 0
  // Widget stahuje jen tyden, ktery ukazuje. Zbytek hlidanych dnu se dotahne tady,
  // az po vykresleni, a plati pro nej stejna 15minutova pamet.
  for (const tyden of tydnyKHlidani(ted)) {
    if (stav.info.nactene.includes(tyden)) continue
    try {
      await nactiTyden(tyden, stav.info, ted)
    } catch (e) {} // offline a bez pam\u011bti: ohl\u00e1s\u00ed se aspo\u0148 to, co se st\u00e1hlo
  }
  if (!stav.info.stazene.length) return 0
  // Bez seznamu (prvni beh po zapnuti) se stavajici zmeny jen zapamatuji
  const prvniBeh = !FileManager.local().fileExists(cestaSouboru(OZNAMENO))
  const dnes = datumKlic(ted)
  const { klice = [] } = nactiJson(OZNAMENO, { klice: [] })
  const zname = klice.filter(k => k.split("|")[0] >= dnes)
  const dny = stav.info.stazene.flatMap(data => sestavDny(data))
  let odeslano = 0
  for (const { den, hodiny } of zmenyKOznameni(dny, ted)) {
    const nove = hodiny.filter(h => !zname.includes(klicZmeny(den, h)))
    if (!nove.length) continue
    if (!prvniBeh) {
      if (tichyRezim(ted)) continue // nezapamatuje se, ohl\u00e1s\u00ed se r\u00e1no
      const { titulek, text } = textUpozorneni(den, nove, ted)
      await posliOznameni(titulek, text)
      odeslano++
    }
    zname.push(...nove.map(h => klicZmeny(den, h)))
  }
  ulozJson(OZNAMENO, { klice: zname })
  return odeslano
}

// ---------------------------------------------------------------------------
// Scriptable: vzhled
// ---------------------------------------------------------------------------

const MOTIVY = { auto: "Automaticky", tmavy: "Tmav\u00fd", svetly: "Sv\u011btl\u00fd" }

// Barvy uceben v poradi podle cetnosti: [svetly rezim, tmavy rezim].
// Oranzova chybi schvalne, patri zmenam v rozvrhu.
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

// "auto" se ridi tmavym rezimem iPhonu, "tmavy" a "svetly" ho prebiji
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
    stitekUcebny: poradi =>
      poradi == null ? stitek("#6E6E73", "#98989F") : stitek(...PALETA[poradi % PALETA.length]),
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

// Tecky v hlavicce ukazuji, na ktere strance zasobniku widgetu jsi
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
  blok.cornerRadius = 8
  const prave = probiha(h, ted)
  if (prave) blok.backgroundColor = B.zvyrazneni

  const horni = blok.addStack()
  horni.centerAlignContent()
  pridejText(horni, h.cas, Font.regularMonospacedSystemFont(10), B.tlumeny)
  if (prave) {
    pridejText(horni, " \u00b7 zb\u00fdv\u00e1 ", Font.semiboldSystemFont(10), B.akcent)
    // Odpocet bezi zive, neceka na to, az iOS widget obnovi
    const odpocet = horni.addDate(h.konec)
    odpocet.applyTimerStyle()
    odpocet.font = Font.semiboldMonospacedSystemFont(10)
    odpocet.textColor = B.akcent
    odpocet.lineLimit = 1
    odpocet.leftAlignText()
  } else if (h.zmena && !h.zrusena) {
    const druh = /Subst/i.test(h.zmena.typ) ? " \u00b7 supl." : " \u00b7 zm\u011bna"
    pridejText(horni, druh, Font.semiboldSystemFont(10), B.zmena)
  }
  horni.addSpacer()

  const radek = blok.addStack()
  radek.centerAlignContent()
  const barvaNazvu = h.zrusena ? B.tlumeny : h.zmena ? B.zmena : B.text
  pridejText(radek, h.predmet || "\u2014", Font.boldSystemFont(15), barvaNazvu, 0.7)
  radek.addSpacer()

  const stitek = radek.addStack()
  stitek.setPadding(1, 6, 1, 6)
  stitek.cornerRadius = 5
  // Ucebna drzi svou barvu i pri suplovani, zmenu hlasi oranzovy predmet a \u201esupl.\u201c
  const barva = h.zrusena ? B.stitekZmena : B.stitekUcebny(h.barvaUcebny)
  stitek.backgroundColor = barva.pozadi
  const fontStitku = h.zrusena ? Font.semiboldSystemFont(11) : Font.boldSystemFont(13)
  pridejText(stitek, h.zrusena ? "odpad\u00e1" : h.ucebna || "\u2014", fontStitku, barva.text, 0.7)
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
  const shrnuti = info.problem ? `${info.problem} \u00b7 ${casText(info.aktualizace)}` : shrnutiDne(den, ted)
  pridejText(hlava, shrnuti, Font.regularSystemFont(11), info.problem ? B.zmena : B.tlumeny, 0.8)
  hlava.addSpacer()
  const stranek = Math.max(st.stranek, cisloStranky)
  if (stranek > 1) pridejTecky(hlava, stranek, cisloStranky, B)
  w.addSpacer(6)

  // Posledni stranka s volnym mistem dostane radek o konci vyucovani
  const konec = casText(konecDne(den))
  const zaver =
    st.posledni && st.hodiny.length < naStranku
      ? den.datum === datumKlic(ted)
        ? `To je pro dne\u0161ek v\u0161e. Konec v ${konec}.`
        : `Konec v ${konec}.`
      : null
  // Do tri polozek staci jeden siroky sloupec
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
  // Tabulka ma vzdycky barvy systemu, s vynucenym motivem by byl text na pozadi neviditelny
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
    kde.titleColor = h.zrusena ? B.zmena : B.stitekUcebny(h.barvaUcebny).text
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
  for (const k of ["url", "jmeno", "heslo", "access", "expirace", "refresh", "upozorneni"]) Ulozene.smaz(k)
  smazSoubor(CACHE)
  smazSoubor(OZNAMENO)
}

async function menu(ted) {
  const zapnuto = Ulozene.get("upozorneni") === "1"
  const a = new Alert()
  a.title = "Bakal\u00e1\u0159i rozvrh"
  a.message = `P\u0159ihl\u00e1\u0161en: ${Ulozene.get("jmeno")}\n${Ulozene.get("url")}\nVerze ${VERZE}`
  a.addAction("Zobrazit rozvrh")
  a.addAction("N\u00e1hled widgetu")
  a.addAction(`Upozorn\u011bn\u00ed na zm\u011bny: ${zapnuto ? "zapnuto" : "vypnuto"}`)
  a.addAction(`Vzhled: ${MOTIVY[zvolenyMotiv()]}`)
  a.addAction("Diagnostika obnovy widgetu")
  a.addDestructiveAction("Odhl\u00e1sit / zm\u011bnit \u0161kolu")
  a.addCancelAction("Zav\u0159\u00edt")
  const volba = await a.present()
  if (volba === 0) await ukazRozvrh(ted)
  if (volba === 1) await nahledWidgetu(ted)
  if (volba === 2) await prepniUpozorneni(ted)
  if (volba === 3) await vyberMotiv()
  if (volba === 4) await diagnostika()
  if (volba === 5) {
    odhlasit()
    await prihlasovaciDialog()
  }
}

// Seznam ohlasenych zmen se maze pokazde, takze po zapnuti se nehlasi stare zmeny
async function prepniUpozorneni(ted) {
  smazSoubor(OZNAMENO)
  if (Ulozene.get("upozorneni") === "1") {
    Ulozene.smaz("upozorneni")
    return upozorneni("Upozorn\u011bn\u00ed vypnut\u00e1", "Na zm\u011bny v rozvrhu t\u011b skript u\u017e upozor\u0148ovat nebude.")
  }
  Ulozene.set("upozorneni", "1")
  await ohlasZmeny(await nactiStav(ted), ted)
  // Zkusebni upozorneni zaroven vyvola dotaz iOS na povoleni
  await posliOznameni(
    "Upozorn\u011bn\u00ed na zm\u011bny zapnut\u00e1",
    "Takhle ti d\u00e1m v\u011bd\u011bt o suplov\u00e1n\u00ed nebo zru\u0161en\u00e9 hodin\u011b. Chod\u00ed p\u0159i obnov\u011b widgetu, tak\u017ee se m\u016f\u017ee o p\u00e1r minut zpozdit."
  )
}

async function diagnostika() {
  const denik = nactiJson(DENIK, [])
  const radky = (Array.isArray(denik) ? denik : []).slice(-15).reverse().map(radekDeniku)
  await upozorneni(
    "Diagnostika obnovy widgetu",
    (radky.length ? radky.join("\n") : "Widget zat\u00edm ani jednou neb\u011b\u017eel.") +
      "\n\nVelk\u00e9 mezery mezi \u010dasy znamenaj\u00ed, \u017ee iPhone widget nespou\u0161t\u011bl. " +
      "\u201enedob\u011bhl\u201c znamen\u00e1, \u017ee iOS b\u011bh ukon\u010dil d\u0159\u00edv, ne\u017e se widget vykreslil. " +
      "V \u00fasporn\u00e9m re\u017eimu se widgety obnovuj\u00ed m\u00e9n\u011b \u010dasto."
  )
}

// Nahled ve Scriptable posouvat nejde (posouva se az zasobnik na plose), proto vyber stranky
async function nahledWidgetu(ted) {
  const stav = await nactiStav(ted)
  let cislo = 1
  if (stav.den) {
    const { sloupcu, naSloupec } = rozlozeni("medium")
    const { stranek } = stranka(stav.den, ted, sloupcu * naSloupec)
    if (stranek > 1) {
      const a = new Alert()
      a.title = "Kterou str\u00e1nku uk\u00e1zat?"
      a.message = "Na plo\u0161e mezi nimi listuje\u0161 v z\u00e1sobn\u00edku widget\u016f, n\u00e1vod je v README."
      for (let i = 1; i <= stranek; i++) a.addAction(`Str\u00e1nka ${i}`)
      a.addCancelAction("Zru\u0161it")
      const volba = await a.present()
      if (volba === -1) return
      cislo = volba + 1
    }
  }
  await vytvorWidget(stav, ted, cislo).presentMedium()
}

async function vyberMotiv() {
  const a = new Alert()
  a.title = "Vzhled widgetu"
  a.message = "Automaticky se \u0159\u00edd\u00ed tmav\u00fdm re\u017eimem iPhonu. Na plo\u0161e se zm\u011bna projev\u00ed p\u0159i dal\u0161\u00ed obnov\u011b widgetu."
  const klice = Object.keys(MOTIVY)
  for (const k of klice) a.addAction(MOTIVY[k] + (k === zvolenyMotiv() ? " \u2713" : ""))
  a.addCancelAction("Zru\u0161it")
  const volba = await a.present()
  if (volba >= 0) Ulozene.set("motiv", klice[volba])
}

// Zaznam prave beziciho widgetu v deniku, at se do nej dostane i chyba z .catch
let zaznamBehu = null

async function main() {
  const ted = new Date()
  if (config.runsInWidget) {
    // Parametr widgetu = cislo stranky (1, 2\u2026) pro listovani v zasobniku widgetu
    const cislo = Math.max(1, parseInt(args.widgetParameter, 10) || 1)
    // Zapisuje se hned, takze beh, ktery iOS ukonci, zustane v deniku jako nedobehly
    const nahodne = Math.random().toString(36).slice(2, 6)
    zaznamBehu = { id: `${ted.getTime()}-${nahodne}`, start: ted.toISOString(), stranka: cislo, hotovo: false }
    zapisDoDeniku(zaznamBehu)
    const stav = await nactiStav(ted, { zPameti: true })
    Script.setWidget(vytvorWidget(stav, ted, cislo))
    zaznamBehu.zdroj = popisZdroje(stav)
    // Az po vykresleni: chyba upozorneni nesmi widget rozbit
    try {
      zaznamBehu.upozorneni = await ohlasZmeny(stav, ted)
    } catch (e) {
      zaznamBehu.chyba = "upozorn\u011bn\u00ed: " + e.message
    }
    zaznamBehu.hotovo = true
    zaznamBehu.ms = Date.now() - ted.getTime()
    zapisDoDeniku(zaznamBehu)
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
      if (!config.runsInWidget) return upozorneni("Chyba", e.message)
      Script.setWidget(vytvorWidget({ chyba: e.message }, new Date()))
      if (!zaznamBehu) return
      Object.assign(zaznamBehu, { hotovo: true, zdroj: "chyba", chyba: e.message })
      zaznamBehu.ms = Date.now() - new Date(zaznamBehu.start).getTime()
      try {
        zapisDoDeniku(zaznamBehu)
      } catch (e2) {}
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
    popisDne,
    dalsiObnova,
    cerstvaPamet,
    popisZdroje,
    radekDeniku,
    tichyRezim,
    klicZmeny,
    zmenyKOznameni,
    tydnyKHlidani,
    textUpozorneni,
  }
}
