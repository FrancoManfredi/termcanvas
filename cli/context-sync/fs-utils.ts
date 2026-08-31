// Operaciones de árbol de archivos para la sincronización de contexto.
// Las claves de archivo son paths relativos con separador "/" (canónico
// entre Windows y Unix); al escribir a disco se convierten al separator
// local.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function toKey(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).join("/");
}

function fromKey(root: string, key: string): string {
  return path.join(root, ...key.split("/"));
}

/** Lista los archivos (y symlinks) bajo root como claves relativas. Vacío si root no existe. */
export function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        out.push(toKey(root, full));
      }
    }
  };
  visit(root);
  return out.sort();
}

export function hashFile(fullPath: string): string | null {
  try {
    return crypto
      .createHash("sha256")
      .update(fs.readFileSync(fullPath))
      .digest("hex");
  } catch {
    return null;
  }
}

export interface TreeDiff {
  /** Solo en a. */
  onlyA: string[];
  /** Solo en b. */
  onlyB: string[];
  /** En ambos con contenido distinto. */
  changed: string[];
}

/** Compara dos árboles por clave relativa + hash de contenido. */
export function diffTrees(aRoot: string, bRoot: string): TreeDiff {
  const aFiles = new Set(listFilesRecursive(aRoot));
  const bFiles = new Set(listFilesRecursive(bRoot));

  const onlyA: string[] = [];
  const changed: string[] = [];

  for (const key of aFiles) {
    if (!bFiles.has(key)) {
      onlyA.push(key);
      continue;
    }
    const ha = hashFile(fromKey(aRoot, key));
    const hb = hashFile(fromKey(bRoot, key));
    if (ha !== hb) changed.push(key);
  }

  const onlyB = [...bFiles].filter((k) => !aFiles.has(k)).sort();
  return { onlyA, onlyB, changed };
}

export function copyFileEnsuring(src: string, dst: string): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

/**
 * Espeja srcRoot sobre dstRoot: copia archivos nuevos/cambiados y ELIMINA
 * del destino lo que ya no existe en el origen. Se usa solo en push, donde
 * el destino es el subtree exclusivo del proyecto dentro del sidecar — la
 * eliminación propaga borrados locales al repo remoto.
 */
export function copyTreeMirror(
  srcRoot: string,
  dstRoot: string,
): { copied: string[]; deleted: string[] } {
  const copied: string[] = [];
  const deleted: string[] = [];

  fs.mkdirSync(dstRoot, { recursive: true });

  const srcKeys = new Set(listFilesRecursive(srcRoot));

  // Borrado: cualquier entrada del destino que no esté en el origen.
  for (const key of listFilesRecursive(dstRoot)) {
    if (!srcKeys.has(key)) {
      fs.rmSync(fromKey(dstRoot, key), { force: true });
      deleted.push(key);
    }
  }
  pruneEmptyDirs(dstRoot);

  // Copia: nuevo o contenido distinto.
  for (const key of listFilesRecursive(srcRoot)) {
    const src = fromKey(srcRoot, key);
    const dst = fromKey(dstRoot, key);
    if (!fs.existsSync(dst) || hashFile(dst) !== hashFile(src)) {
      copyFileEnsuring(src, dst);
      copied.push(key);
    }
  }

  return { copied, deleted };
}

/** Elimina directorios vacíos bajo root (sin tocar root mismo). Post-order DFS. */
function pruneEmptyDirs(root: string): void {
  const visit = (dir: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let isEmpty = true;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const full = path.join(dir, entry.name);
        if (!visit(full)) isEmpty = false;
      } else {
        isEmpty = false;
      }
    }
    if (isEmpty && dir !== root) {
      try {
        fs.rmdirSync(dir);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };
  visit(root);
}
