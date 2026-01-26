// ralf-mocap MediaPipe: Pose detection with OSC output
// Uses MediaPipe Tasks Vision API

import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const SCORE_THRESHOLD = 0.5;

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
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
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

function detectPoses(poseLandmarker) {
  const startTime = performance.now();

  // Run pose detection
  const results = poseLandmarker.detectForVideo(video, startTime);

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.landmarks && results.landmarks.length > 0) {
    const landmarks = results.landmarks[0];

    // Draw skeleton
    drawSkeleton(landmarks);

    // Send to server
    socket.emit("pose", { landmarks });

    detectCount++;
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
