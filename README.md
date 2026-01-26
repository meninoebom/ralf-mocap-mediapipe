# ralf-mocap-mediapipe

Motion capture CLI using **MediaPipe Pose Lite** instead of MoveNet.

## Comparison with MoveNet version

| Feature | MoveNet (ralf-mocap) | MediaPipe (this) |
|---------|---------------------|------------------|
| Keypoints | 17 | **33** |
| 3D Depth | No | **Yes (z-coordinate)** |
| Expected FPS | 50+ | **60+** |
| Hand detail | No | **Yes (pinky, index, thumb)** |
| Foot detail | No | **Yes (heel, toe)** |
| Face detail | Basic | **More (inner/outer eye, mouth)** |

## Quick Start

```bash
npm install
npm link
ralf-mocap-mp start
```

## Usage

```bash
ralf-mocap-mp start                # Full body: 33 keypoints, 66 floats
ralf-mocap-mp start --upper-body   # Upper body: 13 keypoints, 26 floats
ralf-mocap-mp start --core         # Core: 13 keypoints (no face/hand/foot detail)
ralf-mocap-mp start --debug        # Log OSC messages
```

## MediaPipe Pose Landmarks (33)

```
 0: nose
 1-3: left_eye (inner, center, outer)
 4-6: right_eye (inner, center, outer)
 7: left_ear
 8: right_ear
 9: mouth_left
10: mouth_right
11: left_shoulder
12: right_shoulder
13: left_elbow
14: right_elbow
15: left_wrist
16: right_wrist
17: left_pinky
18: left_index
19: left_thumb
20: right_pinky
21: right_index
22: right_thumb
23: left_hip
24: right_hip
25: left_knee
26: right_knee
27: left_ankle
28: right_ankle
29: left_heel
30: right_heel
31: left_foot_index
32: right_foot_index
```

## OSC Output

Same format as MoveNet version:
- Address: `/wek/inputs`
- Port: 6448 (default)
- Data: y, x pairs for each keypoint (normalized 0-1)

**Note:** MediaPipe gives normalized coordinates (0-1), which is ideal for ML.
