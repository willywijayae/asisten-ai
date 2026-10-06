// Render teks analisa (markdown dari AI) jadi tampilan rapi tanpa simbol markdown. Tanpa library.
import type { ReactNode } from "react";

function inline(t: string): ReactNode[] {
  // **tebal**, *miring*, `kode` → hanya gaya, simbolnya dibuang.
  return t.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g).filter(Boolean).map((p, i) => {
    if (p.startsWith("**")) return <strong key={i} className="font-semibold text-fg">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`")) return <span key={i} className="font-medium text-fg">{p.slice(1, -1)}</span>;
    if (p.startsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function ReadableText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => out.length;
  while (i < lines.length) {
    const l = lines[i];
    const t = l.trim();
    if (!t || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) { i++; continue; }
    if (t.startsWith("```")) {
      const buf: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) buf.push(lines[i]);
      i++;
      out.push(<p key={key()} className="rounded-xl bg-surface-2 px-4 py-2.5 font-medium">{buf.join(" ").replace(/\s+/g, " ").trim()}</p>);
      continue;
    }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const txt = h[2].replace(/\*\*/g, "");
      out.push(lvl <= 2
        ? <h3 key={key()} className="mt-6 border-b border-line pb-2 text-lg font-bold first:mt-0">{txt}</h3>
        : <h4 key={key()} className="mt-4 text-base font-semibold">{txt}</h4>);
      i++; continue;
    }
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        if (/^\|?[\s:|-]+\|?$/.test(lines[i].trim())) continue;
        rows.push(cells(lines[i]));
      }
      const [head, ...body] = rows;
      // Tabel 2 kolom dibaca sebagai daftar "label: isi"; lebih dari itu tetap tabel bersih.
      out.push(
        <div key={key()} className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2"><tr>{head.map((c, k) => <th key={k} className="px-3 py-2 font-semibold">{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k} className="border-t border-line">{r.map((c, j) => <td key={j} className={`px-3 py-2 ${j === 0 ? "font-medium" : ""}`}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (t.startsWith(">")) {
      const buf: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith(">"); i++) buf.push(lines[i].trim().replace(/^>\s?/, ""));
      out.push(<p key={key()} className="rounded-xl bg-surface-2 px-4 py-3">{inline(buf.join(" "))}</p>);
      continue;
    }
    if (/^([-*•]|\d+[.)])\s+/.test(t)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]); i++) items.push(lines[i].trim().replace(/^([-*•]|\d+[.)])\s+/, ""));
      out.push(<ul key={key()} className="space-y-1.5 pl-1">{items.map((x, k) => <li key={k} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted" aria-hidden /><span>{inline(x)}</span></li>)}</ul>);
      continue;
    }
    out.push(<p key={key()}>{inline(t)}</p>);
    i++;
  }
  return <div className="space-y-3 text-[15px] leading-relaxed text-fg">{out}</div>;
}
