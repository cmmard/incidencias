// App per comunicar incidències de manteniment.
// Les preguntes i opcions es llegeixen del Google Forms (via Apps Script)
// i cada incidència s'afegeix al mateix full que llegeix l'app de gestió.

const MAX_ADJUNTS = 5;
const MAX_VIDEO = 20 * 1024 * 1024; // 20 MB
const MAX_PX = 1600;                // costat màxim de les fotos
const CLAU_NOM = "incidencies-nom";
const CLAU_PREGUNTES = "incidencies-preguntes";

const estat = { preguntes: [], fitxers: {} };
const $ = (id) => document.getElementById(id);

/* ---------- Utilitats ---------- */

function el(tag, attrs = {}, ...fills) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...fills);
  return n;
}

function llegeixLocal(clau) {
  try { return localStorage.getItem(clau); } catch { return null; }
}

function desaLocal(clau, valor) {
  try { localStorage.setItem(clau, valor); } catch { /* sense emmagatzematge */ }
}

const dosDigits = (n) => String(n).padStart(2, "0");

function avui() {
  const d = new Date();
  return `${d.getFullYear()}-${dosDigits(d.getMonth() + 1)}-${dosDigits(d.getDate())}`;
}

function araHora() {
  const d = new Date();
  return `${dosDigits(d.getHours())}:${dosDigits(d.getMinutes())}`;
}

function mostraVista(id) {
  ["vistaCarregant", "vistaConfig", "vistaError", "formulari", "vistaEnviat"]
    .forEach((v) => ($(v).hidden = v !== id));
  window.scrollTo({ top: 0 });
}

function avis(text) {
  const a = $("avis");
  a.textContent = text;
  a.hidden = !text;
  if (text) a.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- Càrrega de preguntes ---------- */

async function inicia() {
  if (!URL_SCRIPT) {
    mostraVista("vistaConfig");
    return;
  }
  mostraVista("vistaCarregant");

  try {
    const resposta = await fetch(URL_SCRIPT);
    const dades = await resposta.json();
    if (!dades.ok) throw new Error(dades.error || "resposta no vàlida");
    estat.preguntes = dades.preguntes;
    desaLocal(CLAU_PREGUNTES, JSON.stringify(dades.preguntes));
  } catch (err) {
    const desades = llegeixLocal(CLAU_PREGUNTES);
    if (!desades) {
      $("textError").textContent = "Revisa la connexió a internet. (" + err.message + ")";
      mostraVista("vistaError");
      return;
    }
    estat.preguntes = JSON.parse(desades);
  }

  pintaFormulari();
  mostraVista("formulari");
}

/* ---------- Formulari ---------- */

function pintaFormulari() {
  estat.fitxers = {};
  avis("");
  $("camps").replaceChildren(...estat.preguntes.map(campPregunta));
}

function campPregunta(p, i) {
  const id = "q" + i;
  const esGrup = p.tipus === "opcio" || p.tipus === "caselles";
  const camp = el("div", { class: "camp", "data-pregunta": id });

  const titol = el(esGrup ? "p" : "label", { class: "camp__titol", for: esGrup ? null : id }, p.titol);
  if (p.obligatori) titol.append(el("span", { class: "obligatori", "aria-hidden": "true" }, " *"));
  camp.append(titol);
  if (p.ajuda) camp.append(el("p", { class: "camp__ajuda" }, p.ajuda));

  let control;
  switch (p.tipus) {
    case "text":
      control = el("input", { type: "text", id, name: id });
      if (/qui comunica|nom i llinatges/i.test(p.titol)) {
        control.value = llegeixLocal(CLAU_NOM) || "";
        control.autocomplete = "name";
        control.dataset.nom = "1";
      }
      break;
    case "paragraf":
      control = el("textarea", { id, name: id, rows: 4 });
      break;
    case "data":
      control = el("input", { type: "date", id, name: id, value: avui() });
      break;
    case "hora":
      control = el("input", { type: "time", id, name: id, value: araHora() });
      break;
    case "llista":
      control = el("select", { id, name: id },
        el("option", { value: "" }, "Tria una opció"),
        ...p.opcions.map((o) => el("option", { value: o }, o)));
      break;
    case "opcio":
    case "caselles":
      control = grupOpcions(p, id);
      break;
    case "fitxers":
      control = campFitxers(p, id);
      break;
  }
  camp.append(control);
  return camp;
}

function grupOpcions(p, id) {
  const multi = p.tipus === "caselles";
  const grup = el("div", { class: "opcions", role: multi ? "group" : "radiogroup", "aria-label": p.titol });

  p.opcions.forEach((o) => {
    grup.append(el("label", { class: "opcio" },
      el("input", { type: multi ? "checkbox" : "radio", name: id, value: o }),
      el("span", {}, o)));
  });

  if (p.altres) {
    const marca = el("input", { type: multi ? "checkbox" : "radio", name: id, value: "__altres" });
    const text = el("input", { type: "text", class: "opcio__altres", "data-altres": id, placeholder: "Altres…", "aria-label": "Altres" });
    text.addEventListener("input", () => { if (text.value) marca.checked = true; });
    grup.append(el("label", { class: "opcio" }, marca, el("span", {}, "Altres")), text);
  }
  return grup;
}

/* ---------- Fotos i vídeos ---------- */

function campFitxers(p, id) {
  estat.fitxers[p.titol] = [];
  const entrada = el("input", { type: "file", id, accept: "image/*,video/*", multiple: true, hidden: true });
  const boto = el("label", { for: id, class: "boto boto--sec" }, "📷 Afegeix fotos o vídeo");
  const llista = el("div", { class: "fitxers__llista" });

  entrada.addEventListener("change", async () => {
    const actuals = estat.fitxers[p.titol];
    for (const f of entrada.files) {
      if (actuals.length >= MAX_ADJUNTS) {
        alert(`Com a màxim ${MAX_ADJUNTS} fitxers.`);
        break;
      }
      try {
        actuals.push(await preparaFitxer(f));
      } catch (err) {
        alert(err.message);
      }
    }
    entrada.value = "";
    pintaFitxers(p.titol, llista);
  });

  return el("div", { class: "fitxers" }, entrada, boto, llista);
}

function pintaFitxers(titol, llista) {
  llista.replaceChildren(...estat.fitxers[titol].map((a, n) => {
    const vista = a.video
      ? el("video", { src: a.previ, muted: true, playsinline: true })
      : el("img", { src: a.previ, alt: a.nom });
    const treu = el("button", { type: "button", "aria-label": "Treu " + a.nom }, "✕");
    treu.addEventListener("click", () => {
      estat.fitxers[titol].splice(n, 1);
      pintaFitxers(titol, llista);
    });
    return el("div", { class: "miniatura" }, vista, treu);
  }));
}

function aBase64(blob) {
  return new Promise((ok, ko) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(",")[1]);
    lector.onerror = () => ko(new Error("No s'ha pogut llegir el fitxer."));
    lector.readAsDataURL(blob);
  });
}

async function preparaFitxer(f) {
  if (f.type.startsWith("image/")) return redueixImatge(f);
  if (f.type.startsWith("video/")) {
    if (f.size > MAX_VIDEO) throw new Error(`El vídeo «${f.name}» passa de 20 MB.`);
    return { nom: f.name, tipus: f.type, base64: await aBase64(f), previ: URL.createObjectURL(f), video: true };
  }
  throw new Error(`«${f.name}» no és una foto ni un vídeo.`);
}

async function redueixImatge(f) {
  const url = URL.createObjectURL(f);
  const img = await new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => ko(new Error(`No s'ha pogut obrir la foto «${f.name}».`));
    i.src = url;
  });
  const escala = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const llenc = document.createElement("canvas");
  llenc.width = Math.round(img.naturalWidth * escala);
  llenc.height = Math.round(img.naturalHeight * escala);
  llenc.getContext("2d").drawImage(img, 0, 0, llenc.width, llenc.height);
  const blob = await new Promise((ok) => llenc.toBlob(ok, "image/jpeg", 0.82));
  return { nom: f.name.replace(/\.[^.]+$/, "") + ".jpg", tipus: "image/jpeg", base64: await aBase64(blob), previ: url };
}

/* ---------- Enviament ---------- */

function recullRespostes() {
  const form = $("formulari");
  const respostes = {};
  const falten = [];
  form.querySelectorAll(".camp--error").forEach((c) => c.classList.remove("camp--error"));

  estat.preguntes.forEach((p, i) => {
    if (p.tipus === "fitxers") return;
    const id = "q" + i;
    let valor;

    if (p.tipus === "caselles") {
      valor = [...form.querySelectorAll(`input[name="${id}"]:checked`)].map((x) => x.value);
    } else if (p.tipus === "opcio") {
      valor = form.querySelector(`input[name="${id}"]:checked`)?.value || "";
    } else {
      valor = $(id).value.trim();
    }

    const textAltres = form.querySelector(`[data-altres="${id}"]`)?.value.trim() || "";
    if (Array.isArray(valor)) valor = valor.map((v) => (v === "__altres" ? textAltres : v)).filter(Boolean);
    else if (valor === "__altres") valor = textAltres;

    const buit = Array.isArray(valor) ? !valor.length : !valor;
    if (p.obligatori && buit) {
      falten.push(p.titol);
      form.querySelector(`[data-pregunta="${id}"]`).classList.add("camp--error");
    }
    respostes[p.titol] = valor;
  });

  return { respostes, falten };
}

async function envia(e) {
  e.preventDefault();
  const { respostes, falten } = recullRespostes();
  if (falten.length) {
    avis("Falten camps obligatoris: " + falten.join(" · "));
    return;
  }
  avis("");

  const adjunts = Object.entries(estat.fitxers).flatMap(([pregunta, llista]) =>
    llista.map((a) => ({ pregunta, nom: a.nom, tipus: a.tipus, base64: a.base64 })));

  const boto = $("btnEnviar");
  boto.disabled = true;
  boto.textContent = adjunts.length ? "Enviant fotos i dades…" : "Enviant…";

  try {
    const resposta = await fetch(URL_SCRIPT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ respostes, adjunts }),
    });
    const dades = await resposta.json();
    if (!dades.ok) throw new Error(dades.error || "error desconegut");

    const nom = document.querySelector("[data-nom]");
    if (nom && nom.value.trim()) desaLocal(CLAU_NOM, nom.value.trim());
    mostraVista("vistaEnviat");
  } catch (err) {
    avis("No s'ha pogut enviar la incidència (" + err.message + "). Comprova la connexió i torna-ho a provar.");
  } finally {
    boto.disabled = false;
    boto.textContent = "Envia la incidència";
  }
}

/* ---------- Esdeveniments ---------- */

$("formulari").addEventListener("submit", envia);
$("btnReintentar").addEventListener("click", inicia);
$("btnNova").addEventListener("click", () => {
  pintaFormulari();
  mostraVista("formulari");
});

inicia();
