import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createOscSender, MODES, KEYPOINT_NAMES } from "./osc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create and configure the Express + Socket.io server.
 */
export function createApp(options = {}) {
  const { oscPort = 6448, httpPort = 3000, debug = false, mode = "fullBody" } = options;

  // Get enabled keypoints for the selected mode
  const modeConfig = MODES[mode] || MODES.fullBody;
  const enabledKeypoints = modeConfig.keypoints;
  const keypointCount = enabledKeypoints.size;
  const floatCount = keypointCount * 2;

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);

  // Serve static files from public directory
  const publicPath = path.join(__dirname, "../public");
  app.use(express.static(publicPath));

  // Create OSC sender with mode config
  const sendOsc = createOscSender(oscPort, "localhost", { debug, enabledKeypoints });

  // Track message stats
  let messageCount = 0;
  let lastPose = null;
  let lastRateLog = Date.now();
  let messagesThisPeriod = 0;

  // Socket.io connection handler
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id, "- Total clients:", io.engine.clientsCount);

    // Send current config to clients
    socket.emit("config", {
      oscPort,
      httpPort,
      debug,
      mode,
      modeName: modeConfig.name,
      keypointCount,
      floatCount,
    });

    // Send last pose to new clients
    if (lastPose) {
      socket.emit("pose", lastPose);
    }

    socket.on("pose", (pose) => {
      if (!pose || !pose.landmarks) return;

      lastPose = pose;
      messageCount++;
      messagesThisPeriod++;

      // Log rate every 5 seconds
      const now = Date.now();
      if (now - lastRateLog >= 5000) {
        const rate = (messagesThisPeriod / ((now - lastRateLog) / 1000)).toFixed(1);
        console.log(`Server receiving ${rate} poses/sec (total: ${messageCount})`);
        messagesThisPeriod = 0;
        lastRateLog = now;
      }

      // Send OSC
      sendOsc(pose);

      // Broadcast to all monitor clients
      io.emit("pose", pose);
      io.emit("stats", { messageCount });
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id, "- Remaining clients:", io.engine.clientsCount - 1);
    });
  });

  function start() {
    return new Promise((resolve) => {
      httpServer.listen(httpPort, () => {
        resolve({ httpPort, oscPort });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      io.close();
      httpServer.close(resolve);
    });
  }

  function getConfig() {
    return { mode, modeName: modeConfig.name, keypointCount, floatCount };
  }

  return { app, httpServer, io, start, stop, getConfig };
}
