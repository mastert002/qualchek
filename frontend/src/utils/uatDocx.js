import PizZip from 'pizzip';

// Fills the UAT sign-off template (public/templates/uat-signoff-template.docx)
// with the selected test cases. The template's own paragraphs, table styling
// and logo are kept; only the text in them changes, and one copy of the
// heading and table is produced per suite.
const TEMPLATE_URL = '/templates/uat-signoff-template.bin';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const runsOf = p => Array.from(p.childNodes).filter(n => n.nodeType === 1 && n.localName === 'r');
const textOf = node => Array.from(node.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join('');

// Put `value` in the paragraph's first run (keeping its formatting) and drop
// the rest. Used for paragraphs that are plain text.
function setRunText(p, value) {
  const runs = runsOf(p);
  if (runs.length === 0) return;
  runs.slice(1).forEach(r => p.removeChild(r));
  const ts = Array.from(runs[0].getElementsByTagNameNS(W, 't'));
  ts.slice(1).forEach(t => t.parentNode.removeChild(t));
  if (ts.length) ts[0].textContent = value;
  else {
    const t = runs[0].ownerDocument.createElementNS(W, 'w:t');
    t.textContent = value;
    runs[0].appendChild(t);
  }
}

// For "Label: value" paragraphs. The first run is the label and is kept; the
// value runs after it are replaced by one run holding `value`.
function setLabelValue(p, value) {
  const runs = runsOf(p);
  if (runs.length < 2) return;
  const valueRun = runs[1];
  runs.slice(2).forEach(r => p.removeChild(r));
  const ts = Array.from(valueRun.getElementsByTagNameNS(W, 't'));
  ts.slice(1).forEach(t => t.parentNode.removeChild(t));
  // Some labels end in a space ("Project: "), others don't ("Name:").
  const spacer = /\s$/.test(textOf(runs[0])) ? '' : ' ';
  if (ts.length) ts[0].textContent = value ? `${spacer}${value}` : '';
}

function setCellText(cell, value) {
  const p = cell.getElementsByTagNameNS(W, 'p')[0];
  setRunText(p, value);
  // A cell can hold more than one paragraph in the template; keep just one.
  Array.from(cell.getElementsByTagNameNS(W, 'p')).slice(1).forEach(extra => extra.parentNode.removeChild(extra));
}

const groupBySuite = cases => {
  const groups = new Map();
  for (const tc of cases) {
    const key = tc.suite_name || 'No suite';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tc);
  }
  return [...groups.entries()];
};

const todayDMY = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export async function buildUatDocx(cases, { projectName, preparedBy }) {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error('UAT template could not be loaded');
  const zip = new PizZip(await res.arrayBuffer());
  const doc = new DOMParser().parseFromString(zip.file('word/document.xml').asText(), 'application/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const kids = () => Array.from(body.childNodes).filter(n => n.nodeType === 1);

  const paragraphs = kids().filter(n => n.localName === 'p');
  const findPara = prefix => paragraphs.find(p => textOf(p).startsWith(prefix));

  // Header block
  setLabelValue(findPara('Project:'), projectName);
  setLabelValue(findPara('Prepared by:'), preparedBy);
  // The template has two "Date:" lines: the header date and the sign-off date.
  const [headerDate, signOffDate] = paragraphs.filter(p => textOf(p).startsWith('Date:'));
  setLabelValue(headerDate, todayDMY());

  // Statement and sign-off block. The sign-off fields are left blank for the
  // people who sign; the template's own signatory details are removed.
  setRunText(findPara('I have reviewed'),
    `I have reviewed and tested ${projectName} and confirm that the feature meets the agreed business requirements and is approved for production deployment.`);
  setLabelValue(findPara('Name:'), '');
  setLabelValue(findPara('Department:'), '');
  setLabelValue(findPara('Unit:'), '');
  setLabelValue(signOffDate, '');
  const sigPara = findPara('Signature:');
  if (sigPara) runsOf(sigPara).filter(r => r.getElementsByTagNameNS(W, 'drawing').length).forEach(r => sigPara.removeChild(r));

  // Task table: one heading and table per suite
  const headingTemplate = findPara('Create Advert');
  const tableTemplate = kids().find(n => n.localName === 'tbl');
  const rowTemplate = tableTemplate.getElementsByTagNameNS(W, 'tr')[1];
  const spacer = tableTemplate.nextElementSibling; // blank paragraph after the table

  const outputs = [];
  let sn = 0;
  for (const [suite, items] of groupBySuite(cases)) {
    const heading = headingTemplate.cloneNode(true);
    setRunText(heading, suite);

    const table = tableTemplate.cloneNode(true);
    const rows = Array.from(table.getElementsByTagNameNS(W, 'tr'));
    rows.slice(1).forEach(r => table.removeChild(r));
    for (const tc of items) {
      sn += 1;
      const row = rowTemplate.cloneNode(true);
      const cells = Array.from(row.getElementsByTagNameNS(W, 'tc'));
      setCellText(cells[0], String(sn));
      setCellText(cells[1], tc.title || '');
      setCellText(cells[2], '');
      setCellText(cells[3], '');
      table.appendChild(row);
    }
    outputs.push(heading, table, spacer.cloneNode(true));
  }

  body.removeChild(headingTemplate);
  body.removeChild(tableTemplate);
  for (const node of outputs) body.insertBefore(node, spacer);

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generate({ type: 'blob', mimeType: DOCX_TYPE });
}
