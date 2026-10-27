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

test("oknoOd u dneška začíná probíhající hodinou", () => {
  const okno = R.oknoOd(utery, kdy("2026-10-27", "10:10"), 6)
  assert.deepEqual(okno.hodiny.map(h => h.cislo), ["3", "5", "6", "7", "8"])
  assert.equal(okno.dalsi, 0)
  assert.ok(R.probiha(okno.hodiny[0], kdy("2026-10-27", "10:10")))
})

test("oknoOd: co se nevejde, nahradí „+N další“ na posledním místě", () => {
  const okno = R.oknoOd(utery, kdy("2026-10-27", "7:00"), 6)
  assert.deepEqual(okno.hodiny.map(h => h.cislo), ["1", "2", "3", "5", "6"])
  assert.equal(okno.dalsi, 2)
})

test("oknoOd u jiného dne než dneška ukazuje den od začátku", () => {
  const okno = R.oknoOd(utery, kdy("2026-10-26", "18:00"), 6)
  assert.equal(okno.hodiny[0].cislo, "1")
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
