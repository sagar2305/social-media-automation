# LTX Video API Documentation (LTX-2.3)

> Source: https://docs.ltx.video | Fetched: 2026-04-15

## Overview

LTX-2.3 is a diffusion transformer (DiT) foundation model for video generation. Key upgrade from LTX-2: rebuilt latent space with updated VAE trained on higher-quality data, 4x larger text connector for better prompt adherence.

---

## API Base URL

```
https://api.ltx.video/v1
```

## Authentication

```
Authorization: Bearer YOUR_API_KEY
```

- Generate keys at: https://console.ltx.video
- Store as env var: `LTXV_API_KEY`
- Never commit keys to version control

---

## Models & Variants

### LTX-2.3 Models

| Model ID | Type | Best For |
|----------|------|----------|
| `ltx-2-3-fast` | Speed-optimized | Rapid iteration, prototyping, drafts |
| `ltx-2-3-pro` | Quality-optimized | Production output, higher fidelity, motion stability |

### LTX-2 Models (Legacy)

| Model ID | Type |
|----------|------|
| `ltx-2-fast` | Speed-optimized |
| `ltx-2-pro` | Quality-optimized |

### Capability Matrix

| Feature | Fast | Pro |
|---------|------|-----|
| Text-to-Video | Yes | Yes |
| Image-to-Video | Yes | Yes |
| Audio-to-Video | **No** | **Yes (Pro only)** |
| Retake | **No** | **Yes (Pro only)** |
| Extend | **No** | **Yes (Pro only)** |

---

## Resolutions, Frame Rates & Durations

### LTX-2.3

| Model | Resolution | Aspect Ratio | FPS Options | Duration |
|-------|-----------|--------------|-------------|----------|
| ltx-2-3-fast | 1920x1080 / 1080x1920 | 16:9 / 9:16 | 24, 25, 48, 50 | 6-20s (24/25fps), 6-10s (48/50fps) |
| ltx-2-3-fast | 2560x1440 / 1440x2560 | 16:9 / 9:16 | 24, 25, 48, 50 | 6-10s |
| ltx-2-3-fast | 3840x2160 / 2160x3840 | 16:9 / 9:16 | 24, 25, 48, 50 | 6-10s |
| ltx-2-3-pro | 1080p - 4K | 16:9 / 9:16 | 24, 25, 48, 50 | 6-10s |

### LTX-2

| Model | Resolution | Aspect Ratio | FPS | Duration |
|-------|-----------|--------------|-----|----------|
| ltx-2-fast | 1080p - 4K | **16:9 only** | 25, 50 | 6-20s (25fps), 6-10s (48/50fps) |
| ltx-2-pro | 1080p - 4K | **16:9 only** | 25, 50 | 6-10s |

**Key difference**: LTX-2.3 supports native 9:16 portrait (trained on portrait data, not cropped). LTX-2 is landscape only.

---

## Pricing (Per Second of Output Video)

### Text-to-Video & Image-to-Video

| Model | 1080p | 1440p | 4K |
|-------|-------|-------|-----|
| ltx-2-fast | $0.04/s | $0.08/s | $0.16/s |
| ltx-2-pro | $0.06/s | $0.12/s | $0.24/s |
| ltx-2-3-fast | $0.06/s | $0.12/s | $0.24/s |
| ltx-2-3-pro | $0.08/s | $0.16/s | $0.32/s |

### Audio-to-Video, Retake & Extend (Pro only)

| Model | 1080p |
|-------|-------|
| ltx-2-pro | $0.10/s |
| ltx-2-3-pro | $0.10/s |

### Cost Examples

- 10s TikTok draft (ltx-2-3-fast, 1080p): **$0.60**
- 10s TikTok final (ltx-2-3-pro, 1080p): **$0.80**
- 10s 4K render (ltx-2-3-pro): **$3.20**
- 20s draft (ltx-2-3-fast, 1080p): **$1.20**

---

## API Endpoints

### 1. Text-to-Video

```
POST /v1/text-to-video
```

**Required Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Text describing desired video |
| `model` | string | `ltx-2-fast`, `ltx-2-pro`, `ltx-2-3-fast`, `ltx-2-3-pro` |
| `duration` | integer | Duration in seconds |
| `resolution` | string | e.g. `1920x1080`, `1080x1920` |

**Optional Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fps` | integer | 24 | Frame rate |
| `generate_audio` | boolean | true | Include AI-generated audio |
| `camera_motion` | string | — | `dolly_in`, `dolly_out`, `dolly_left`, `dolly_right`, `jib_up`, `jib_down`, `static`, `focus_shift` |

**Response:** Binary MP4 (application/octet-stream), `x-request-id` header for tracking.

---

### 2. Image-to-Video

```
POST /v1/image-to-video
```

**Required Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `image_uri` | string | Image URL (first frame of video) |
| `prompt` | string | How to animate the image |
| `model` | string | Model ID |
| `duration` | integer | Duration in seconds |
| `resolution` | string | Output resolution |

**Optional Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fps` | integer | 24 | Frame rate |
| `generate_audio` | boolean | true | Include audio |
| `last_frame_uri` | string | — | Final frame for interpolation (**LTX-2.3 only**) |
| `camera_motion` | string | — | Camera motion preset |

---

### 3. Audio-to-Video (Pro only)

```
POST /v1/audio-to-video
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `audio_uri` | string | Yes | Audio file (2-20 seconds) |
| `image_uri` | string | No | First frame image |
| `prompt` | string | No | Text description |
| `resolution` | string | No | `1920x1080` or `1080x1920` (auto-detected from image) |
| `guidance_scale` | number | No | CFG value. Default: 5 (text), 9 (with image). Higher = more prompt adherence |
| `model` | string | No | Default: `ltx-2-3-pro` |

**Constraint:** Either `image_uri` or `prompt` required (or both).

---

### 4. Retake (Pro only)

```
POST /v1/retake
```

Edit a specific section of a video by replacing audio, video, or both.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `video_uri` | string | Yes | Input video (up to 4K, min 73 frames) |
| `start_time` | number | Yes | Start time in seconds |
| `duration` | number | Yes | Duration to replace (min 2 seconds) |
| `prompt` | string | No | Describes changes |
| `mode` | string | No | `replace_audio`, `replace_video`, `replace_audio_and_video` (default) |
| `resolution` | string | No | Auto-detected from input |
| `model` | string | No | Default: `ltx-2-3-pro` |

---

### 5. Extend (Pro only)

```
POST /v1/extend
```

Add frames to the beginning or end of a video.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `video_uri` | string | Yes | Input video |
| `duration` | number | Yes | Extension length (2-20 seconds) |
| `prompt` | string | No | What should happen in extension |
| `mode` | string | No | `end` (default) or `start` |
| `model` | string | No | Default: `ltx-2-3-pro` |
| `context` | number | No | Seconds from input video for coherence (max 20s) |

**Constraints:**
- Min duration: 2s, Max: 20s (480 frames at 24fps)
- context + duration cannot exceed ~505 frames (~21s at 24fps)
- Input video min: 73 frames (~3s at 24fps)
- Supported aspect ratios: 16:9, 9:16

---

### 6. Upload

```
POST /v1/upload
```

Upload files for use in other endpoints.

---

## Input Format Specifications

### Upload Methods & Limits

| Method | Image Max | Video/Audio Max | Notes |
|--------|-----------|-----------------|-------|
| Cloud Storage (upload endpoint) | 100 MB | 100 MB | Files available for 24 hours |
| HTTPS URL | 15 MB | 32 MB | Must be publicly accessible |
| Data URI (Base64) | 7 MB | 15 MB | Base64 adds ~33% size overhead |

### Supported Formats

**Images:** PNG, JPEG/JPG, WEBP

**Video:** MP4, MOV, MKV (H.264 and H.265 codecs)

**Audio:**
- WAV: AAC-LC, MP3, Vorbis, FLAC
- MP3: MP3 codec
- M4A: AAC-LC only
- OGG: Opus, Vorbis

**Audio constraint:** AAC must use AAC-LC profile (1024 samples/frame). HE-AAC and HE-AACv2 not supported. PCM not supported.

---

## Error Codes

| Status | Error Type | Description |
|--------|-----------|-------------|
| 400 | `invalid_request_error` | Invalid parameters or validation errors |
| 401 | `authentication_error` | Missing or invalid API key |
| 402 | `insufficient_funds_error` | Account lacks credits |
| 413 | `request_too_large` | Payload exceeds size limit |
| 422 | `content_filtered_error` | Rejected by safety filters |
| 429 | `rate_limit_error` / `concurrency_limit_error` | Rate/concurrency limits exceeded |
| 500 | `api_error` | Server error |
| 503 | `service_unavailable` | Temporarily unavailable |
| 504 | — | Request timeout |

Error response format:
```json
{
  "type": "error",
  "error": {
    "type": "error_type_string",
    "message": "human-readable message"
  }
}
```

Rate limit errors include `Retry-After` header (seconds to wait).

---

## Rate Limits

- **Concurrency limits**: Max simultaneous video generation requests
- **Rate limits**: Max requests within a time window
- Exact numbers are plan-specific (not publicly documented)
- 429 response includes `Retry-After` header
- Contact support for higher limits

---

## Prompting Guide

### Prompt Structure (6 elements)

1. **Shot Establishment** — Cinematography terms (close-up, wide shot, etc.)
2. **Scene Setting** — Lighting, color palette, textures, atmosphere
3. **Action Sequence** — Core narrative, start to finish
4. **Character Definition** — Age, appearance, clothing, emotion via physical cues
5. **Camera Movement** — How/when camera moves, subject positioning
6. **Audio Description** — Ambient sound, music, dialogue (in quotes), speech style

### Best Practices

- Write as a single flowing paragraph
- Use present tense
- Target 4-8 descriptive sentences
- Match detail to shot scale (close-ups need more specifics)
- Describe camera motion relative to subjects

### What Works Well

- Cinematic compositions with varied shot scales
- Shallow depth of field
- Single-subject emotional moments with subtle gestures
- Atmospheric elements: fog, mist, golden-hour lighting, rain
- Explicit camera language: "slow dolly in", "handheld tracking"
- Stylized aesthetics: painterly, noir, analog film

### What to Avoid

- Abstract emotional labels (use visual cues instead)
- Readable text and logos (unreliable rendering)
- Complex physics or chaotic motion
- Overcrowded scenes with multiple characters
- Conflicting lighting setups

### Voice & Audio

- Characters can speak and sing in multiple languages
- Dialogue styles: energetic announcer, gravitas, robotic monotone, etc.
- Place dialogue in quotation marks in the prompt

---

## Self-Hosting (Open Source)

### System Requirements

**Minimum:**
- GPU: NVIDIA with 32GB+ VRAM
- RAM: 32GB
- Storage: 100GB
- CUDA: 11.8+
- Python: 3.10+

**Recommended:**
- GPU: NVIDIA A100 (80GB) or H100
- RAM: 64GB
- Storage: 200GB+ SSD
- CUDA: 12.1+

### Model Weights (HuggingFace)

- Base dev checkpoint (bf16)
- Quantized fp8 variant
- Distilled model

### Licensing

- **Free**: Companies under $10M annual revenue
- **Commercial license required**: Companies over $10M revenue

### LoRA Fine-Tuning

- Use LTX-2 Trainer tool
- Place LoRA files in `ComfyUI/models/loras/`
- **CRITICAL: LTX-2 LoRAs are incompatible with LTX-2.3** — must retrain for new latent space
- Strength settings: 0.9-1.1 (subtle), 1.2-1.4 (balanced), 1.5-1.6 (strong)
- Keep combined strength under 2.0
- LoRAs add <5% compute overhead
- Effect LoRAs combine better than control LoRAs

### Integration Options

- ComfyUI (custom nodes from ComfyUI-LTXVideo repo)
- PyTorch API
- LTX Desktop / CLI
- LTX MCP (Model Context Protocol)
- Fal platform

---

## Key Differentiators vs Competition

1. **Audio-to-Video native modality** — Audio defines structure, pacing, motion
2. **Native 9:16 portrait** — Trained on portrait data, not cropped from landscape
3. **First-to-last frame control** (LTX-2.3 image-to-video) — Set both start and end frames
4. **Retake endpoint** — Replace audio/video/both in specific sections of existing video
5. **Extend endpoint** — Add frames to start or end with coherence
6. **Open source option** — Self-host with weights on HuggingFace
7. **Camera motion presets** — Built-in dolly, jib, static, focus_shift
8. **guidance_scale parameter** — Direct CFG control on audio-to-video

---

## OpenAPI Spec

Available at:
- JSON: https://docs.ltx.video/openapi.json
- YAML: https://docs.ltx.video/openapi.yaml
