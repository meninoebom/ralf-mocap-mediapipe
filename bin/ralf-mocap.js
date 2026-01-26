#!/usr/bin/env node

import { Command } from "commander";
import open from "open";
import { createApp } from "../src/server/index.js";

const program = new Command();

program
  .name("ralf-mocap-mp")
  .description("Motion capture CLI using MediaPipe Pose and OSC")
  .version("0.1.0");

program
  .command("start")
  .description("Start the motion capture server")
  .option("-p, --port <port>", "OSC output port for Wekinator", "6448")
  .option("--http-port <port>", "HTTP server port", "3000")
  .option("--no-open", "Don't auto-open browser")
  .option("-d, --debug", "Log OSC messages to console")
  .option("-u, --upper-body", "Use upper body mode (13 keypoints, 26 floats)")
  .option("-c, --core", "Use core mode (13 keypoints, 26 floats) - no face/hand/foot detail")
  .action(async (options) => {
    const oscPort = parseInt(options.port, 10);
    const httpPort = parseInt(options.httpPort, 10);
    const shouldOpen = options.open;
    const debug = options.debug || false;

    let mode = "fullBody";
    if (options.upperBody) mode = "upperBody";
    if (options.core) mode = "core";

    console.log();
    console.log("  ╔═══════════════════════════════════════════╗");
    console.log("  ║      ralf-mocap-mediapipe v0.1.0          ║");
    console.log("  ╚═══════════════════════════════════════════╝");
    console.log();

    const { start, stop, getConfig } = createApp({ oscPort, httpPort, debug, mode });

    try {
      await start();

      const config = getConfig();
      const url = `http://localhost:${httpPort}`;
      console.log(`  📡 OSC output: localhost:${oscPort}`);
      console.log(`  🌐 Web server: ${url}`);
      console.log(`  📊 Monitor:    ${url}/monitor.html`);
      console.log(`  🦴 Mode:       ${config.modeName} (${config.keypointCount} keypoints, ${config.floatCount} floats)`);
      console.log(`  🧠 Model:      MediaPipe Pose Lite (33 landmarks, 3D)`);
      if (debug) {
        console.log(`  🔍 Debug mode: ON`);
      }
      console.log();
      console.log("  Press Ctrl+C to stop");
      console.log();

      if (shouldOpen) {
        await open(url);
      }

      // Graceful shutdown
      const shutdown = async () => {
        console.log("\n  Shutting down...");
        await stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (error) {
      console.error("  Error starting server:", error.message);
      process.exit(1);
    }
  });

// Default to start if no command given
if (process.argv.length === 2) {
  program.parse(["node", "ralf-mocap-mp", "start"]);
} else {
  program.parse();
}
