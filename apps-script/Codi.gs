/**
 * Backend de l'app d'incidències de manteniment.
 *
 * S'instal·la DINS del full de càlcul "Manteniment":
 *   Extensions → Apps Script → enganxa aquest codi → Desa
 *   Implementa → Implementació nova → Tipus: Aplicació web
 *     - Executa com a: Jo
 *     - Qui hi té accés: Qualsevol persona
 *   Autoritza els permisos i copia l'URL que acaba en /exec.
 *
 * doGet  → retorna les preguntes i opcions del Google Forms vinculat,
 *          perquè l'app mostri exactament les mateixes opcions.
 * doPost → afegeix una fila nova al full de respostes (mateix format que
 *          el formulari) i desa les fotos/vídeos a una carpeta de Drive.
 *          Amb { accio: "incidencies", clau } retorna totes les incidències
 *          per al panell de manteniment, només si la clau és correcta.
 *
 * Contrasenya del panell (no va al codi, així el codi pot ser públic):
 *   Configuració del projecte (⚙) → Propietats de l'script →
 *   Afegeix: Propietat = CLAU_PANELL, Valor = la contrasenya que vulguis.
 */

const NOM_CARPETA = "Manteniment - adjunts app";
const MAX_ADJUNTS = 5;

function doGet() {
  try {
    return json({ ok: true, preguntes: preguntesDelFormulari() });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  let dades;
  try {
    dades = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "Petició no vàlida" });
  }
  if (dades.accio === "incidencies") return llistaIncidencies(dades.clau);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const respostes = dades.respostes || {};
    const full = fullRespostes();

    const tipusPerTitol = {};
    preguntesDelFormulari().forEach((p) => (tipusPerTitol[normalitza(p.titol)] = p.tipus));

    // Desa els adjunts a Drive i agrupa els enllaços per pregunta
    const enllacos = {};
    (dades.adjunts || []).slice(0, MAX_ADJUNTS).forEach((a) => {
      const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.tipus, a.nom);
      const fitxer = carpeta().createFile(blob);
      const clau = normalitza(a.pregunta);
      (enllacos[clau] = enllacos[clau] || []).push("https://drive.google.com/open?id=" + fitxer.getId());
    });

    const respostesNorm = {};
    Object.keys(respostes).forEach((k) => (respostesNorm[normalitza(k)] = respostes[k]));

    const capcaleres = full.getRange(1, 1, 1, full.getLastColumn()).getValues()[0];
    const fila = capcaleres.map((cap, i) => {
      if (i === 0) return new Date(); // Marca temporal
      const clau = normalitza(cap);
      if (enllacos[clau]) return enllacos[clau].join(", ");
      let valor = respostesNorm[clau];
      if (valor == null || valor === "") return "";
      if (Array.isArray(valor)) valor = valor.join(", ");
      valor = String(valor).slice(0, 5000);

      const tipus = tipusPerTitol[clau];
      if (tipus === "data" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        const [a, m, d] = valor.split("-").map(Number);
        return new Date(a, m - 1, d);
      }
      if (tipus === "hora" && /^\d{2}:\d{2}$/.test(valor)) return valor + ":00";
      // Evita que un text es converteixi en fórmula
      return /^[=+\-@]/.test(valor) ? "'" + valor : valor;
    });

    full.appendRow(fila);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Panell de manteniment ---------- */

function llistaIncidencies(clau) {
  const correcta = PropertiesService.getScriptProperties().getProperty("CLAU_PANELL");
  if (!correcta) return json({ ok: false, error: "config", missatge: "Falta la propietat CLAU_PANELL a l'Apps Script." });
  if (String(clau || "") !== correcta) {
    Utilities.sleep(1500); // frena els intents de endevinar la contrasenya
    return json({ ok: false, error: "clau", missatge: "Contrasenya incorrecta." });
  }

  const full = fullRespostes();
  const zona = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const rang = full.getDataRange();
  const valors = rang.getValues();
  const textos = rang.getDisplayValues();

  const files = [];
  for (let i = 1; i < valors.length; i++) {
    if (!textos[i].some((t) => t !== "")) continue;
    const marca = valors[i][0];
    files.push({ marca: marca instanceof Date ? dataGviz(marca, zona) : String(marca), valors: textos[i] });
  }
  return json({ ok: true, files });
}

// Mateix format que feia servir el panell abans ("Date(2026,8,8,20,9,13)", mes 0–11),
// perquè la gestió ja desada als navegadors continuï lligada a cada incidència.
function dataGviz(d, zona) {
  const p = Utilities.formatDate(d, zona, "yyyy,M,d,H,m,s").split(",").map(Number);
  p[1] -= 1;
  return "Date(" + p.join(",") + ")";
}

/* ---------- Ajudants ---------- */

function fullRespostes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().find((s) => s.getFormUrl()) || ss.getSheets()[0];
}

function formulari() {
  const url = fullRespostes().getFormUrl() || SpreadsheetApp.getActiveSpreadsheet().getFormUrl();
  if (!url) throw new Error("Aquest full no està vinculat a cap Google Forms.");
  return FormApp.openByUrl(url);
}

function preguntesDelFormulari() {
  const T = FormApp.ItemType;
  return formulari().getItems().map((item) => {
    const p = { titol: item.getTitle(), ajuda: item.getHelpText(), tipus: null, obligatori: false, opcions: [], altres: false };
    const t = item.getType();
    if (t === T.TEXT) { p.tipus = "text"; p.obligatori = item.asTextItem().isRequired(); }
    else if (t === T.PARAGRAPH_TEXT) { p.tipus = "paragraf"; p.obligatori = item.asParagraphTextItem().isRequired(); }
    else if (t === T.DATE) { p.tipus = "data"; p.obligatori = item.asDateItem().isRequired(); }
    else if (t === T.TIME) { p.tipus = "hora"; p.obligatori = item.asTimeItem().isRequired(); }
    else if (t === T.MULTIPLE_CHOICE) {
      const it = item.asMultipleChoiceItem();
      Object.assign(p, { tipus: "opcio", obligatori: it.isRequired(), opcions: it.getChoices().map((c) => c.getValue()), altres: it.hasOtherOption() });
    }
    else if (t === T.LIST) {
      const it = item.asListItem();
      Object.assign(p, { tipus: "llista", obligatori: it.isRequired(), opcions: it.getChoices().map((c) => c.getValue()) });
    }
    else if (t === T.CHECKBOX) {
      const it = item.asCheckboxItem();
      Object.assign(p, { tipus: "caselles", obligatori: it.isRequired(), opcions: it.getChoices().map((c) => c.getValue()), altres: it.hasOtherOption() });
    }
    else if (t === T.SCALE) {
      const it = item.asScaleItem();
      const opcions = [];
      for (let n = it.getLowerBound(); n <= it.getUpperBound(); n++) opcions.push(String(n));
      Object.assign(p, { tipus: "opcio", obligatori: it.isRequired(), opcions });
    }
    else if (t === T.FILE_UPLOAD) { p.tipus = "fitxers"; }
    return p;
  }).filter((p) => p.tipus);
}

function carpeta() {
  const it = DriveApp.getFoldersByName(NOM_CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NOM_CARPETA);
}

function normalitza(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
