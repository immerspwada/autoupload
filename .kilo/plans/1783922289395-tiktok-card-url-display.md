# Plan: Add TikTok Source URL to Video Card UI

## Goal
Display the TikTok source URL on each video card with a clean, minimal UI.

## Current State
- Video cards rendered in `public/pages/tiktok.js:467-514` via `renderResults()`
- Each video object has `videoUrl` property containing the TikTok source URL
- Cards show: cover, quality pills, title, opportunity angle, author, metrics, actions

## Design Decision: URL Display Location
**Recommended:** Add a small, clickable URL display below the video title (line 491), styled as a truncated URL with copy-to-clipboard icon.

## Implementation Steps

### 1. Add URL display element in `renderResults()` function
Location: After `tiktok-video-title` div, before `opportunity-angle` div

```html
<div class="tiktok-source-url">
  <span class="url-text">${truncateUrl(v.videoUrl)}</span>
  <button class="copy-url-btn" title="คัดลอก URL" onclick="navigator.clipboard.writeText('${v.videoUrl}')">📋</button>
</div>
```

### 2. Add helper function `truncateUrl()`
```javascript
function truncateUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.hostname}/${u.pathname.split('/').slice(-2).join('/')}`;
  } catch {
    return url.length > 40 ? url.substring(0, 37) + '...' : url;
  }
}
```

### 3. Add CSS styling (in existing styles or new)
```css
.tiktok-source-url {
  font-size: 0.75rem;
  color: #666;
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 2px 0;
  font-family: monospace;
}
.copy-url-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  opacity: 0.6;
  font-size: 0.8rem;
}
.copy-url-btn:hover { opacity: 1; }
```

## Data Flow
- `v.videoUrl` → already contains TikTok source URL from API response
- No backend changes needed

## Validation
- Verify URL displays correctly for all video types (search, trending, creator)
- Test copy-to-clipboard functionality
- Ensure URL truncation handles long URLs gracefully

## Files to Modify
- `public/pages/tiktok.js` - Add URL display in `renderResults()` and helper function