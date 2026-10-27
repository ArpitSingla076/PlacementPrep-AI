// Minimal valid PDF generator (used by tests): pages = array of arrays of text lines.
// Long lines are word-wrapped (like a real document): text positioned beyond the page edge is not extracted by PDF readers.
const wrap = (line, width = 90) => {
  const out = []; let cur = '';
  for (const w of String(line).split(' ')) {
    if (cur && (cur + ' ' + w).length > width) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur || !out.length) out.push(cur);
  return out;
};
export function makePdf(pages) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add('');            // 1
  const pagesObj = add('');           // 2
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3
  const kids = [];
  for (const lines of pages) {
    const stream = 'BT /F1 11 Tf 14 TL 50 740 Td ' + lines.flatMap((l) => wrap(l)).map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`).join(' ') + ' ET';
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const page = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    kids.push(`${page} 0 R`);
  }
  objs[catalog - 1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
