// RFC 4180 CSV parsing that reports, rather than hides, the quoting mistakes importers choke
// on. Rows are numbered as a spreadsheet shows them: the first record is row 1, and a blank
// line still takes up a row.

export interface CsvRecord {
  cells: string[];
  row: number;
}

export interface CsvIssue {
  kind: "quote-unexpected" | "quote-unterminated";
  row: number;
}

export interface ParsedCsv {
  records: CsvRecord[];
  issues: CsvIssue[];
}

/** "," unless semicolons outnumber commas in the first line (outside quotes). */
export function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (const ch of text) {
    if (ch === "\n" && !inQuotes) break;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ",") commas++;
    else if (!inQuotes && ch === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

/**
 * Parses CSV text. A quote is special only at the start of a field; a quote anywhere else
 * (`12" pizza`) or text after a closing quote (`"a"b`) is kept literally and reported, since
 * strict importers reject it. Blank lines are skipped but still counted.
 */
export function parseCsv(text: string, delimiter: "," | ";"): ParsedCsv {
  const records: CsvRecord[] = [];
  const issues: CsvIssue[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoted = false; // the current field started with a quote
  let row = 1;
  let quoteRow = 1;
  const report = (kind: CsvIssue["kind"], at: number) => {
    if (!issues.some((i) => i.kind === kind && i.row === at)) issues.push({ kind, row: at });
  };
  const endRecord = () => {
    cells.push(field);
    if (!(cells.length === 1 && cells[0].trim() === "" && !quoted)) records.push({ cells, row });
    row++;
    cells = [];
    field = "";
    quoted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
      continue;
    }
    if (ch === delimiter) {
      cells.push(field);
      field = "";
      quoted = false;
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      if (text[i + 1] !== "\n") endRecord();
    } else if (ch === '"' && field === "" && !quoted) {
      inQuotes = true;
      quoted = true;
      quoteRow = row;
    } else {
      if (ch === '"' || quoted) report("quote-unexpected", row);
      field += ch;
    }
  }
  if (inQuotes) report("quote-unterminated", quoteRow);
  if (field !== "" || cells.length || quoted) endRecord();
  return { records, issues };
}
