// Spustí celý skript proti napodobenému Scriptable API (widget režim)
// a zkontroluje, co se vykreslí. Neověřuje vzhled, jen že kód projde a sedí obsah.
const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const fixture = jmeno => require(path.join(__dirname, "fixtures", jmeno))

function spustSkript({ ted, keychain = {}, soubory = {}, odpovedi, online = true, parametr = null }) {
  const texty = []
  const odpocty = []
  const pozadavky = []
  const limity = []
  const oznameni = []
  class Prvek {
    constructor() {
      this.deti = []
    }
    addStack() {
      const s = new Prvek()
      this.deti.push(s)
      return s
    }
    addText(t) {
      texty.push(t)
      return {}
    }
    addDate(d) {
      odpocty.push(d)
      return { applyTimerStyle() {}, leftAlignText() {} }
    }
    addSpacer() {}
    layoutVertically() {}
    centerAlignContent() {}
    topAlignContent() {}
    setPadding() {}
  }
  const g = {
    Keychain: {
      contains: k => k in keychain,
      get: k => keychain[k],
      set: (k, v) => (keychain[k] = v),
      remove: k => delete keychain[k],
    },
    Request: class {
      constructor(url) {
        this.url = url
        this.response = {}
      }
      async loadString() {
        pozadavky.push(this.url)
        limity.push(this.timeoutInterval)
        if (!online) throw new Error("The Internet connection appears to be offline.")
        const odp = odpovedi(this)
        this.response.statusCode = odp.stav
        return JSON.stringify(odp.telo)
      }
    },
    FileManager: {
      local: () => ({
        documentsDirectory: () => "/docs",
        joinPath: (a, b) => `${a}/${b}`,
        readString: p => {
          if (!(p in soubory)) throw new Error("není")
          return soubory[p]
        },
        writeString: (p, s) => (soubory[p] = s),
        fileExists: p => p in soubory,
        remove: p => delete soubory[p],
      }),
    },
    Notification: class {
      async schedule() {
        oznameni.push({ titulek: this.title, text: this.body })
      }
    },
    ListWidget: class extends Prvek {},
    Color: Object.assign(class {}, { dynamic: () => ({}) }),
    Font: new Proxy({}, { get: () => () => ({}) }),
    Size: class {},
    URLScheme: { forRunningScript: () => "scriptable:///run/BakalariRozvrh" },
    config: { runsInWidget: true, widgetFamily: "medium" },
    args: { queryParameters: {}, widgetParameter: parametr },
  }
  const RealDate = Date
  class FalesneDatum extends RealDate {
    constructor(...a) {
      if (a.length) super(...a)
      else super(ted.getTime())
    }
    static now() {
      return ted.getTime()
    }
  }
  return new Promise((resolve, reject) => {
    let widget
    g.Script = {
      setWidget: w => (widget = w),
      complete: () => {
        Object.keys(g).forEach(k => delete global[k])
        global.Date = RealDate
        resolve({ widget, texty, odpocty, pozadavky, limity, oznameni, keychain, soubory })
      },
    }
    Object.assign(global, g)
    global.Date = FalesneDatum
    const cesta = require.resolve("../BakalariRozvrh.js")
    delete require.cache[cesta]
    try {
      require(cesta)
    } catch (e) {
      reject(e)
    }
  })
}

const tydny = { "2026-10-26": fixture("tyden-2026-10-26.json"), "2026-11-02": fixture("tyden-2026-11-02.json") }
const api = req => {
  if (req.url.endsWith("/api/login")) {
    return { stav: 200, telo: { access_token: "A", refresh_token: "R2", expires_in: 3600 } }
  }
  const datum = req.url.match(/date=([\d-]+)/)[1]
  const pondeli = require("../BakalariRozvrh.js").pondeliKlic(datum)
  return { stav: 200, telo: tydny[pondeli] || { Days: [] } }
}
const prihlasen = () => ({
  "bakalari-rozvrh.url": "https://bakalari.skola.cz/bakaweb",
  "bakalari-rozvrh.jmeno": "zak",
  "bakalari-rozvrh.heslo": "x",
  "bakalari-rozvrh.refresh": "R1",
})

test("widget v úterý dopoledne ukáže zbytek dne s časy a učebnami", async () => {
  const ted = new Date(2026, 9, 27, 10, 10)
  const v = await spustSkript({ ted, keychain: prihlasen(), odpovedi: api })
  assert.ok(v.widget, "widget se nastavil")
  assert.equal(v.texty[0], "Dnes · úterý 27. 10.")
  assert.ok(v.texty.includes("10:00 – 10:45"))
  assert.ok(v.texty.includes("ANJ"))
  assert.ok(v.texty.includes("104"))
  assert.ok(v.texty.includes("odpadá"))
  assert.ok(!v.texty.includes("MAT"), "odučená hodina se neukazuje")
  assert.equal(v.texty[1], "ještě 4 hodiny · do 15:10")
  assert.ok(v.texty.includes(" · zbývá "), "probíhající hodina má odpočet")
  assert.deepEqual(v.odpocty.map(d => d.getTime()), [new Date(2026, 9, 27, 10, 45).getTime()])
  assert.ok(v.texty.includes("To je pro dnešek vše. Konec v 15:10."))
  assert.equal(v.keychain["bakalari-rozvrh.refresh"], "R2", "refresh token se obnovil")
  assert.ok(v.pozadavky[0].endsWith("/api/login"))
})

test("parametr widgetu 2 ukáže druhou stránku dne", async () => {
  const ted = new Date(2026, 9, 27, 7, 0)
  const prvni = await spustSkript({ ted, keychain: prihlasen(), odpovedi: api })
  assert.ok(prvni.texty.includes("MAT"))
  assert.ok(prvni.texty.includes(" · supl."), "suplování je označené")
  assert.ok(!prvni.texty.includes("14:25 – 15:10"))
  const druha = await spustSkript({ ted, keychain: prihlasen(), odpovedi: api, parametr: "2" })
  assert.equal(druha.texty[0], "Dnes · úterý 27. 10.")
  assert.ok(druha.texty.includes("14:25 – 15:10"))
  assert.ok(!druha.texty.includes("MAT"))
  assert.ok(druha.texty.includes("To je pro dnešek vše. Konec v 15:10."))
})

test("vynucený světlý i tmavý motiv widget vykreslí", async () => {
  for (const motiv of ["svetly", "tmavy", "nesmysl"]) {
    const keychain = { ...prihlasen(), "bakalari-rozvrh.motiv": motiv }
    const v = await spustSkript({ ted: new Date(2026, 9, 27, 10, 10), keychain, odpovedi: api })
    assert.equal(v.texty[0], "Dnes · úterý 27. 10.", motiv)
  }
})

test("v pátek večer widget ukáže pondělí po prázdninách", async () => {
  const ted = new Date(2026, 9, 30, 19, 0)
  const v = await spustSkript({ ted, keychain: prihlasen(), odpovedi: api })
  assert.equal(v.texty[0], "Pondělí 2. 11.")
  assert.ok(v.texty.includes("8:00 – 8:45"))
})

test("bez internetu se použije uložená data a hlavička to přizná", async () => {
  const ted = new Date(2026, 9, 27, 7, 0)
  const prvni = await spustSkript({ ted, keychain: prihlasen(), odpovedi: api })
  assert.equal(Object.keys(JSON.parse(prvni.soubory["/docs/bakalari-rozvrh-cache.json"])).length, 1)
  const v = await spustSkript({
    ted: new Date(2026, 9, 27, 9, 0),
    keychain: { ...prvni.keychain, "bakalari-rozvrh.expirace": "0" },
    soubory: prvni.soubory,
    odpovedi: api,
    online: false,
  })
  assert.equal(v.texty[0], "Dnes · úterý 27. 10.")
  assert.ok(v.texty.includes("offline · 7:00"))
  assert.ok(v.texty.includes("PVA"))
})

test("bez internetu a bez uložených dat widget vysvětlí, co se děje", async () => {
  const v = await spustSkript({ ted: new Date(2026, 9, 27, 9, 0), keychain: prihlasen(), odpovedi: api, online: false })
  assert.match(v.texty[0], /nepodařilo načíst/)
})

test("nepřihlášený uživatel dostane návod", async () => {
  const v = await spustSkript({ ted: new Date(2026, 9, 27, 7, 0), odpovedi: api })
  assert.match(v.texty[0], /přihlas se/)
  assert.equal(v.pozadavky.length, 0)
})

test("špatné heslo vede na výzvu k novému přihlášení", async () => {
  const v = await spustSkript({
    ted: new Date(2026, 9, 27, 7, 0),
    keychain: prihlasen(),
    odpovedi: () => ({ stav: 400, telo: { error: "invalid_grant", error_description: "Bad password" } }),
  })
  assert.match(v.texty[0], /Přihlášení nevyšlo/)
  assert.ok(!("bakalari-rozvrh.refresh" in v.keychain), "neplatný refresh token se smazal")
})

// Stejný rozvrh, jen bez suplování a zrušených hodin
const apiBezZmen = req => {
  const odp = api(req)
  const telo = JSON.parse(JSON.stringify(odp.telo))
  for (const den of telo.Days || []) for (const a of den.Atoms || []) a.Change = null
  return { ...odp, telo }
}
const DENIK = "/docs/bakalari-rozvrh-denik.json"
const OZNAMENO = "/docs/bakalari-rozvrh-oznameno.json"
const sUpozornenim = () => ({ ...prihlasen(), "bakalari-rozvrh.upozorneni": "1" })

test("widget stahuje s limitem 8 s a čerstvá data 15 minut znovu nestahuje", async () => {
  const prvni = await spustSkript({ ted: new Date(2026, 9, 27, 9, 0), keychain: prihlasen(), odpovedi: api })
  assert.ok(prvni.pozadavky.length > 0)
  assert.deepEqual(prvni.limity, prvni.pozadavky.map(() => 8))
  const druhy = await spustSkript({
    ted: new Date(2026, 9, 27, 9, 10),
    keychain: prvni.keychain,
    soubory: prvni.soubory,
    odpovedi: api,
  })
  assert.equal(druhy.pozadavky.length, 0, "z paměti bez stahování")
  assert.equal(druhy.texty[0], "Dnes · úterý 27. 10.")
  assert.ok(druhy.texty.includes("PVA"))
  assert.ok(druhy.texty.includes(" · zbývá "), "PVA právě probíhá")
  assert.ok(!druhy.texty.some(t => t.includes("offline")))
  const treti = await spustSkript({
    ted: new Date(2026, 9, 27, 9, 20),
    keychain: druhy.keychain,
    soubory: druhy.soubory,
    odpovedi: api,
  })
  assert.ok(treti.pozadavky.length > 0, "po 15 minutách se stahuje znovu")
})

test("deník obnov zaznamená doběhlý běh widgetu", async () => {
  const v = await spustSkript({ ted: new Date(2026, 9, 27, 9, 0), keychain: prihlasen(), odpovedi: api })
  const denik = JSON.parse(v.soubory[DENIK])
  assert.equal(denik.length, 1)
  assert.equal(denik[0].hotovo, true)
  assert.equal(denik[0].zdroj, "staženo")
  assert.equal(denik[0].stranka, 1)
})

test("bez zapnutých upozornění se nic neposílá", async () => {
  const v = await spustSkript({ ted: new Date(2026, 9, 27, 7, 0), keychain: prihlasen(), odpovedi: api })
  assert.deepEqual(v.oznameni, [])
  assert.ok(!(OZNAMENO in v.soubory))
})

test("zapnutá upozornění ohlásí nové změny právě jednou", async () => {
  const rano = await spustSkript({
    ted: new Date(2026, 9, 27, 7, 0),
    keychain: sUpozornenim(),
    soubory: { [OZNAMENO]: JSON.stringify({ klice: [] }) },
    odpovedi: apiBezZmen,
  })
  assert.deepEqual(rano.oznameni, [])
  const zmena = await spustSkript({
    ted: new Date(2026, 9, 27, 7, 30),
    keychain: rano.keychain,
    soubory: rano.soubory,
    odpovedi: api,
  })
  assert.deepEqual(zmena.oznameni, [
    { titulek: "Dnes: 2 změny v rozvrhu", text: "3. hodina: suplování (ANJ)\n5. hodina: odpadá" },
  ])
  const pozdeji = await spustSkript({
    ted: new Date(2026, 9, 27, 8, 0),
    keychain: zmena.keychain,
    soubory: zmena.soubory,
    odpovedi: api,
  })
  assert.ok(pozdeji.pozadavky.length > 0, "data se stáhla znovu")
  assert.deepEqual(pozdeji.oznameni, [])
})

test("první běh po zapnutí stávající změny jen zapamatuje", async () => {
  const v = await spustSkript({ ted: new Date(2026, 9, 27, 7, 0), keychain: sUpozornenim(), odpovedi: api })
  assert.deepEqual(v.oznameni, [])
  assert.equal(JSON.parse(v.soubory[OZNAMENO]).klice.length, 2)
})

test("v noci se neupozorňuje, změna se ohlásí ráno", async () => {
  const noc = await spustSkript({
    ted: new Date(2026, 9, 27, 5, 30),
    keychain: sUpozornenim(),
    soubory: { [OZNAMENO]: JSON.stringify({ klice: [] }) },
    odpovedi: api,
  })
  assert.deepEqual(noc.oznameni, [])
  const rano = await spustSkript({
    ted: new Date(2026, 9, 27, 6, 45),
    keychain: noc.keychain,
    soubory: noc.soubory,
    odpovedi: api,
  })
  assert.equal(rano.oznameni.length, 1)
})
