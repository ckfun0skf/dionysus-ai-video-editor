/**
 * P91: a small, forgiving XML reader for MusicXML import (the domain layer has no DOM). Elements, attributes and text
 * only: the prolog, DOCTYPE, comments and processing instructions are skipped, CDATA becomes text, the five named
 * entities and numeric character references are decoded. Not a validating parser.
 */
export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

export class XmlError extends Error {}

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; }
  return ENT[e] ?? m;
});

/** Parse XML text into its root element. Throws XmlError on unbalanced tags. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const chunk = lt < 0 ? text.slice(i) : text.slice(i, lt);
    if (chunk) stack[stack.length - 1].text += decodeEntities(chunk);
    if (lt < 0) break;
    if (text.startsWith("<!--", lt)) { const e = text.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith("<![CDATA[", lt)) { const e = text.indexOf("]]>", lt + 9); stack[stack.length - 1].text += text.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith("<?", lt)) { const e = text.indexOf("?>", lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (text.startsWith("<!", lt)) {
      // DOCTYPE (may hold an internal subset in [ … ]).
      let j = lt + 2, depth = 0;
      for (; j < n; j++) { const c = text[j]; if (c === "[") depth++; else if (c === "]") depth--; else if (c === ">" && depth <= 0) break; }
      i = j + 1; continue;
    }
    // Find the tag end, skipping ">" inside quoted attribute values.
    let j = lt + 1, q = "";
    for (; j < n; j++) { const c = text[j]; if (q) { if (c === q) q = ""; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; }
    if (j >= n) throw new XmlError("Unclosed tag at the end of the file.");
    const body = text.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "/") {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top || top === root || top.name !== name) throw new XmlError(`Unexpected </${name}>.`);
      continue;
    }
    const selfClose = body.endsWith("/");
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) throw new XmlError("A tag without a name.");
    const node: XmlNode = { name: m[1], attrs: {}, children: [], text: "" };
    const ar = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    const rest = body.slice(m[1].length);
    while ((a = ar.exec(rest))) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? "");
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length > 1) throw new XmlError(`<${stack[stack.length - 1].name}> is never closed.`);
  const top = root.children[0];
  if (!top) throw new XmlError("No XML element found.");
  return top;
}

/** First child element with a name. */
export const child = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name);
/** All child elements with a name. */
export const kids = (n: XmlNode | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? [];
/** Trimmed text of a child element (or undefined). */
export const childText = (n: XmlNode | undefined, name: string) => { const c = child(n, name); return c ? c.text.trim() : undefined; };
