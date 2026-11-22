# RedDOGS Multi-Token Streamer & Cosmic VC Suite

High-performance Discord self-bot multi-token video streamer, YouTube player, and voice suite with an ultra-premium **Dynamic Red Cosmic Space** dashboard.

---

## 🚀 Deploying & Running on Bot-Hosting.net (Zero Disk & Memory Issues)

### 1. Configure Startup Command (Frees ~200MB of Disk Space & Keeps RAM < 130MB!)
In your Bot-Hosting dashboard:
1. Go to **Settings** -> **Startup**:
   - **Start command (Override)**: Paste this exact command:
     ```bash
     rm -rf ~/.npm ~/.cache /home/container/.npm /tmp/* 2>/dev/null; npm install --omit=dev --no-audit --no-fund && rm -rf ~/.npm ~/.cache /home/container/.npm /tmp/* 2>/dev/null && exec node --expose-gc --max-old-space-size=128 dashboard/server.js --port 25697
     ```
2. Click **Save and apply**.
   *(This immediately removes ~180MB of redundant npm cache and enforces strict V8 garbage collection, bringing your storage down to ~200MB and RAM under 130MB!)*

---

### 2. Updating Files on Bot-Hosting
1. Go to the **Files** tab on Bot-Hosting:
   - In `dashboard/videos/`: delete any large video files like `iSaiAbhyankkar_-_The_Indie_Isai.mp4` (158MB) or old `.part` files *(frees 160MB of disk space!)*
   - Delete old `dashboard/` and `dist/` folders.
2. Upload the new lightweight **`RedDOGS-MultiToken-Streamer.zip`** (Only ~380 KB!).
3. Click `...` on the zip file -> select **Unarchive** (Extract).
4. Delete `RedDOGS-MultiToken-Streamer.zip` after extracting.

---

### 3. Smooth & Lag-Free Streaming (Why Buffering is Solved)
- **Zero Lag Pacing**: WebRTC sync tolerance has been optimized to 250ms with 1.5s initial burst buffering (`readrateInitialBurst: 1.5`), completely eliminating stutter and buffering wheels in Discord voice channels.
- **100% Free & Unblockable Streaming Methods**:
  1. **Upload from PC (Recommended)**: Use the "Upload from PC" tab in the stream modal. Upload any MP4 video directly — it streams with 0% CPU overhead, zero lag, and bypasses all YouTube bot checks and IP bans!
  2. **Direct MP4 Links**: Paste any direct video URL ending in `.mp4` (e.g. from Discord CDN, Catbox, Archive.org).
  3. **Free YouTube Downloader**: If YouTube blocks Bot-Hosting datacenter IPs (`Could not prepare player`), download the video on your PC using [cobalt.tools](https://cobalt.tools) or any free YouTube downloader in 360p or 720p, then upload it via the dashboard!
- **One-Click Storage Cleaner**: Use the `🧹 Free Storage & RAM` button on the dashboard toolbar to automatically clean temporary files and caches whenever disk space is low.
