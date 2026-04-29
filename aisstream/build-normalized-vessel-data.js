import fs from "node:fs";
import path from "node:path";

const inputFile = process.argv[2] ?? "raw-api-response.jsonl";
const outputFile = process.argv[3] ?? "normalized-vessel-data.json";

const rawContent = fs.readFileSync(inputFile, "utf8").trim();

if (!rawContent) {
  console.error(`Input file is empty: ${inputFile}`);
  process.exit(1);
}

const messages = rawContent
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const INCLUDED_TYPES = new Set([
  "PositionReport",
  "StandardClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport"
]);

function normalizeShipName(name) {
  if (typeof name !== "string") {
    return null;
  }

  const trimmed = name.trim();
  return trimmed || null;
}

function normalizeHeading(value) {
  if (typeof value !== "number") {
    return null;
  }

  return value === 511 ? null : value;
}

function normalizeCog(value) {
  if (typeof value !== "number") {
    return null;
  }

  return value >= 360 ? null : value;
}

function normalizeSog(value) {
  if (typeof value !== "number") {
    return null;
  }

  return value >= 102.3 ? null : value;
}

function normalizeNavigationalStatus(value) {
  if (typeof value !== "number") {
    return null;
  }

  return value === 15 ? null : value;
}

function normalizeCoordinate(value) {
  if (typeof value !== "number") {
    return null;
  }

  return value;
}

function getShipTypeFromStaticDataReport(report) {
  if (!report?.ReportB?.Valid) {
    return null;
  }

  return typeof report.ReportB.ShipType === "number" ? report.ReportB.ShipType : null;
}

function getCallSignFromStaticDataReport(report) {
  if (!report?.ReportB?.Valid) {
    return null;
  }

  return normalizeShipName(report.ReportB.CallSign);
}

function getDimensionsFromStaticDataReport(report) {
  if (!report?.ReportB?.Valid) {
    return null;
  }

  return report.ReportB.Dimension ?? null;
}

function normalizeRecord(message, index) {
  const type = message.MessageType;
  const meta = message.MetaData ?? {};

  if (!INCLUDED_TYPES.has(type)) {
    return null;
  }

  if (type === "PositionReport") {
    const payload = message.Message?.PositionReport ?? {};

    return {
      index: index + 1,
      sourceFile: path.resolve(inputFile),
      messageType: type,
      sourceClass: "dynamic",
      mmsi: meta.MMSI ?? payload.UserID ?? null,
      shipName: normalizeShipName(meta.ShipName),
      timestamp: meta.time_utc ?? null,
      latitude: normalizeCoordinate(payload.Latitude ?? meta.latitude),
      longitude: normalizeCoordinate(payload.Longitude ?? meta.longitude),
      sog: normalizeSog(payload.Sog),
      cog: normalizeCog(payload.Cog),
      trueHeading: normalizeHeading(payload.TrueHeading),
      navigationalStatus: normalizeNavigationalStatus(payload.NavigationalStatus),
      imoNumber: null,
      callSign: null,
      shipType: null,
      destination: null,
      dimensions: null,
      rawMessageType: type
    };
  }

  if (type === "StandardClassBPositionReport") {
    const payload = message.Message?.StandardClassBPositionReport ?? {};

    return {
      index: index + 1,
      sourceFile: path.resolve(inputFile),
      messageType: type,
      sourceClass: "dynamic",
      mmsi: meta.MMSI ?? payload.UserID ?? null,
      shipName: normalizeShipName(meta.ShipName),
      timestamp: meta.time_utc ?? null,
      latitude: normalizeCoordinate(payload.Latitude ?? meta.latitude),
      longitude: normalizeCoordinate(payload.Longitude ?? meta.longitude),
      sog: normalizeSog(payload.Sog),
      cog: normalizeCog(payload.Cog),
      trueHeading: normalizeHeading(payload.TrueHeading),
      navigationalStatus: null,
      imoNumber: null,
      callSign: null,
      shipType: null,
      destination: null,
      dimensions: null,
      rawMessageType: type
    };
  }

  if (type === "ShipStaticData") {
    const payload = message.Message?.ShipStaticData ?? {};

    return {
      index: index + 1,
      sourceFile: path.resolve(inputFile),
      messageType: type,
      sourceClass: "static",
      mmsi: meta.MMSI ?? payload.UserID ?? null,
      shipName: normalizeShipName(payload.Name) ?? normalizeShipName(meta.ShipName),
      timestamp: meta.time_utc ?? null,
      latitude: normalizeCoordinate(meta.latitude),
      longitude: normalizeCoordinate(meta.longitude),
      sog: null,
      cog: null,
      trueHeading: null,
      navigationalStatus: null,
      imoNumber: typeof payload.ImoNumber === "number" && payload.ImoNumber !== 0 ? payload.ImoNumber : null,
      callSign: normalizeShipName(payload.CallSign),
      shipType: typeof payload.Type === "number" ? payload.Type : null,
      destination: normalizeShipName(payload.Destination),
      dimensions: payload.Dimension ?? null,
      rawMessageType: type
    };
  }

  if (type === "StaticDataReport") {
    const payload = message.Message?.StaticDataReport ?? {};

    return {
      index: index + 1,
      sourceFile: path.resolve(inputFile),
      messageType: type,
      sourceClass: "static",
      mmsi: meta.MMSI ?? payload.UserID ?? null,
      shipName: normalizeShipName(payload.ReportA?.Name) ?? normalizeShipName(meta.ShipName),
      timestamp: meta.time_utc ?? null,
      latitude: normalizeCoordinate(meta.latitude),
      longitude: normalizeCoordinate(meta.longitude),
      sog: null,
      cog: null,
      trueHeading: null,
      navigationalStatus: null,
      imoNumber: null,
      callSign: getCallSignFromStaticDataReport(payload),
      shipType: getShipTypeFromStaticDataReport(payload),
      destination: null,
      dimensions: getDimensionsFromStaticDataReport(payload),
      rawMessageType: type
    };
  }

  return null;
}

const records = messages
  .map(normalizeRecord)
  .filter(Boolean);

const vesselMap = new Map();

for (const record of records) {
  const key = String(record.mmsi ?? `unknown-${record.index}`);
  const existing = vesselMap.get(key) ?? {
    mmsi: record.mmsi,
    shipName: null,
    latestTimestamp: null,
    latestPosition: null,
    staticData: {
      imoNumber: null,
      callSign: null,
      shipType: null,
      destination: null,
      dimensions: null
    },
    seenMessageTypes: []
  };

  if (record.shipName && !existing.shipName) {
    existing.shipName = record.shipName;
  }

  if (!existing.seenMessageTypes.includes(record.messageType)) {
    existing.seenMessageTypes.push(record.messageType);
  }

  if (record.sourceClass === "dynamic") {
    existing.latestTimestamp = record.timestamp ?? existing.latestTimestamp;
    existing.latestPosition = {
      latitude: record.latitude,
      longitude: record.longitude,
      sog: record.sog,
      cog: record.cog,
      trueHeading: record.trueHeading,
      navigationalStatus: record.navigationalStatus
    };
  }

  if (record.sourceClass === "static") {
    existing.staticData = {
      imoNumber: record.imoNumber ?? existing.staticData.imoNumber,
      callSign: record.callSign ?? existing.staticData.callSign,
      shipType: record.shipType ?? existing.staticData.shipType,
      destination: record.destination ?? existing.staticData.destination,
      dimensions: record.dimensions ?? existing.staticData.dimensions
    };
  }

  vesselMap.set(key, existing);
}

const output = {
  generatedAtUtc: new Date().toISOString(),
  sourceFile: path.resolve(inputFile),
  totalInputMessages: messages.length,
  normalizedRecordCount: records.length,
  includedMessageTypes: Array.from(INCLUDED_TYPES).sort(),
  excludedMessageTypes: Array.from(
    new Set(messages.map((message) => message.MessageType).filter((type) => !INCLUDED_TYPES.has(type)))
  ).sort(),
  records,
  vessels: Array.from(vesselMap.values()).sort((left, right) => {
    const leftMmsi = left.mmsi ?? 0;
    const rightMmsi = right.mmsi ?? 0;
    return leftMmsi - rightMmsi;
  })
};

fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Normalized vessel data written to ${outputFile}`);
