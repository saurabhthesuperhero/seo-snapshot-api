# SEO Snapshot API 🕵️‍♂️

Fast, serverless SEO metadata & on‑page insights delivered from Cloudflare's edge, powered by [Hono](https://honojs.dev).

## ✨ Features (v1)
* Title & meta‑description
* **All `<meta>` tags** (quick lookup)
* Canonical URL & OpenGraph tags
* Word & image counts
* Page size (KB)
* Language detection
* Heading structure (h1‑h3) **+ per‑level counts**

## 🚀 Quick Start

### 1. Prerequisites
* **Node.js ≥ 18**
* **Wrangler ≥ 3** (`npm i -g wrangler`)

### 2. Clone & install
```bash
git clone https://github.com/yourname/seo-snapshot-api.git
cd seo-snapshot-api
npm install
```

### 3. Local dev (Miniflare)
```bash
npm run dev         # → http://localhost:8787/snapshot?url=https://example.com
```

### 4. Deploy to Cloudflare Workers
```bash
wrangler deploy     # requires `wrangler login` first
```

### 5. Example Request
```
GET /snapshot?url=https://example.com
```

### 6. Example Response
```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "metaDescription": "",
  "canonical": "https://example.com/",
  "lang": "en",
  "pageSizeKb": 8.21,
  "wordCount": 98,
  "imageCount": 0,
  "metaTags": {
    "og:title": "Example Domain",
    "description": "Example description here"
  },
  "ogTags": {
    "og:title": "Example Domain"
  },
  "headings": [
    { "tag": "h1", "text": "Example Domain" }
  ],
  "headingCounts": {
    "h1": 1,
    "h2": 0,
    "h3": 0
  }
}