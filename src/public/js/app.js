// ralf-mocap MediaPipe Combined View
// Pose detection with monitoring panel

import {
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// Constants
const SCORE_THRESHOLD = 0.5;
const MAX_JUMP_THRESHOLD = 0.15; // 15% of frame dimension - outlier filter

// MediaPipe landmark names
const LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'left_index', 'left_thumb',
  'right_pinky', 'right_index', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee',
  'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index'
];

// MediaPipe skeleton connections
const POSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
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

// Skeleton edges for monitor preview (simplified)
const SKELETON_EDGES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  [23, 25], [25, 27], [27, 29], [27, 31],
  [24, 26], [26, 28], [28, 30], [28, 32],
];

// DOM elements - Video
const video = document.getElementById("video");
const videoPanel = document.querySelector(".video-panel");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");

// Calculate where the video actually displays (accounting for object-fit: contain)
function updateCanvasPosition() {
  const containerWidth = videoPanel.clientWidth;
  const containerHeight = videoPanel.clientHeight;
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;

  if (!videoWidth || !videoHeight) return;

  // Calculate the displayed video dimensions (object-fit: contain)
  const containerRatio = containerWidth / containerHeight;
  const videoRatio = videoWidth / videoHeight;

  let displayWidth, displayHeight, offsetX, offsetY;

  if (containerRatio > videoRatio) {
    // Container is wider than video - video is height-constrained
    displayHeight = containerHeight;
    displayWidth = displayHeight * videoRatio;
    offsetX = (containerWidth - displayWidth) / 2;
    offsetY = 0;
  } else {
    // Container is taller than video - video is width-constrained
    displayWidth = containerWidth;
    displayHeight = displayWidth / videoRatio;
    offsetX = 0;
    offsetY = (containerHeight - displayHeight) / 2;
  }

  // Position and size the canvas to match the displayed video
  canvas.style.left = `${offsetX}px`;
  canvas.style.top = `${offsetY}px`;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
}

// Update canvas position on resize
window.addEventListener("resize", updateCanvasPosition);

// DOM elements - Monitor
const connectionStatus = document.getElementById("connection-status");
const oscPortEl = document.getElementById("osc-port");
const messageCountEl = document.getElementById("message-count");
const messageRateEl = document.getElementById("message-rate");
const keypointsBody = document.getElementById("keypoints-body");
const skeletonCanvas = document.getElementById("skeleton-canvas");
const skeletonCtx = skeletonCanvas.getContext("2d");

// State
let prevLandmarks = null;
let detectCount = 0;
let lastStatsTime = Date.now();
let messagesInLastSecond = 0;
let lastUIUpdate = 0;
const UI_UPDATE_INTERVAL = 66; // ~15fps for UI updates

// Socket.io
const socket = io();

socket.on("connect", () => {
  console.log("Connected to server");
  connectionStatus.textContent = "Connected";
  connectionStatus.className = "status-value";
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  statusEl.textContent = "Disconnected";
  statusEl.className = "error";
  connectionStatus.textContent = "Disconnected";
  connectionStatus.className = "status-value disconnected";
});

socket.on("config", (config) => {
  oscPortEl.textContent = config.oscPort;
});

socket.on("stats", (stats) => {
  messageCountEl.textContent = stats.messageCount.toLocaleString();
});

// Initialize keypoints table
function initKeypointsTable() {
  keypointsBody.innerHTML = LANDMARK_NAMES.map((name, i) => `
    <tr id="lm-${i}">
      <td>${name.replace(/_/g, ' ')}</td>
      <td class="x">--</td>
      <td class="y">--</td>
      <td class="z">--</td>
      <td class="vis">--</td>
    </tr>
  `).join('');
}

// Update keypoints table
function updateKeypointsTable(landmarks) {
  landmarks.forEach((lm, i) => {
    const row = document.getElementById(`lm-${i}`);
    if (row) {
      row.querySelector('.x').textContent = lm.x.toFixed(3);
      row.querySelector('.y').textContent = lm.y.toFixed(3);
      row.querySelector('.z').textContent = lm.z.toFixed(3);
      row.querySelector('.vis').textContent = lm.visibility.toFixed(2);
    }
  });
}

// Draw skeleton in monitor preview
function drawSkeletonPreview(landmarks) {
  const w = skeletonCanvas.width;
  const h = skeletonCanvas.height;

  skeletonCtx.fillStyle = '#0a0a0f';
  skeletonCtx.fillRect(0, 0, w, h);

  // Find bounds
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  landmarks.forEach(lm => {
    if (lm.visibility > 0.3) {
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    }
  });

  const padding = 20;
  const rangeX = maxX - minX || 0.1;
  const rangeY = maxY - minY || 0.1;
  const scale = Math.min(
    (w - padding * 2) / rangeX,
    (h - padding * 2) / rangeY
  );

  const offsetX = (w - rangeX * scale) / 2 - minX * scale;
  const offsetY = (h - rangeY * scale) / 2 - minY * scale;

  const mapX = x => x * scale + offsetX;
  const mapY = y => y * scale + offsetY;

  // Draw edges
  skeletonCtx.strokeStyle = '#00d4ff';
  skeletonCtx.lineWidth = 2;
  skeletonCtx.lineCap = 'round';

  SKELETON_EDGES.forEach(([i, j]) => {
    const lm1 = landmarks[i];
    const lm2 = landmarks[j];
    if (lm1 && lm2 && lm1.visibility > 0.3 && lm2.visibility > 0.3) {
      skeletonCtx.beginPath();
      skeletonCtx.moveTo(mapX(lm1.x), mapY(lm1.y));
      skeletonCtx.lineTo(mapX(lm2.x), mapY(lm2.y));
      skeletonCtx.stroke();
    }
  });

  // Draw landmarks
  landmarks.forEach(lm => {
    if (lm.visibility > 0.3) {
      // White border
      skeletonCtx.strokeStyle = '#ffffff';
      skeletonCtx.lineWidth = 1.5;
      skeletonCtx.beginPath();
      skeletonCtx.arc(mapX(lm.x), mapY(lm.y), 4, 0, Math.PI * 2);
      skeletonCtx.stroke();

      // Coral fill
      skeletonCtx.fillStyle = '#ff6b6b';
      skeletonCtx.fill();
    }
  });
}

// Outlier filter - reject sudden large jumps
function filterOutliers(landmarks) {
  if (!prevLandmarks) {
    prevLandmarks = landmarks.map(lm => ({ ...lm }));
    return landmarks;
  }

  const filtered = landmarks.map((lm, i) => {
    const prev = prevLandmarks[i];
    const dx = Math.abs(lm.x - prev.x);
    const dy = Math.abs(lm.y - prev.y);

    // If jump is too large and visibility dropped, use previous position
    if ((dx > MAX_JUMP_THRESHOLD || dy > MAX_JUMP_THRESHOLD) && lm.visibility < prev.visibility) {
      return { ...prev, visibility: lm.visibility };
    }

    // Update previous
    prevLandmarks[i] = { ...lm };
    return lm;
  });

  return filtered;
}

// Draw skeleton on video canvas - improved visuals
function drawSkeleton(landmarks) {
  // Draw connections with cyan color
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

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

  // Draw landmarks with coral fill and white border
  for (const landmark of landmarks) {
    if (landmark.visibility > SCORE_THRESHOLD) {
      const x = landmark.x * canvas.width;
      const y = landmark.y * canvas.height;

      // White border
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Coral fill
      ctx.fillStyle = '#ff6b6b';
      ctx.fill();
    }
  }
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

// Initialize MediaPipe
async function init() {
  setStatus("Loading MediaPipe...");
  initKeypointsTable();

  // Draw placeholder on skeleton canvas
  skeletonCtx.fillStyle = '#0a0a0f';
  skeletonCtx.fillRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);
  skeletonCtx.fillStyle = '#444';
  skeletonCtx.font = '12px monospace';
  skeletonCtx.textAlign = 'center';
  skeletonCtx.fillText('Waiting for pose...', skeletonCanvas.width / 2, skeletonCanvas.height / 2);

  try {
    // Load MediaPipe vision tasks
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    // Create pose landmarker with GPU acceleration
    const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
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

    // Set canvas size to match video resolution
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Position canvas to match displayed video area
    updateCanvasPosition();

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
    // Apply outlier filter
    const landmarks = filterOutliers(results.landmarks[0]);

    // Draw skeleton on video
    drawSkeleton(landmarks);

    // Send to server
    socket.emit("pose", { landmarks });
    messagesInLastSecond++;

    // Throttle UI updates
    const now = performance.now();
    if (now - lastUIUpdate >= UI_UPDATE_INTERVAL) {
      lastUIUpdate = now;
      drawSkeletonPreview(landmarks);
      updateKeypointsTable(landmarks);
    }

    detectCount++;
  }

  // Update FPS every second
  const now = Date.now();
  if (now - lastStatsTime >= 1000) {
    const fps = detectCount;
    fpsEl.textContent = `${fps} fps`;
    messageRateEl.textContent = `${messagesInLastSecond} msg/s`;
    detectCount = 0;
    messagesInLastSecond = 0;
    lastStatsTime = now;
  }

  // Continue loop
  requestAnimationFrame(() => detectPoses(poseLandmarker));
}

// Start
init();
