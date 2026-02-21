import osc from "osc-min";
import dgram from "dgram";

// All 33 MediaPipe Pose landmarks in order
// https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
export const KEYPOINT_NAMES = [
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_pinky",
  "left_index",
  "left_thumb",
  "right_pinky",
  "right_index",
  "right_thumb",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot_index",
  "right_foot_index",
];

// Preset modes for keypoint selection
export const MODES = {
  fullBody: {
    name: "Full Body",
    keypoints: new Set(KEYPOINT_NAMES),
  },
  upperBody: {
    name: "Upper Body",
    keypoints: new Set([
      "nose",
      "left_shoulder",
      "right_shoulder",
      "left_elbow",
      "right_elbow",
      "left_wrist",
      "right_wrist",
    ]),
  },
  // Core body without face/hands/feet detail
  core: {
    name: "Core",
    keypoints: new Set([
      "nose",
      "left_shoulder",
      "right_shoulder",
      "left_elbow",
      "right_elbow",
      "left_wrist",
      "right_wrist",
      "left_hip",
      "right_hip",
      "left_knee",
      "right_knee",
      "left_ankle",
      "right_ankle",
    ]),
  },
};

// Backwards compatibility
export const KEYPOINT_ORDER = KEYPOINT_NAMES;

/**
 * Build an OSC message from a MediaPipe pose.
 * Wekinator expects /wek/inputs with floats.
 * MediaPipe gives normalized 0-1 coordinates, which is ideal for ML.
 *
 * Default format: 99 floats (33 joints × [y, x, visibility])
 * Legacy format:  66 floats (33 joints × [y, x]) — for Wekinator compat
 *
 * @param {Object} pose - Pose object with landmarks array
 * @param {Object} options - Options
 * @param {Set<string>} options.enabledKeypoints - Set of keypoint names to include
 * @param {boolean} options.legacyMode - Omit visibility (66-float format)
 * @param {string} options.address - OSC address (default "/wek/inputs")
 * @returns {{ address: string, args: Array<{type: string, value: number}> }}
 */
export function buildOscMessage(pose, options = {}) {
  if (!pose || !pose.landmarks || pose.landmarks.length === 0) {
    return null;
  }

  const {
    enabledKeypoints = new Set(KEYPOINT_NAMES),
    legacyMode = false,
    address = "/wek/inputs",
  } = options;
  const landmarks = pose.landmarks;

  // Build args array: y, x[, visibility] for each enabled keypoint, in canonical order
  const args = [];
  for (let i = 0; i < KEYPOINT_NAMES.length; i++) {
    const name = KEYPOINT_NAMES[i];
    if (!enabledKeypoints.has(name)) continue;

    const lm = landmarks[i];
    if (lm) {
      // MediaPipe gives normalized 0-1 coordinates
      args.push({ type: "float", value: lm.y });
      args.push({ type: "float", value: lm.x });
      if (!legacyMode) {
        args.push({ type: "float", value: lm.visibility ?? 0 });
      }
    } else {
      args.push({ type: "float", value: 0 });
      args.push({ type: "float", value: 0 });
      if (!legacyMode) {
        args.push({ type: "float", value: 0 });
      }
    }
  }

  return { address, args };
}

/**
 * Format OSC message for debug output.
 */
export function formatOscDebug(message, port, host) {
  if (!message) return null;

  const values = message.args.map((a) => a.value.toFixed(2)).join(", ");
  const preview = values.length > 60 ? values.slice(0, 60) + "..." : values;
  return `OSC → ${host}:${port} ${message.address} [${preview}]`;
}

/**
 * Create a function that sends OSC messages to a UDP port.
 */
export function createOscSender(port = 6448, host = "localhost", options = {}) {
  const {
    debug = false,
    enabledKeypoints,
    legacyMode = process.env.RALF_LEGACY_MODE === "1",
    poseAddress = process.env.RALF_POSE_ADDRESS,
  } = options;
  const udp = dgram.createSocket("udp4");

  return function send(pose) {
    // Always send /wek/inputs (legacy format when RALF_LEGACY_MODE=1)
    const wekMessage = buildOscMessage(pose, {
      enabledKeypoints,
      legacyMode,
    });
    if (!wekMessage) return;

    if (debug) {
      console.log(formatOscDebug(wekMessage, port, host));
    }

    const buffer = osc.toBuffer(wekMessage);
    udp.send(buffer, 0, buffer.length, port, host);

    // Optionally also send on a custom address (e.g. /ralf/pose)
    if (poseAddress) {
      const poseMessage = buildOscMessage(pose, {
        enabledKeypoints,
        legacyMode: false,
        address: poseAddress,
      });
      if (poseMessage) {
        const poseBuf = osc.toBuffer(poseMessage);
        udp.send(poseBuf, 0, poseBuf.length, port, host);
      }
    }
  };
}
