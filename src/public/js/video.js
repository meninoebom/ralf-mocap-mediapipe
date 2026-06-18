// ralf-mocap MediaPipe: Pose detection with OSC output
// Uses MediaPipe Tasks Vision API

import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const SCORE_THRESHOLD = 0.5;

// --- One Euro Filter (same as app.js) ---
class LowPassFilter {
  constructor() { this.y = null; this.s = null; }
  filter(value, alpha) {
    if (this.y === null) { this.s = value; }
    else { this.s = alpha * value + (1 - alpha) * this.s; }
    this.y = value;
    return this.s;
  }
}

class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.lastTime = null;
  }
  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
  filter(value, timestamp) {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      return this.xFilter.filter(value, 1.0);
    }
    const dt = Math.max(timestamp - this.lastTime, 1e-6);
    this.lastTime = timestamp;
    const dValue = (value - (this.xFilter.s ?? value)) / dt;
    const edValue = this.dxFilter.filter(dValue, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.xFilter.filter(value, this.alpha(cutoff, dt));
  }
}

const landmarkFilters = Array.from({ length: 33 }, () => ({
  x: new OneEuroFilter(1.0, 0.007, 1.0),
  y: new OneEuroFilter(1.0, 0.007, 1.0),
  z: new OneEuroFilter(1.0, 0.007, 1.0),
}));

function smoothLandmarks(landmarks, timestamp) {
  return landmarks.map((lm, i) => ({
    x: landmarkFilters[i].x.filter(lm.x, timestamp),
    y: landmarkFilters[i].y.filter(lm.y, timestamp),
    z: landmarkFilters[i].z.filter(lm.z, timestamp),
    visibility: lm.visibility,
  }));
}

function isPlausiblePose(landmarks) {
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  const coreVisibility = Math.min(
    lShoulder.visibility, rShoulder.visibility,
    lHip.visibility, rHip.visibility
  );
  if (coreVisibility < 0.3) return false;
  const shoulderDist = Math.hypot(lShoulder.x - rShoulder.x, lShoulder.y - rShoulder.y);
  const hipDist = Math.hypot(lHip.x - rHip.x, lHip.y - rHip.y);
  if (shoulderDist < 0.02 || shoulderDist > 0.5) return false;
  const ratio = hipDist / shoulderDist;
  if (ratio < 0.3 || ratio > 1.5) return false;
  return true;
}

// DOM elements
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

// Socket.io connection
const socket = io();

socket.on("connect", () => {
  console.log("Connected to server");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  setStatus("Disconnected", "error");
});

// MediaPipe skeleton connections
const POSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],  // Left eye
  [0, 4], [4, 5], [5, 6], [6, 8],  // Right eye
  [9, 10],  // Mouth
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // Right leg
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

// Stats tracking
let detectCount = 0;
let lastStatsTime = Date.now();
let lastValidLandmarks = null;

// Initialize MediaPipe
async function init() {
  setStatus("Loading MediaPipe...");

  try {
    // Load MediaPipe vision tasks
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    // Create pose landmarker with GPU acceleration
    const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",  // Use GPU for acceleration
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.65,
      minPosePresenceConfidence: 0.65,
      minTrackingConfidence: 0.5,
    });

    console.log("MediaPipe Pose Landmarker initialized");

    // Start video
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;

    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    console.log(`Video: ${video.videoWidth}x${video.videoHeight}`);
    setStatus("Ready", "connected");

    // Start detection loop
    detectPoses(poseLandmarker);

  } catch (error) {
    console.error("Init error:", error);
    setStatus("Error: " + error.message, "error");
  }
}

// Parity note (signal-correctness audit): this video.js pipeline runs the
// plausibility gate, smoothing, and hold-last-good continuity, but OMITS the
// outlier-filter (MAX_JUMP) stage that app.js applies. No formula is
// miscomputed; the two MediaPipe entry points just differ on outlier rejection.
function detectPoses(poseLandmarker) {
  const startTime = performance.now();
  const timestamp = startTime / 1000;

  // Run pose detection
  const results = poseLandmarker.detectForVideo(video, startTime);

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.landmarks && results.landmarks.length > 0) {
    const raw = results.landmarks[0];

    if (isPlausiblePose(raw)) {
      const landmarks = smoothLandmarks(raw, timestamp);
      lastValidLandmarks = landmarks;

      drawSkeleton(landmarks);
      socket.emit("pose", { landmarks });
    } else if (lastValidLandmarks) {
      socket.emit("pose", { landmarks: lastValidLandmarks });
      drawSkeleton(lastValidLandmarks);
    }

    detectCount++;
  } else if (lastValidLandmarks) {
    // Hold last good frame for stream continuity
    socket.emit("pose", { landmarks: lastValidLandmarks });
  }

  // Update stats every second
  const now = Date.now();
  if (now - lastStatsTime >= 1000) {
    const fps = detectCount;
    statsEl.textContent = `${fps} fps`;
    detectCount = 0;
    lastStatsTime = now;
  }

  // Continue loop
  requestAnimationFrame(() => detectPoses(poseLandmarker));
}

function drawSkeleton(landmarks) {
  // Draw connections
  ctx.strokeStyle = "#00ffff";
  ctx.lineWidth = 3;

  for (const [i, j] of POSE_CONNECTIONS) {
    const p1 = landmarks[i];
    const p2 = landmarks[j];

    if (p1.visibility > SCORE_THRESHOLD && p2.visibility > SCORE_THRESHOLD) {
      ctx.beginPath();
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    }
  }

  // Draw landmarks
  for (const landmark of landmarks) {
    if (landmark.visibility > SCORE_THRESHOLD) {
      ctx.fillStyle = "#ff00ff";
      ctx.beginPath();
      ctx.arc(
        landmark.x * canvas.width,
        landmark.y * canvas.height,
        6,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }
}

// Start
init();
