/**
 * Script di build.
 *
 *   npm run build   → build di produzione (minificata) in dist/
 *   npm run watch   → ricompila a ogni salvataggio, con source map
 *
 * Passi:
 *   1. svuota dist/ (così non restano file vecchi di build precedenti);
 *   2. copia tutto il contenuto di static/ in dist/ (manifest, popup.html,
 *      popup.css, icone);
 *   3. compila con esbuild i tre punti di ingresso, ognuno in UN SOLO file
 *      autonomo (niente chunk condivisi: le estensioni non sanno caricarli).
 *
 * Nota: in modalità watch vengono ricompilati solo i file TypeScript.
 * Se modifichi qualcosa in static/ (manifest, html, css), rilancia il comando.
 */
import * as esbuild from "esbuild";
import { cp, rm, mkdir, access } from "node:fs/promises";

const watch = process.argv.includes("--watch");

await rm("dist", { recursive: true, force: true });
await mkdir("dist");
await cp("static", "dist", { recursive: true });

try {
  await access("static/assets/icon128.png");
} catch {
  console.warn(
    "\n⚠  Icone mancanti: copia la cartella assets della vecchia dist in static/assets\n" +
      "   (servono icon16.png, icon32.png, icon128.png), altrimenti Chrome rifiuta l'estensione.\n"
  );
}

const context = await esbuild.context({
  entryPoints: {
    // script che gira DENTRO la pagina di Netflix (world: MAIN)
    "scripts/page": "src/page/main.ts",
    // content script "isolato": ponte tra pagina e chrome.storage
    "scripts/content": "src/content/bridge.ts",
    // finestrella che si apre cliccando l'icona dell'estensione
    "scripts/popup": "src/popup/popup.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome111",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});

if (watch) {
  await context.watch();
  console.log("In ascolto delle modifiche… (Ctrl+C per uscire)");
} else {
  await context.rebuild();
  await context.dispose();
}
