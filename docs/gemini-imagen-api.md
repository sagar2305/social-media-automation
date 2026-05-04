# Gemini Image Generation API Reference

> Source: ai.google.dev + Context7 (/websites/ai_google_dev_gemini-api)
> Last updated: 2026-04-03

## Overview

Two approaches for image generation:

1. **Imagen** (`imagen-4.0-generate-001`) - Dedicated image generation model via `/predict` endpoint
2. **Gemini Native** (`gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`) - Text+image generation via `/generateContent` endpoint

All generated images include SynthID watermarks.

---

## Approach 1: Imagen (Dedicated Image Gen)

### POST /predict

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predict
```

**Authentication:** API key via header or query param:
```
x-goog-api-key: $GEMINI_API_KEY
```

#### Models

| Model | Use Case |
|-------|----------|
| `imagen-4.0-generate-001` | Latest, highest quality |

#### Request Body

```json
{
  "instances": [
    {
      "prompt": "A photorealistic close-up portrait of a student studying, captured with 85mm portrait lens, shallow depth of field, warm golden hour lighting"
    }
  ],
  "parameters": {
    "sampleCount": 4,
    "aspectRatio": "9:16",
    "personGeneration": "allow_adult",
    "imageSize": "1K"
  }
}
```

**Parameters:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `instances[].prompt` | string | - | Text description (English only) |
| `parameters.sampleCount` | integer | 4 | Number of images (1-4) |
| `parameters.aspectRatio` | string | `"1:1"` | `"1:1"`, `"3:4"`, `"4:3"`, `"9:16"`, `"16:9"` |
| `parameters.personGeneration` | string | `"allow_adult"` | `"dont_allow"`, `"allow_adult"`, `"allow_all"` |
| `parameters.imageSize` | string | `"1K"` | `"1K"`, `"2K"` |

#### Response

```json
{
  "generatedImages": [
    {
      "image": {
        "imageBytes": "base64-encoded-png-data..."
      }
    }
  ]
}
```

#### cURL Example

```bash
curl -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instances": [{ "prompt": "Robot holding a red skateboard" }],
    "parameters": { "sampleCount": 4 }
  }'
```

---

## Approach 2: Gemini Native Image Generation

### POST /generateContent

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=$GEMINI_API_KEY
```

#### Models

| Model | Strengths |
|-------|-----------|
| `gemini-2.5-flash-image` | Fast, efficient, good for high-volume |
| `gemini-3.1-flash-image-preview` | Best balance: text rendering, 512/1K/2K/4K, up to 10 reference images |
| `gemini-3-pro-image-preview` | Highest quality, "thinking" for complex prompts |

#### Request Body

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "Create a colorful anime-style illustration of a student studying at a desk with books" }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "9:16",
      "imageSize": "1K"
    }
  }
}
```

**generationConfig.imageConfig:**

| Field | Type | Values |
|-------|------|--------|
| `aspectRatio` | string | `"1:1"`, `"1:4"`, `"1:8"`, `"2:3"`, `"3:2"`, `"3:4"`, `"4:1"`, `"4:3"`, `"4:5"`, `"5:4"`, `"8:1"`, `"9:16"`, `"16:9"`, `"21:9"` |
| `imageSize` | string | `"512"`, `"1K"`, `"2K"`, `"4K"` (model dependent) |

**generationConfig.responseModalities:** Must include `"IMAGE"` to get images back. Can be `["TEXT", "IMAGE"]` or `["IMAGE"]`.

#### Response

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          { "text": "Here is your illustration..." },
          {
            "inline_data": {
              "mime_type": "image/png",
              "data": "base64-encoded-image-data..."
            }
          }
        ]
      }
    }
  ]
}
```

#### JavaScript Example

```javascript
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateContent({
  model: "gemini-3.1-flash-image-preview",
  contents: "Create a colorful anime-style illustration of a student studying",
  config: {
    imageConfig: {
      aspectRatio: "9:16",
      imageSize: "1K",
    },
  },
});

for (const part of response.candidates[0].content.parts) {
  if (part.text) {
    console.log(part.text);
  } else if (part.inlineData) {
    const buffer = Buffer.from(part.inlineData.data, "base64");
    fs.writeFileSync("output.png", buffer);
  }
}
```

#### Image Editing (Multi-turn)

Send an existing image + text prompt to edit it:

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "inline_data": {
            "mime_type": "image/png",
            "data": "base64-encoded-source-image..."
          }
        },
        { "text": "Add warm golden color grading and shallow depth of field blur to the background" }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

---

## Prompting Tips

### Photorealistic Scenes
Use photography terminology: shot types, lens specs, lighting, mood.
> "A photorealistic close-up portrait of a young woman studying, captured with an 85mm portrait lens, f/1.8 aperture, warm golden hour lighting, shallow depth of field, Arri Alexa quality"

### Stylized / Animated
Specify the exact style + background:
> "A Pixar 3D animation style illustration of a student character with big expressive eyes, studying at a cozy desk, warm colorful lighting, white background"

### Text in Images
Gemini 3.1 Flash renders legible, stylized text:
> "Create a slide with the text 'Study Smarter, Not Harder' in elegant italic cursive font, overlaid on a soft gradient background"

---

## Error Responses

| Code | Description |
|------|-------------|
| 400 | Invalid request / malformed JSON |
| 401 | Missing or invalid API key |
| 403 | API key lacks permission |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

## Language Support

English, German, Spanish, French, Indonesian, Italian, Polish, Portuguese, Vietnamese, Turkish, Russian, Hebrew, Arabic, Farsi, Hindi, Bengali, Thai, Chinese (Simplified/Traditional), Japanese, Korean
