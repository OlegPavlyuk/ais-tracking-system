import fs from "node:fs";
import path from "node:path";

const inputFile = process.argv[2] ?? "raw-api-response.jsonl";
const outputFile = process.argv[3] ?? "api-response-readable.json";

const rawContent = fs.readFileSync(inputFile, "utf8").trim();

if (!rawContent) {
  console.error(`Input file is empty: ${inputFile}`);
  process.exit(1);
}

const messages = rawContent
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

function normalizeString(value) {
  if (/^[\u0000\u0001]+$/.test(value)) {
    return value.replace(/\u0000/g, "0").replace(/\u0001/g, "1");
  }

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    return Array.from(value, (char) => {
      const code = char.charCodeAt(0);

      if (code === 0) {
        return "0";
      }

      if (code === 1) {
        return "1";
      }

      if (code === 9) {
        return "\\t";
      }

      if (code === 10) {
        return "\\n";
      }

      if (code === 13) {
        return "\\r";
      }

      if (code >= 32 && code <= 126) {
        return char;
      }

      return `\\u${code.toString(16).padStart(4, "0")}`;
    }).join("");
  }

  return value.trimEnd();
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeValue(nestedValue)])
    );
  }

  if (typeof value === "string") {
    return normalizeString(value);
  }

  return value;
}

const messageTypes = Object.fromEntries(
  Object.entries(
    messages.reduce((accumulator, message) => {
      const type = message.MessageType ?? "unknown";
      accumulator[type] = (accumulator[type] ?? 0) + 1;
      return accumulator;
    }, {})
  ).sort(([left], [right]) => left.localeCompare(right))
);

const readableOutput = {
  generatedAtUtc: new Date().toISOString(),
  sourceFile: path.resolve(inputFile),
  messageCount: messages.length,
  messageTypes,
  messages: messages.map((message, index) => ({
    index: index + 1,
    MessageType: message.MessageType ?? "unknown",
    original: message,
    humanReadable: normalizeValue(message)
  }))
};

fs.writeFileSync(outputFile, `${JSON.stringify(readableOutput, null, 2)}\n`);

console.log(`Readable JSON written to ${outputFile}`);
