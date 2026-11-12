import { extname } from "node:path";

/**
 * Converts tab-separated text to comma-separated text.
 *
 * Rows end with LF in the output.  A final line break in the input does not
 * produce an extra empty row, and CRLF input is accepted.  Fields that
 * contain a comma, a double quote, or a carriage return are quoted, with
 * embedded double quotes doubled, as described in RFC 4180.
 *
 * @param tsv The tab-separated input text.
 * @returns The equivalent comma-separated text.
 */
export function tsvToCsv(tsv: string): string {
  if (tsv === "") return "";
  const lines = tsv.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines
    .map((line) => line.split("\t").map(quoteField).join(","))
    .map((row) => `${row}\n`)
    .join("");
}

function quoteField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/**
 * Derives the default output path for an input path.
 *
 * A `.tsv` extension, in any letter case, is replaced with `.csv`.  Any other
 * name gets `.csv` appended, so the derived path never equals the input path.
 *
 * @param input The input file path.
 * @returns The output file path next to the input.
 */
export function deriveOutputPath(input: string): string {
  const extension = extname(input);
  const stem = extension.toLowerCase() === ".tsv"
    ? input.slice(0, -extension.length)
    : input;
  return `${stem}.csv`;
}
