import WebSocket from "ws";
import fs from "node:fs";

const API_KEY = process.env.AISSTREAM_API_KEY;
const STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const MAX_MESSAGES = Number(process.env.MAX_MESSAGES ?? 5);
const MESSAGE_TIMEOUT_MS = 20000;
const BLACK_SEA_BOUNDING_BOX = [
  [27.0, 40.5],
  [42.5, 47.5]
];
const OUTPUT_FILE = process.env.OUTPUT_FILE;

if (!API_KEY) {
  console.error("Missing AISSTREAM_API_KEY environment variable.");
  process.exit(1);
}

if (OUTPUT_FILE) {
  fs.writeFileSync(OUTPUT_FILE, "");
}

const socket = new WebSocket(STREAM_URL);
let messageCount = 0;
let isClosing = false;

const timeout = setTimeout(() => {
  console.error(`No messages received within ${MESSAGE_TIMEOUT_MS / 1000} seconds.`);
  socket.close();
}, MESSAGE_TIMEOUT_MS);

socket.addEventListener("open", () => {
  const subscriptionMessage = {
    APIKey: API_KEY,
    BoundingBoxes: [
      BLACK_SEA_BOUNDING_BOX
    ]
  };

  console.log("Connected to AIS Stream.");
  console.log("Sending subscription:");
  console.log(JSON.stringify(subscriptionMessage, null, 2));
  socket.send(JSON.stringify(subscriptionMessage));
});

socket.addEventListener("error", (event) => {
  console.error("WebSocket error:", event.message ?? event);
});

socket.addEventListener("close", (event) => {
  clearTimeout(timeout);
  console.log(`Connection closed. Code: ${event.code}, reason: ${event.reason || "none"}`);
});

socket.addEventListener("message", (event) => {
  if (isClosing) {
    return;
  }

  clearTimeout(timeout);
  messageCount += 1;

  try {
    const aisMessage = JSON.parse(event.data);

    if (OUTPUT_FILE) {
      fs.appendFileSync(OUTPUT_FILE, `${JSON.stringify(aisMessage)}\n`);
    }

    console.log(`\nMessage #${messageCount}`);
    console.log("Top-level keys:", Object.keys(aisMessage));
    console.log("MessageType:", aisMessage.MessageType ?? "unknown");

    if (aisMessage.MessageType === "PositionReport") {
      const positionReport = aisMessage.Message?.PositionReport;

      console.log("PositionReport sample:");
      console.log(
        JSON.stringify(
          {
            userId: positionReport?.UserID,
            latitude: positionReport?.Latitude,
            longitude: positionReport?.Longitude,
            sog: positionReport?.Sog,
            cog: positionReport?.Cog,
            trueHeading: positionReport?.TrueHeading,
            navigationalStatus: positionReport?.NavigationalStatus
          },
          null,
          2
        )
      );
    } else {
      console.log("Raw message sample:");
      console.log(JSON.stringify(aisMessage, null, 2));
    }
  } catch (error) {
    console.error("Failed to parse message:", error);
    console.log("Raw payload:");
    console.log(String(event.data));
  }

  if (messageCount >= MAX_MESSAGES) {
    isClosing = true;
    console.log(`\nReceived ${MAX_MESSAGES} messages, closing connection.`);
    socket.close();
  }
});
