import { zipSync } from "fflate";

/** ZIP aus Dateiliste; `webkitRelativePath` bleibt im Archiv erhalten (Ordnerwahl). */
export async function buildZipFromFiles(files: File[]): Promise<{ u8: Uint8Array; archiveName: string }> {
  if (files.length === 0) throw new Error("empty_file_list");

  const obj: Record<string, Uint8Array> = {};

  for (const f of files) {
    let rel = f.webkitRelativePath?.replace(/\\/g, "/").trim();
    if (!rel) rel = (f.name || "unnamed").replace(/\\/g, "/").trim() || "unnamed";

    let zipPath = rel;
    let n = 1;
    while (obj[zipPath]) {
      const lastSlash = rel.lastIndexOf("/");
      const baseDir = lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : "";
      const leaf = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
      const dot = leaf.lastIndexOf(".");
      if (dot > 0) {
        zipPath = `${baseDir}${leaf.slice(0, dot)}_${n}${leaf.slice(dot)}`;
      } else {
        zipPath = `${baseDir}${leaf}_${n}`;
      }
      n += 1;
    }

    const buf = await f.arrayBuffer();
    obj[zipPath] = new Uint8Array(buf);
  }

  const u8 = zipSync(obj, { level: 6 });

  const first = files[0];
  let archiveName = `Helles-${files.length}-Dateien.zip`;
  if (first?.webkitRelativePath) {
    const root = first.webkitRelativePath.split("/")[0]?.trim();
    if (root) archiveName = `${root}.zip`;
  } else if (files.length === 1) {
    const base = (first.name || "datei").replace(/\.[^/.]+$/, "") || "datei";
    archiveName = `${base}.zip`;
  }

  return { u8, archiveName };
}
