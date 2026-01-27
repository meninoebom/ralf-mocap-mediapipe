---
title: "fix: Upper Body Mode CLI Help Text"
type: fix
date: 2026-01-26
---

# fix: Upper Body Mode CLI Help Text

## Overview

Upper body mode is already implemented in the MediaPipe project, but the CLI help text shows incorrect keypoint counts. This plan fixes the help text and verifies the feature works end-to-end.

## Current State

**What exists (already working):**
- `--upper-body` CLI flag in `bin/ralf-mocap.js:21`
- `MODES.upperBody` in `src/server/osc.js:48-58` with correct 7 keypoints
- Server passes mode config and filters OSC output correctly

**Bug found:**
```javascript
// bin/ralf-mocap.js:21 - INCORRECT
.option("-u, --upper-body", "Use upper body mode (13 keypoints, 26 floats)")

// Should be:
.option("-u, --upper-body", "Use upper body mode (7 keypoints, 14 floats)")
```

## Upper Body Keypoints (7 total)

| Index | Name | Purpose |
|-------|------|---------|
| 0 | nose | Head position |
| 11 | left_shoulder | Left arm base |
| 12 | right_shoulder | Right arm base |
| 13 | left_elbow | Left arm joint |
| 14 | right_elbow | Right arm joint |
| 15 | left_wrist | Left hand position |
| 16 | right_wrist | Right hand position |

**OSC Output:** 14 floats (7 keypoints × 2 coords, y-before-x)

## Acceptance Criteria

- [ ] Fix CLI help text: "7 keypoints, 14 floats"
- [ ] Verify `ralf-mocap-mp start --upper-body` works
- [ ] Verify OSC sends 14 floats (not 66)
- [ ] Verify skeleton still renders in browser

## File Changes

| File | Change |
|------|--------|
| `bin/ralf-mocap.js:21` | Fix keypoint count in help text |

## Test

```bash
cd /Users/brandon/dev/ralf/mediapipe
npm run dev -- --upper-body --debug
# Should show: Mode: Upper Body (7 keypoints, 14 floats)
# OSC debug should show 14 values
```

## References

- OSC modes: `/Users/brandon/dev/ralf/mediapipe/src/server/osc.js:48-58`
- CLI entry: `/Users/brandon/dev/ralf/mediapipe/bin/ralf-mocap.js`
