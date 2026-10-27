// Ze src/BakalariRozvrh.js udělá BakalariRozvrh.js, který obsahuje jen ASCII znaky.
// Důvod: při přenosu přes e-mail nebo zprávu může iPhone přečíst UTF-8 špatně
// a z „Pondělí“ se stane „Pond?l�“. Escapované \uXXXX přežije jakékoli kódování.
//
//   node scripts/build.js          zapíše BakalariRozvrh.js
//   require("./scripts/build.js")  vrátí { sestav, ZDROJ, CIL } pro testy
const fs = require("node:fs")
const path = require("node:path")

const ZDROJ = path.join(__dirname, "..", "src", "BakalariRozvrh.js")
const CIL = path.join(__dirname, "..", "BakalariRozvrh.js")
const HLAVICKA = 3 // Scriptable vyžaduje své tři řádky úplně nahoře

const escapuj = text =>
  text.replace(/[^\x00-\x7F]/g, z => "\\u" + z.charCodeAt(0).toString(16).padStart(4, "0"))

// V celořádkových komentářích stačí diakritiku odstranit, ať jdou v editoru číst
const bezDiakritiky = text => text.normalize("NFD").replace(/[̀-ͯ]/g, "")

function sestav(zdroj) {
  const radky = zdroj.split("\n")
  const vystup = radky.map(r => escapuj(/^\s*\/\//.test(r) ? bezDiakritiky(r) : r))
  vystup.splice(
    HLAVICKA,
    0,
    "",
    "// VYGENEROVANO z src/BakalariRozvrh.js (npm run build). Upravuj zdroj, ne tenhle soubor."
  )
  return vystup.join("\n")
}

if (require.main === module) {
  fs.writeFileSync(CIL, sestav(fs.readFileSync(ZDROJ, "utf8")))
  console.log("Zapsáno:", path.relative(process.cwd(), CIL))
}

module.exports = { sestav, ZDROJ, CIL }
