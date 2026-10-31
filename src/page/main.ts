/**
 * PUNTO DI INGRESSO DELLO SCRIPT DELLA PAGINA
 *
 * Gira dentro la pagina di Netflix ("world": "MAIN") a document_start,
 * cioè prima di qualsiasi script di Netflix. L'ordine conta:
 *
 *  1. installManifestInterceptor: SUBITO e in modo sincrono, altrimenti
 *     potremmo perdere il primo manifest (se apri direttamente un link
 *     /watch/…);
 *  2. watchUrlChanges: per accorgerci della navigazione interna;
 *  3. un primo handleUrlChange quando il DOM è pronto, nel caso la pagina
 *     sia già /watch/….
 *
 * Il resto del flusso è descritto in core/Controller.ts.
 */
import { Controller } from "./core/Controller";
import { log } from "./log";
import { installManifestInterceptor } from "./netflix/manifestInterceptor";
import { watchUrlChanges } from "./netflix/navigation";
import { SettingsClient } from "./settingsClient";

const LOADED_FLAG = "__dualSubsLoaded";

function main(): void {
  // Protezione contro un doppio caricamento dello script
  const w = window as unknown as Record<string, unknown>;
  if (w[LOADED_FLAG]) return;
  w[LOADED_FLAG] = true;

  const settings = new SettingsClient();
  const controller = new Controller(settings);

  installManifestInterceptor((manifest) => controller.handleManifest(manifest));
  watchUrlChanges(() => controller.handleUrlChange());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => controller.handleUrlChange(), { once: true });
  } else {
    controller.handleUrlChange();
  }

  log.info("estensione avviata");
}

main();
