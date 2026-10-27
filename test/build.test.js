const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const { sestav, ZDROJ, CIL } = require("../scripts/build.js")

test("BakalariRozvrh.js je aktuální build ze src/ (jinak spusť npm run build)", () => {
  assert.equal(fs.readFileSync(CIL, "utf8"), sestav(fs.readFileSync(ZDROJ, "utf8")))
})

test("BakalariRozvrh.js obsahuje jen ASCII, takže přežije jakýkoli přenos", () => {
  const spatne = [...fs.readFileSync(CIL, "utf8")].filter(z => z.charCodeAt(0) > 0x7f)
  assert.deepEqual(spatne, [])
})

test("hlavička pro Scriptable zůstává na prvních třech řádcích", () => {
  const radky = fs.readFileSync(CIL, "utf8").split("\n")
  assert.match(radky[0], /^\/\/ Variables used by Scriptable\./)
  assert.match(radky[2], /^\/\/ icon-color:/)
})

test("escapování nemění texty, které skript zobrazuje", () => {
  assert.equal(eval(sestav('"Pondělí · „+2 další ›“ – odpadá"')), "Pondělí · „+2 další ›“ – odpadá")
})
