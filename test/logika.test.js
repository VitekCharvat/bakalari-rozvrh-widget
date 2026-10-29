const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const R = require("../BakalariRozvrh.js")

const fixture = jmeno => require(path.join(__dirname, "fixtures", jmeno))
const tyden1 = fixture("tyden-2026-10-26.json")
const tyden2 = fixture("tyden-2026-11-02.json")
const dny1 = R.sestavDny(tyden1)
const utery = dny1.find(d => d.datum === "2026-10-27")
const kdy = (datum, cas) => R.casNaDatum(datum, cas)

// Falešné API: vrací týden podle pondělí, prázdný týden pro cokoliv jiného
const nactiTyden = async datum =>
  ({ "2026-10-26": tyden1, "2026-11-02": tyden2 })[R.pondeliKlic(datum)] || { Days: [] }

test("normalizujUrl ořeže adresu z prohlížeče na základ API", () => {
  assert.equal(R.normalizujUrl("bakalari.skola.cz/bakaweb"), "https://bakalari.skola.cz/bakaweb")
  assert.equal(R.normalizujUrl(" https://bakalari.skola.cz/bakaweb/ "), "https://bakalari.skola.cz/bakaweb")
  assert.equal(R.normalizujUrl("https://bakalari.skola.cz/bakaweb/next/rozvrh.aspx?s=1"), "https://bakalari.skola.cz/bakaweb")
  assert.equal(R.normalizujUrl("https://bakalari.skola.cz/login"), "https://bakalari.skola.cz")
  assert.equal(R.normalizujUrl("https://skola.cz/bakaweb/login.aspx"), "https://skola.cz/bakaweb")
  assert.equal(R.normalizujUrl(""), "")
})

test("pondeliKlic vrací pondělí stejného týdne", () => {
  assert.equal(R.pondeliKlic("2026-10-26"), "2026-10-26")
  assert.equal(R.pondeliKlic("2026-10-28"), "2026-10-26")
  assert.equal(R.pondeliKlic("2026-11-01"), "2026-10-26") // neděle
})

test("sestavDny spojí hodiny s číselníky, seřadí je a vynechá prázdné", () => {
  assert.equal(dny1.length, 5)
  assert.deepEqual(
    utery.hodiny.map(h => `${h.cislo} ${h.predmet} ${h.ucebna}`),
    ["1 MAT 212", "2 PVA PC3", "3 ANJ 104", "5  ", "6 WEB PC3", "7 TEV TĚL", "8 TEV TĚL"]
  )
  const prvni = utery.hodiny[0]
  assert.equal(prvni.cas, "8:00 – 8:45")
  assert.equal(prvni.predmetNazev, "Matematika")
  assert.equal(prvni.ucitel, "Učitel A")
  assert.equal(prvni.tema, "Soustavy rovnic")
})

test("suplování je změna, Removed znamená, že hodina odpadá", () => {
  const anj = utery.hodiny.find(h => h.cislo === "3")
  assert.equal(anj.zmena.typ, "Substitution")
  assert.equal(anj.zrusena, false)
  const pata = utery.hodiny.find(h => h.cislo === "5")
  assert.equal(pata.zrusena, true)
  assert.equal(pata.zmena.popis, "Zrušeno (Učitel F)")
})

test("vyberDen: ráno i během vyučování zůstává dnešek", () => {
  assert.equal(R.vyberDen(dny1, kdy("2026-10-27", "6:30")).datum, "2026-10-27")
  assert.equal(R.vyberDen(dny1, kdy("2026-10-27", "15:00")).datum, "2026-10-27")
})

test("vyberDen: po poslední hodině přeskočí na další den s výukou", () => {
  assert.equal(R.vyberDen(dny1, kdy("2026-10-26", "10:45")).datum, "2026-10-27")
  assert.equal(R.vyberDen(dny1, kdy("2026-10-27", "15:10")), null) // zbytek týdne svátek a prázdniny
})

test("najdiDen přeskočí prázdniny i víkend do dalšího týdne", async () => {
  assert.equal((await R.najdiDen(kdy("2026-10-27", "16:00"), nactiTyden)).datum, "2026-11-02")
  assert.equal((await R.najdiDen(kdy("2026-10-31", "10:00"), nactiTyden)).datum, "2026-11-02") // sobota
  assert.equal((await R.najdiDen(kdy("2026-11-02", "7:00"), nactiTyden)).datum, "2026-11-02")
})

test("najdiDen vrátí null, když dlouho žádná výuka není", async () => {
  assert.equal(await R.najdiDen(kdy("2026-12-21", "10:00"), nactiTyden), null)
})

const cisla = st => st.hodiny.map(h => h.cislo)

test("stranka u dneška začíná probíhající hodinou", () => {
  const st = R.stranka(utery, kdy("2026-10-27", "10:10"), 6)
  assert.deepEqual(cisla(st), ["3", "5", "6", "7", "8"])
  assert.equal(st.stranek, 1)
  assert.equal(st.posledni, true)
  assert.ok(R.probiha(st.hodiny[0], kdy("2026-10-27", "10:10")))
})

test("stranka: co se nevejde na první stránku, je na druhé", () => {
  const ted = kdy("2026-10-27", "7:00")
  const prvni = R.stranka(utery, ted, 6, 1)
  assert.deepEqual(cisla(prvni), ["1", "2", "3", "5", "6", "7"])
  assert.equal(prvni.stranek, 2)
  assert.equal(prvni.posledni, false)
  const druha = R.stranka(utery, ted, 6, 2)
  assert.deepEqual(cisla(druha), ["8"])
  assert.equal(druha.posledni, true)
})

test("stranka za koncem rozvrhu je prázdná a poslední", () => {
  const st = R.stranka(utery, kdy("2026-10-27", "7:00"), 6, 3)
  assert.deepEqual(cisla(st), [])
  assert.equal(st.posledni, true)
})

test("stranka u jiného dne než dneška ukazuje den od začátku", () => {
  assert.equal(R.stranka(utery, kdy("2026-10-26", "18:00"), 6).hodiny[0].cislo, "1")
})

test("tvarHodin skloňuje podle češtiny", () => {
  assert.deepEqual([0, 1, 2, 4, 5, 9].map(R.tvarHodin), ["hodin", "hodina", "hodiny", "hodiny", "hodin", "hodin"])
})

test("shrnutiDne počítá jen hodiny, které neodpadají", () => {
  assert.equal(R.shrnutiDne(utery, kdy("2026-10-27", "10:10")), "ještě 4 hodiny · do 15:10")
  assert.equal(R.shrnutiDne(utery, kdy("2026-10-26", "18:00")), "6 hodin · 8:00–15:10")
  assert.deepEqual(R.konecDne(utery), kdy("2026-10-27", "15:10"))
})

test("barva učebny: nejčastější učebna týdne má první barvu, stejná učebna stejnou", () => {
  // Fixture týden: PC3 3×, pak 104, 212 a TĚL po 2× (shoda se řadí podle názvu)
  const barvy = {}
  for (const den of dny1) for (const h of den.hodiny) if (h.ucebna) barvy[h.ucebna] = h.barvaUcebny
  assert.deepEqual(barvy, { PC3: 0, 104: 1, 212: 2, TĚL: 3 })
  const pc3 = dny1.flatMap(d => d.hodiny).filter(h => h.ucebna === "PC3")
  assert.ok(pc3.length === 3 && pc3.every(h => h.barvaUcebny === 0))
  assert.equal(utery.hodiny.find(h => h.zrusena).barvaUcebny, null, "bez učebny bez barvy")
})

test("popisDne rozliší dnes, zítra a další dny", () => {
  const ted = kdy("2026-10-26", "18:00")
  assert.equal(R.popisDne("2026-10-26", ted), "Dnes · pondělí 26. 10.")
  assert.equal(R.popisDne("2026-10-27", ted), "Zítra · úterý 27. 10.")
  assert.equal(R.popisDne("2026-11-02", ted), "Pondělí 2. 11.")
})

test("dalsiObnova míří na nejbližší začátek nebo konec hodiny", () => {
  assert.deepEqual(R.dalsiObnova(utery, kdy("2026-10-27", "8:10")), kdy("2026-10-27", "8:45"))
  assert.deepEqual(R.dalsiObnova(utery, kdy("2026-10-27", "16:00")), kdy("2026-10-27", "17:00"))
  assert.deepEqual(R.dalsiObnova(null, kdy("2026-10-27", "16:00")), kdy("2026-10-27", "17:00"))
})

test("zmenyKOznameni vynechá odučené hodiny a textUpozorneni popíše jednu změnu", () => {
  const ted = kdy("2026-10-27", "10:50")
  const zmeny = R.zmenyKOznameni(dny1, ted)
  assert.equal(zmeny.length, 1)
  assert.equal(zmeny[0].den, utery)
  assert.deepEqual(cisla(zmeny[0]), ["5"])
  assert.deepEqual(R.textUpozorneni(utery, zmeny[0].hodiny, ted), {
    titulek: "Dnes, 5. hodina: odpadá",
    text: "Zrušeno (Učitel F)",
  })
})

test("textUpozorneni večer předem píše o zítřku", () => {
  const anj = utery.hodiny.find(h => h.cislo === "3")
  assert.deepEqual(R.textUpozorneni(utery, [anj], kdy("2026-10-26", "18:00")), {
    titulek: "Zítra, 3. hodina: suplování",
    text: "ANJ · učebna 104 · Suplování za Učitel C",
  })
})

test("tichyRezim platí od 22:00 do 5:59", () => {
  assert.equal(R.tichyRezim(kdy("2026-10-27", "22:00")), true)
  assert.equal(R.tichyRezim(kdy("2026-10-27", "5:59")), true)
  assert.equal(R.tichyRezim(kdy("2026-10-27", "6:00")), false)
})

test("cerstvaPamet drží data 15 minut", () => {
  const ted = kdy("2026-10-27", "9:20")
  assert.equal(R.cerstvaPamet(kdy("2026-10-27", "9:06").toISOString(), ted), true)
  assert.equal(R.cerstvaPamet(kdy("2026-10-27", "9:04").toISOString(), ted), false)
})

test("radekDeniku ukáže čas, délku a zdroj, nedoběhlý běh označí", () => {
  const start = kdy("2026-10-29", "13:45").toISOString()
  assert.equal(R.radekDeniku({ start, hotovo: true, ms: 1234, zdroj: "staženo" }), "29. 10. 13:45 · 1,2 s · staženo")
  assert.equal(R.radekDeniku({ start, hotovo: false }), "29. 10. 13:45 · nedoběhl")
})
