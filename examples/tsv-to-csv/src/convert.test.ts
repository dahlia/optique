import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveOutputPath, tsvToCsv } from "./convert.ts";

describe("tsvToCsv()", () => {
  it("converts rows and fields", () => {
    assert.equal(tsvToCsv("name\tage\nAda\t36\n"), "name,age\nAda,36\n");
  });

  it("does not add an empty row for a final line break", () => {
    assert.equal(tsvToCsv("a\tb"), "a,b\n");
    assert.equal(tsvToCsv("a\tb\n"), "a,b\n");
    assert.equal(tsvToCsv("a\tb\r\nc\td\r\n"), "a,b\nc,d\n");
  });

  it("keeps empty input and empty fields", () => {
    assert.equal(tsvToCsv(""), "");
    assert.equal(tsvToCsv("\t\n"), ",\n");
    assert.equal(tsvToCsv("\n\n"), "\n\n");
  });

  it("quotes fields with commas, quotes, or carriage returns", () => {
    assert.equal(
      tsvToCsv('Lovelace, Ada\tsaid "hi"\tplain\n'),
      '"Lovelace, Ada","said ""hi""",plain\n',
    );
    assert.equal(tsvToCsv("a\rb\tc\n"), '"a\rb",c\n');
  });
});

describe("deriveOutputPath()", () => {
  it("replaces a .tsv extension", () => {
    assert.equal(deriveOutputPath("data.tsv"), "data.csv");
    assert.equal(deriveOutputPath("dir/Data.TSV"), "dir/Data.csv");
  });

  it("appends .csv to other names", () => {
    assert.equal(deriveOutputPath("data.txt"), "data.txt.csv");
    assert.equal(deriveOutputPath("data"), "data.csv");
    assert.equal(deriveOutputPath("data.csv"), "data.csv.csv");
  });
});
