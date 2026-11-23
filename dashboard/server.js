import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, CustomStatus } from "@lng2004/discord.js-selfbot-v13";
import { Ytdl, chooseFormat } from "@distube/ytdl-core";
import { Streamer, Utils, prepareStream, playStream } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const ytdl = new Ytdl();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
let argPort = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    argPort = args[i + 1];
  }
}

// Auto-detect container hosting (Bot-Hosting / Pterodactyl)
const isContainer = fs.existsSync("/home/container") || !!process.env.P_SERVER_UUID;
const defaultPort = isContainer ? 25697 : 3000;

const PORT = parseInt(
  process.env.PORT ||
  process.env.SERVER_PORT ||
  process.env.APP_PORT ||
  argPort ||
  defaultPort,
  10
);
const TOKENS_FILE = path.join(__dirname, "tokens.json");
const VIDEOS_DIR = path.join(__dirname, "videos");

// Video directory & storage management
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

function getVideosFolderStats() {
  if (!fs.existsSync(VIDEOS_DIR)) return { totalBytes: 0, files: [] };
  let totalBytes = 0;
  const files = [];
  try {
    for (const f of fs.readdirSync(VIDEOS_DIR)) {
      const fp = path.join(VIDEOS_DIR, f);
      try {
        const s = fs.statSync(fp);
        totalBytes += s.size;
        files.push({ name: f, path: fp, size: s.size, mtime: s.mtimeMs });
      } catch {}
    }
  } catch {}
  return { totalBytes, files: files.sort((a, b) => a.mtime - b.mtime) };
}

function cleanStorage({ forceAll = false } = {}) {
  let freed = 0;
  // 1. Purge .part, .tmp, and corrupted files
  if (fs.existsSync(VIDEOS_DIR)) {
    for (const f of fs.readdirSync(VIDEOS_DIR)) {
      const fp = path.join(VIDEOS_DIR, f);
      try {
        const s = fs.statSync(fp);
        if (forceAll || f.endsWith(".part") || f.endsWith(".tmp") || s.size < 100000) {
          freed += s.size;
          fs.unlinkSync(fp);
          console.log(`[Disk Optimizer] Cleaned file: ${f}`);
        }
      } catch {}
    }
  }

  // 2. On Linux, purge ~/.npm, ~/.cache, /tmp to prevent ENOSPC on 512MB quota
  if (process.platform === "linux") {
    try {
      const homeDir = process.env.HOME || "/home/container";
      const homeNpm = path.join(homeDir, ".npm");
      const homeCache = path.join(homeDir, ".cache");
      if (fs.existsSync(homeNpm)) {
        fs.rmSync(homeNpm, { recursive: true, force: true });
        console.log("[Disk Optimizer] Purged ~/.npm cache");
      }
      if (fs.existsSync(homeCache)) {
        fs.rmSync(homeCache, { recursive: true, force: true });
      }
      if (fs.existsSync("/tmp")) {
        for (const tf of fs.readdirSync("/tmp")) {
          try { fs.rmSync(path.join("/tmp", tf), { recursive: true, force: true }); } catch {}
        }
      }
    } catch (e) {
      console.warn("[Disk Optimizer] Temp cache cleanup note:", e?.message);
    }
  }

  // 3. Auto-prune videos if total videos folder size > 110MB (critical for 512MB container quota)
  if (isContainer) {
    const stats = getVideosFolderStats();
    let currentBytes = stats.totalBytes;
    const MAX_ALLOWED_VIDEOS_BYTES = 110 * 1024 * 1024; // 110MB video quota
    if (currentBytes > MAX_ALLOWED_VIDEOS_BYTES) {
      console.log(`[Disk Optimizer] Videos size ${(currentBytes / 1024 / 1024).toFixed(1)}MB exceeds 110MB quota. Auto-pruning oldest files...`);
      for (const file of stats.files) {
        if (currentBytes <= MAX_ALLOWED_VIDEOS_BYTES) break;
        try {
          fs.unlinkSync(file.path);
          currentBytes -= file.size;
          freed += file.size;
          console.log(`[Disk Optimizer] Auto-pruned old video to prevent ENOSPC: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        } catch {}
      }
    }
  }

  // 4. Force V8 garbage collection if enabled
  if (typeof global.gc === "function") {
    try { global.gc(); } catch {}
  }

  return freed;
}

// Initial boot cleanup
cleanStorage();

// Periodic GC every 45s to keep RAM strictly below 150MB
setInterval(() => {
  if (typeof global.gc === "function") {
    try { global.gc(); } catch {}
  }
}, 45000);

// Global exception safety
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// SSE event emitter for real-time frontend updates
const sseClients = new Set();
function broadcastEvent(type, data) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// YouTube URL checker and downloader
function isYouTubeUrl(str) {
  if (!str || typeof str !== "string") return false;
  return /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/i.test(str.trim());
}

const YT_DLP_PATH = path.join(process.cwd(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

async function ensureYtDlp() {
  if (process.platform === "linux") {
    // If yt-dlp exists, check if it's the real standalone ELF binary (> 5MB)
    if (fs.existsSync(YT_DLP_PATH)) {
      try {
        const stat = fs.statSync(YT_DLP_PATH);
        if (stat.size > 5000000) {
          try { fs.chmodSync(YT_DLP_PATH, 0o755); } catch {}
          return YT_DLP_PATH;
        }
        console.log(`[YouTube] Existing yt-dlp is a Python script/incomplete (${stat.size} bytes). Downloading standalone Linux binary...`);
        try { fs.unlinkSync(YT_DLP_PATH); } catch {}
      } catch {}
    }

    try {
      console.log("[YouTube] Downloading standalone yt-dlp_linux binary (embedded Python, zero dependencies)...");
      const res = await fetch("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux", {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" }
      });
      if (res.ok) {
        const fileStream = fs.createWriteStream(YT_DLP_PATH);
        const { pipeline } = await import("node:stream/promises");
        await pipeline(res.body, fileStream);
        try { fs.chmodSync(YT_DLP_PATH, 0o755); } catch {}
        console.log("[YouTube] Standalone yt-dlp_linux binary ready!");
        return YT_DLP_PATH;
      }
    } catch (e) {
      console.warn("[YouTube] Could not download yt-dlp_linux binary (storage limited):", e?.message || e);
      try { if (fs.existsSync(YT_DLP_PATH)) fs.unlinkSync(YT_DLP_PATH); } catch {}
    }
  } else if (fs.existsSync(YT_DLP_PATH)) {
    return YT_DLP_PATH;
  }

  return "yt-dlp";
}

async function fetchCobaltStream(url, targetPartFile, audioOnly = false) {
  const instances = [
    "https://api.cobalt.tools",
    "https://cobalt-api.kwiatekm.tokyo",
    "https://cobalt.api.scip.cc",
    "https://api.wuk.sh",
  ];

  for (const inst of instances) {
    try {
      console.log(`[YouTube Cobalt] Attempting API: ${inst}...`);
      const res = await fetch(`${inst}/`, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        body: JSON.stringify({
          url,
          videoQuality: "360",
          downloadMode: audioOnly ? "audio" : "auto",
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const directUrl = data.url || data.stream;
      if (!directUrl) continue;

      console.log(`[YouTube Cobalt] Stream resolved! Fetching video file...`);
      const streamRes = await fetch(directUrl, {
        signal: AbortSignal.timeout(45000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (streamRes.ok) {
        const fileStream = fs.createWriteStream(targetPartFile);
        const { pipeline } = await import("node:stream/promises");
        await pipeline(streamRes.body, fileStream);
        if (fs.existsSync(targetPartFile) && fs.statSync(targetPartFile).size > 50000) {
          console.log(`[YouTube Cobalt] Download complete via Cobalt API!`);
          return true;
        }
      }
    } catch (e) {
      console.warn(`[YouTube Cobalt] Instance ${inst} skipped:`, e?.message);
    }
  }
  return false;
}

async function fetchInvidiousStream(videoId, targetPartFile) {
  const instances = [
    "https://inv.nadeko.net",
    "https://invidious.nerdvpn.de",
    "https://invidious.jing.rocks",
    "https://yt.artemislena.eu",
    "https://invidious.privacyredirect.com",
  ];

  for (const instance of instances) {
    try {
      console.log(`[YouTube Proxy] Querying instance: ${instance}...`);
      const apiRes = await fetch(`${instance}/api/v1/videos/${videoId}?local=true`, {
        signal: AbortSignal.timeout(7000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      if (!apiRes.ok) continue;
      const data = await apiRes.json();
      if (!data.formatStreams || data.formatStreams.length === 0) continue;

      // Select 360p progressive stream (audio + video combined)
      const streamObj =
        data.formatStreams.find((s) => s.resolution === "360p" || s.qualityLabel === "360p") ||
        data.formatStreams[0];
      if (!streamObj || !streamObj.url) continue;

      let streamUrl = streamObj.url;
      if (streamUrl.startsWith("/")) {
        streamUrl = instance + streamUrl;
      }

      console.log(`[YouTube Proxy] Downloading 360p stream via ${instance}...`);
      const streamRes = await fetch(streamUrl, {
        signal: AbortSignal.timeout(45000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      if (streamRes.ok) {
        const fileStream = fs.createWriteStream(targetPartFile);
        const { pipeline } = await import("node:stream/promises");
        await pipeline(streamRes.body, fileStream);
        if (fs.existsSync(targetPartFile) && fs.statSync(targetPartFile).size > 50000) {
          console.log(`[YouTube Proxy] Download complete via proxy!`);
          return true;
        }
      }
    } catch (e) {
      console.warn(`[YouTube Proxy] Instance ${instance} skipped:`, e?.message);
    }
  }
  return false;
}

async function resolveYouTube(url, audioOnly = false) {
  const cleanUrl = url.trim();
  const match = cleanUrl.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  const videoId = match ? match[1] : `yt_${Date.now()}`;
  // Discord streaming engine requires a video track to sync RTP timestamps, so always download mp4 with video + audio
  const ext = "mp4";
  const targetFile = path.join(VIDEOS_DIR, `${videoId}.${ext}`);
  const partFile = `${targetFile}.part`;

  // Check if cached and valid (> 50KB)
  if (fs.existsSync(targetFile)) {
    try {
      const stat = fs.statSync(targetFile);
      if (stat.size > 50000) {
        console.log(`[YouTube] Reusing cached media (${(stat.size / 1024 / 1024).toFixed(2)} MB): ${targetFile}`);
        return targetFile;
      }
    } catch {}
    try { fs.unlinkSync(targetFile); } catch {}
  }

  // Clean any stale partial file
  if (fs.existsSync(partFile)) {
    try { fs.unlinkSync(partFile); } catch {}
  }

  // 1. High-speed Cobalt Proxy Resolver (bypasses datacenter IP blocks completely)
  try {
    const cobaltSuccess = await fetchCobaltStream(cleanUrl, partFile, audioOnly);
    if (cobaltSuccess && fs.existsSync(partFile) && fs.statSync(partFile).size > 50000) {
      fs.renameSync(partFile, targetFile);
      console.log(`[YouTube] Successfully downloaded via Cobalt proxy: ${targetFile}`);
      return targetFile;
    }
  } catch (cobaltErr) {
    console.warn(`[YouTube] Cobalt resolver skipped:`, cobaltErr?.message);
  }

  console.log(`[YouTube] Downloading: ${cleanUrl} (Mode: ${audioOnly ? "Audio Player" : "Video/Cam"})`);

  const cookieCandidates = [
    path.join(process.cwd(), "cookies.txt"),
    path.join(__dirname, "cookies.txt"),
    path.join(__dirname, "..", "cookies.txt"),
    "/home/container/cookies.txt",
  ];
  let cookiePath = null;
  for (const cp of cookieCandidates) {
    if (fs.existsSync(cp)) {
      try {
        if (fs.statSync(cp).size > 10) {
          cookiePath = cp;
          console.log(`[YouTube] Using cookies file: ${cp}`);
          break;
        }
      } catch {}
    }
  }

  // 1. If cookies are present, use standard client (browser cookies require standard web client)
  if (cookiePath) {
    try {
      const bin = await ensureYtDlp();
      if (process.platform === "linux" && fs.existsSync(bin)) {
        try { fs.chmodSync(bin, 0o755); } catch {}
      }
      const format = "b[height<=360][ext=mp4]/b[ext=mp4]/best[height<=360]/best";
      await execFileAsync(bin, [
        "--no-check-certificates",
        "--no-playlist",
        "-f",
        format,
        "--cookies",
        cookiePath,
        "--js-runtimes",
        "node",
        "-o",
        partFile,
        cleanUrl,
      ]);
      if (fs.existsSync(partFile) && fs.statSync(partFile).size > 50000) {
        fs.renameSync(partFile, targetFile);
        console.log(`[YouTube] Successfully downloaded using cookies: ${targetFile}`);
        return targetFile;
      }
    } catch (cookieErr) {
      console.warn(`[YouTube] Cookie-based download failed (${cookieErr?.message || cookieErr}), trying alternate clients...`);
    }
  }

  // 2. If no cookies (or cookie failed), try yt-dlp with Smart TV player client
  try {
    const bin = await ensureYtDlp();
    if (process.platform === "linux" && fs.existsSync(bin)) {
      try { fs.chmodSync(bin, 0o755); } catch {}
    }
    const format = "b[height<=360][ext=mp4]/b[ext=mp4]/best[height<=360]/best";

    const dlpArgs = [
      "--no-check-certificates",
      "--no-playlist",
      "-f",
      format,
      "--extractor-args",
      "youtube:player_client=tv",
      "--js-runtimes",
      "node",
      "-o",
      partFile,
      cleanUrl,
    ];

    await execFileAsync(bin, dlpArgs);
    if (fs.existsSync(partFile) && fs.statSync(partFile).size > 50000) {
      fs.renameSync(partFile, targetFile);
      console.log(`[YouTube] Downloaded with yt-dlp (TV client): ${targetFile}`);
      return targetFile;
    }
  } catch (err) {
    console.warn(`[YouTube] yt-dlp (TV client) failed (${err?.message || err}), trying embedded TV client...`);
    try {
      const bin = await ensureYtDlp();
      const format = "b[height<=360][ext=mp4]/b[ext=mp4]/best[height<=360]/best";
      await execFileAsync(bin, [
        "--no-check-certificates",
        "--no-playlist",
        "-f",
        format,
        "--extractor-args",
        "youtube:player_client=tv_embedded",
        "--js-runtimes",
        "node",
        "-o",
        partFile,
        cleanUrl,
      ]);
      if (fs.existsSync(partFile) && fs.statSync(partFile).size > 50000) {
        fs.renameSync(partFile, targetFile);
        console.log(`[YouTube] Downloaded with yt-dlp (TV embedded client): ${targetFile}`);
        return targetFile;
      }
    } catch (e2) {
      console.warn(`[YouTube] yt-dlp embedded failed, switching to proxy API resolver...`);
    }
  }

  // 2. High-reliability fallback: Invidious Proxy Resolver (bypasses datacenter IP blocks completely)
  try {
    const success = await fetchInvidiousStream(videoId, partFile);
    if (success && fs.existsSync(partFile) && fs.statSync(partFile).size > 50000) {
      fs.renameSync(partFile, targetFile);
      console.log(`[YouTube] Successfully downloaded via proxy resolver: ${targetFile}`);
      return targetFile;
    }
  } catch (e3) {
    console.warn(`[YouTube] Proxy resolver error:`, e3?.message || e3);
  }

  // 3. Fallback: Direct stream URL fetch with native Node pipeline
  try {
    console.log("[YouTube] Resolving direct format with ytdl-core...");
    const info = await ytdl.getInfo(cleanUrl);
    const format = chooseFormat(info.formats, {
      quality: "lowest",
      filter: (f) => f.hasAudio && f.hasVideo,
    });
    if (format && format.url) {
      console.log(`[YouTube] Streaming direct format ${format.itag} via native pipeline...`);
      const res = await fetch(format.url);
      if (res.ok) {
        const fileStream = fs.createWriteStream(partFile);
        const { pipeline } = await import("node:stream/promises");
        await pipeline(res.body, fileStream);
        if (fs.existsSync(partFile) && fs.statSync(partFile).size > 50000) {
          fs.renameSync(partFile, targetFile);
          console.log(`[YouTube] Successfully downloaded via direct stream: ${targetFile}`);
          return targetFile;
        }
      }
    }
  } catch (e) {
    console.warn("[YouTube] Direct stream fetch failed:", e?.message || e);
  }

  // 3. Fallback: ytdl-core download stream
  return new Promise((resolve, reject) => {
    try {
      const ytdlOpts = {
        filter: (format) => format.hasAudio && format.hasVideo && (format.height ? format.height <= 360 : true),
        quality: "lowest",
        highWaterMark: 1 << 20,
      };

      let stream;
      try {
        stream = ytdl.download(cleanUrl, ytdlOpts);
      } catch {
        stream = ytdl.download(cleanUrl, { quality: "lowest", highWaterMark: 1 << 20 });
      }

      const writeStream = fs.createWriteStream(partFile);
      stream.pipe(writeStream);

      writeStream.on("finish", () => {
        try {
          if (fs.existsSync(partFile) && fs.statSync(partFile).size > 50000) {
            fs.renameSync(partFile, targetFile);
            console.log(`[YouTube] Downloaded with ytdl-core: ${targetFile}`);
            resolve(targetFile);
          } else {
            if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
            reject(new Error("Downloaded YouTube file was empty or corrupted"));
          }
        } catch (e) {
          reject(e);
        }
      });

      writeStream.on("error", (e) => {
        try { if (fs.existsSync(partFile)) fs.unlinkSync(partFile); } catch {}
        reject(e);
      });

      stream.on("error", (e) => {
        try { if (fs.existsSync(partFile)) fs.unlinkSync(partFile); } catch {}
        reject(e);
      });
    } catch (e) {
      try { if (fs.existsSync(partFile)) fs.unlinkSync(partFile); } catch {}
      reject(e);
    }
  });
}

class BotSession {
  constructor(config, onUpdate) {
    this.id = config.id || `token-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.token = config.token;
    this.label = config.label || "Discord Account";
    this.autoJoin = !!config.autoJoin;
    this.defaultGuildId = config.defaultGuildId || "";
    this.defaultChannelId = config.defaultChannelId || "";
    this.presence = config.presence || "online";
    this.customStatus = config.customStatus || "";
    this.video = config.video || "";
    this.loop = config.loop !== false;

    this.onUpdate = onUpdate;
    this.client = null;
    this.streamer = null;
    this.streamController = null;

    this.isOnline = false;
    this.isConnecting = false;
    this.isStreaming = false;
    this.streamType = "go-live"; // "go-live" | "cam" | "audio"
    this.currentMedia = null;
    this.currentVoice = null;
    this.user = null;
    this.error = null;
  }

  toJSON() {
    return {
      id: this.id,
      token: this.token,
      maskedToken: this.token ? `${this.token.slice(0, 8)}...${this.token.slice(-6)}` : "",
      label: this.label,
      autoJoin: this.autoJoin,
      defaultGuildId: this.defaultGuildId,
      defaultChannelId: this.defaultChannelId,
      presence: this.presence,
      customStatus: this.customStatus,
      video: this.video,
      loop: this.loop,
      isOnline: this.isOnline,
      isConnecting: this.isConnecting,
      isStreaming: this.isStreaming,
      streamType: this.streamType,
      currentMedia: this.currentMedia,
      currentVoice: this.currentVoice,
      user: this.user,
      error: this.error,
    };
  }

  notify() {
    if (this.onUpdate) this.onUpdate(this);
  }

  async start() {
    if (this.isOnline || this.isConnecting) return;
    if (!this.token || !this.token.trim() || this.token.length < 20) {
      this.isOnline = false;
      this.isConnecting = false;
      this.error = "Token not configured. Click Edit to enter your real Discord token.";
      this.notify();
      return;
    }
    this.isConnecting = true;
    this.error = null;
    this.notify();

    try {
      this.client = new Client({ checkUpdate: false });
      this.streamer = new Streamer(this.client);

      this.client.on("ready", async () => {
        this.isOnline = true;
        this.isConnecting = false;
        this.user = {
          id: this.client.user?.id,
          username: this.client.user?.username,
          discriminator: this.client.user?.discriminator,
          tag: this.client.user?.tag,
          avatar: this.client.user?.displayAvatarURL({ dynamic: true, size: 128 }),
        };
        console.log(`[${this.user.tag}] Ready!`);
        this.applyPresence();

        if (this.autoJoin && this.defaultGuildId && this.defaultChannelId) {
          try {
            await this.joinVoice(this.defaultGuildId, this.defaultChannelId);
            if (this.video) {
              await this.startStream(this.video, "go-live", this.loop);
            }
          } catch (e) {
            console.error(`[${this.user.tag}] Auto-join failed:`, e?.message || e);
          }
        }
        this.notify();
      });

      this.client.on("voiceStateUpdate", (oldState, newState) => {
        if (newState.member?.id === this.client.user?.id) {
          if (newState.channelId) {
            this.currentVoice = {
              guildId: newState.guild.id,
              guildName: newState.guild.name,
              channelId: newState.channelId,
              channelName: newState.channel?.name || "Voice Channel",
            };
          } else {
            this.currentVoice = null;
            this.isStreaming = false;
            this.currentMedia = null;
          }
          this.notify();
        }
      });

      // Discord Chat Command Support
      this.client.on("messageCreate", async (msg) => {
        if (msg.author.bot) return;
        if (msg.author.id !== this.client.user?.id) return;

        const text = msg.content?.trim() || "";
        if (text.startsWith("$play-live") || text.startsWith("$play-cam") || text.startsWith("$play-audio")) {
          const mode = text.startsWith("$play-cam") ? "cam" : text.startsWith("$play-audio") ? "audio" : "go-live";
          const parts = text.split(/\s+/);
          const rawUrl = parts.length > 1 ? parts.slice(1).join(" ") : null;
          const media = rawUrl || msg.attachments.first()?.url || this.video;
          if (!media) return;
          const vc = msg.author.voice?.channel;
          if (vc) {
            await this.joinVoice(msg.guildId, vc.id);
            await this.startStream(media, mode, true);
          }
        } else if (text.startsWith("$stop-stream")) {
          this.stopStream();
        } else if (text.startsWith("$disconnect")) {
          this.leaveVoice();
        }
      });

      await this.client.login(this.token);
    } catch (err) {
      this.isConnecting = false;
      this.isOnline = false;
      this.error = err?.message || String(err);
      console.error(`[${this.label}] Login error:`, this.error);
      this.notify();
    }
  }

  async stop() {
    this.stopStream();
    if (this.streamer) {
      try {
        this.streamer.leaveVoice();
      } catch {}
    }
    if (this.client) {
      try {
        this.client.destroy();
      } catch {}
    }
    this.isOnline = false;
    this.isConnecting = false;
    this.currentVoice = null;
    this.isStreaming = false;
    this.currentMedia = null;
    this.notify();
  }

  applyPresence() {
    if (!this.client?.user) return;
    try {
      this.client.user.setPresence({
        status: this.presence || "online",
      });
      if (this.customStatus) {
        const custom = new CustomStatus(this.client).setState(this.customStatus);
        this.client.user.setActivity(custom);
      } else {
        this.client.user.setActivity(null);
      }
    } catch (e) {
      console.error(`[${this.label}] Failed to set presence:`, e?.message || e);
    }
    this.notify();
  }

  setPresence(status, customStatusText) {
    if (status) this.presence = status;
    if (customStatusText !== undefined) this.customStatus = customStatusText;
    this.applyPresence();
  }

  async joinVoice(guildId, channelId) {
    if (!this.isOnline || !this.streamer) {
      throw new Error("This Discord account is OFFLINE. Please click the yellow 'Edit' button on its card, paste your Discord User Token, and click Save.");
    }
    console.log(`[${this.user?.tag || this.label}] Joining voice: ${guildId}/${channelId}`);
    await this.streamer.joinVoice(guildId, channelId);

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);
      this.currentVoice = {
        guildId,
        guildName: guild.name,
        channelId,
        channelName: channel?.name || "Voice Channel",
      };
    } catch {
      this.currentVoice = { guildId, channelId, guildName: guildId, channelName: channelId };
    }
    this.notify();
  }

  leaveVoice() {
    if (this.streamer) {
      this.stopStream();
      try {
        this.streamer.leaveVoice();
      } catch {}
    }
    this.currentVoice = null;
    this.notify();
  }

  async resolveMediaSource(input, mode = "go-live") {
    if (!input) return null;
    const clean = input.replace(/^["']|["']$/g, "").trim();

    // Check if YouTube
    if (isYouTubeUrl(clean)) {
      return await resolveYouTube(clean, mode === "audio");
    }

    if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;

    const candidates = [
      path.resolve(clean),
      path.resolve(VIDEOS_DIR, clean),
      path.resolve(__dirname, clean),
      path.resolve(__dirname, "..", clean),
      path.resolve(process.cwd(), clean),
      path.resolve(process.cwd(), "dashboard", "videos", clean),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      throw new Error(`Media file "${clean}" not found on server. Please upload an MP4 file from your PC or choose one from the Saved Library.`);
    }
    return clean;
  }

  async startStream(mediaInput, mode = "go-live", loop = true) {
    if (!this.streamer?.voiceConnection) {
      throw new Error("Must join a voice channel before streaming.");
    }

    const resolved = await this.resolveMediaSource(mediaInput, mode);
    if (!resolved) throw new Error("Could not resolve media source or YouTube video.");

    this.stopStream();
    this.streamController = new AbortController();
    const signal = this.streamController.signal;

    this.isStreaming = true;
    this.streamType = mode;
    this.currentMedia = path.basename(resolved);
    this.loop = loop;
    this.video = mediaInput;
    this.notify();

    // Non-blocking streaming loop
    (async () => {
      let cycle = 0;
      let consecutiveErrors = 0;
      while (!signal.aborted) {
        cycle++;
        console.log(`[${this.user?.tag || this.label}] Loop cycle #${cycle}: ${resolved} (Mode: ${mode}, Loop: ${loop})`);
        try {
          // Attempt preparation: if audio mode, demux directly; otherwise try passthrough first
          let prepResult;
          if (mode === "audio") {
            prepResult = await prepareStream(resolved, {}, signal);
          } else {
            try {
              prepResult = await prepareStream(resolved, { noTranscoding: true }, signal);
            } catch (passthroughErr) {
              console.log(`[${this.user?.tag || this.label}] Passthrough mode skipped (${passthroughErr?.message}), using memory-safe 360p profile...`);
              prepResult = await prepareStream(
                resolved,
                {
                  noTranscoding: false,
                  width: 640,
                  height: 360,
                  frameRate: 24,
                  bitrateVideo: 400,
                  bitrateVideoMax: 700,
                  videoCodec: Utils.normalizeVideoCodec("H264"),
                },
                signal
              );
            }
          }

          const { output, promise } = prepResult;

          promise.catch((err) => {
            console.log(`[${this.user?.tag || this.label}] Stream prep error:`, err?.message || err);
          });

          // Determine actual playback mode: if media has only audio, seamlessly route to pure audio mode
          const actualMode = (mode === "audio" || !output.video) ? "audio" : (mode === "cam" ? "cam" : "go-live");
          if (!output.video && mode !== "audio") {
            console.log(`[${this.user?.tag || this.label}] Media has only audio; seamlessly playing in Voice Audio mode.`);
          }

          await playStream(
            output,
            this.streamer,
            {
              type: actualMode,
              keepStreamAlive: loop && !signal.aborted && actualMode !== "audio",
              readrateInitialBurst: actualMode === "audio" ? undefined : 3.0,
            },
            signal
          );

          consecutiveErrors = 0;
          console.log(`[${this.user?.tag || this.label}] Cycle #${cycle} finished.`);
          if (!loop) break;

          // Transition smoothly between loop cycles:
          if (loop && !signal.aborted) {
            console.log(`[${this.user?.tag || this.label}] Loop active: preparing cycle #${cycle + 1}...`);
            try {
              if (this.streamer && actualMode !== "cam" && actualMode !== "audio") {
                this.streamer.stopStream();
              }
            } catch {}
            // Brief pause to let media buffers clear and re-handshake cleanly
            await new Promise((r) => setTimeout(r, actualMode === "audio" ? 400 : 600));
          }
        } catch (err) {
          if (signal.aborted) break;
          consecutiveErrors++;
          console.error(`[${this.user?.tag || this.label}] Stream playback error (cycle #${cycle}, error #${consecutiveErrors}):`, err?.message || err);
          
          // Self-heal: Clean any broken partial/temp files
          if (resolved && (resolved.endsWith(".part") || resolved.endsWith(".tmp"))) {
            console.warn(`[Auto-Clean] Corrupted partial file removed: ${resolved}`);
            try { fs.unlinkSync(resolved); } catch {}
          }

          if (consecutiveErrors >= 5 || !loop) {
            this.error = "Playback stopped: " + (err?.message || err);
            break;
          }

          // Clean reset stream track before retrying next cycle
          try {
            if (this.streamer && mode !== "cam" && mode !== "audio") this.streamer.stopStream();
          } catch {}

          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      this.isStreaming = false;
      this.currentMedia = null;
      this.notify();
      console.log(`[${this.user?.tag || this.label}] Streaming finished.`);
    })();
  }

  stopStream() {
    if (this.streamController) {
      try {
        this.streamController.abort();
      } catch {}
      this.streamController = null;
    }
    if (this.streamer) {
      try {
        this.streamer.stopStream();
      } catch {}
    }
    this.isStreaming = false;
    this.currentMedia = null;
    this.notify();
  }

  async getVoiceChannels() {
    if (!this.client?.guilds) return [];
    const results = [];
    for (const guild of this.client.guilds.cache.values()) {
      try {
        let channelCache = guild.channels?.cache;
        if (!channelCache || channelCache.size === 0) {
          try { await guild.channels.fetch(); } catch {}
          channelCache = guild.channels?.cache;
        }
        const channels = [];
        if (channelCache) {
          for (const ch of channelCache.values()) {
            if (ch.type === "GUILD_VOICE" || ch.type === "GUILD_STAGE_VOICE" || ch.type === 2 || ch.type === 13) {
              channels.push({ id: ch.id, name: ch.name, type: ch.type });
            }
          }
        }
        if (channels.length > 0) {
          results.push({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL?.({ dynamic: true, size: 64 }) || null,
            channels,
          });
        }
      } catch (e) {
        console.warn(`[${this.label}] Failed to list channels for ${guild.name}:`, e?.message);
      }
    }
    return results;
  }
}

class TokenManager {
  constructor() {
    this.sessions = new Map();
    this.load();
  }

  load() {
    try {
      let list = [];
      // 1. Check permanent environment variable first (critical for Render / cloud hosts with ephemeral disks)
      const envTokens = process.env.TOKENS_JSON || process.env.DISCORD_TOKENS;
      if (envTokens) {
        try {
          console.log("[TokenManager] Loading accounts from environment variable (TOKENS_JSON)...");
          list = JSON.parse(envTokens);
        } catch {
          try {
            const decoded = Buffer.from(envTokens, "base64").toString("utf-8");
            list = JSON.parse(decoded);
          } catch {}
        }
      }

      // 2. Fall back to local file if no environment variable provided
      if ((!list || list.length === 0) && fs.existsSync(TOKENS_FILE)) {
        const raw = fs.readFileSync(TOKENS_FILE, "utf-8");
        list = JSON.parse(raw);
      }

      if (Array.isArray(list)) {
        for (const item of list) {
          this.createSession(item);
        }
      }
    } catch (e) {
      console.error("Failed to load tokens file:", e);
    }
  }

  bulkRestore(list) {
    if (!Array.isArray(list) || list.length === 0) return 0;
    let restoredCount = 0;
    for (const item of list) {
      if (!item.token || item.token.length < 20) continue;
      // Look for existing session by id or token
      let session = this.sessions.get(item.id);
      if (!session) {
        for (const s of this.sessions.values()) {
          if (s.token === item.token) {
            session = s;
            break;
          }
        }
      }

      if (session) {
        session.token = item.token;
        if (item.label) session.label = item.label;
        session.autoJoin = !!item.autoJoin;
        if (item.defaultGuildId) session.defaultGuildId = item.defaultGuildId;
        if (item.defaultChannelId) session.defaultChannelId = item.defaultChannelId;
        if (item.presence) session.presence = item.presence;
        if (item.customStatus !== undefined) session.customStatus = item.customStatus;
        if (item.video !== undefined) session.video = item.video;
        if (item.loop !== undefined) session.loop = item.loop;
        session.start();
        restoredCount++;
      } else {
        this.createSession(item);
        restoredCount++;
      }
    }
    this.save();
    return restoredCount;
  }

  save() {
    try {
      const list = Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        token: s.token,
        label: s.label,
        autoJoin: s.autoJoin,
        defaultGuildId: s.defaultGuildId,
        defaultChannelId: s.defaultChannelId,
        presence: s.presence,
        customStatus: s.customStatus,
        video: s.video,
        loop: s.loop,
      }));
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(list, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save tokens file:", e);
    }
  }

  createSession(config) {
    const session = new BotSession(config, (s) => {
      this.save();
      broadcastEvent("token_update", s.toJSON());
    });
    this.sessions.set(session.id, session);
    session.start();
    return session;
  }

  removeSession(id) {
    const s = this.sessions.get(id);
    if (s) {
      s.stop();
      this.sessions.delete(id);
      this.save();
      broadcastEvent("token_deleted", { id });
    }
  }

  getAll() {
    return Array.from(this.sessions.values()).map((s) => s.toJSON());
  }

  get(id) {
    return this.sessions.get(id);
  }
}

const manager = new TokenManager();

// Express Application
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// SSE Live Updates
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: "init", data: manager.getAll() })}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

// Tokens API
app.get("/api/tokens", (req, res) => {
  res.json(manager.getAll());
});

app.post("/api/tokens", (req, res) => {
  const { token, label, autoJoin, defaultGuildId, defaultChannelId, presence, customStatus, video, loop } = req.body;
  if (!token) return res.status(400).json({ success: false, error: "Token is required" });

  const session = manager.createSession({
    token: token.trim(),
    label: label?.trim() || "Account",
    autoJoin: !!autoJoin,
    defaultGuildId: defaultGuildId?.trim() || "",
    defaultChannelId: defaultChannelId?.trim() || "",
    presence: presence || "online",
    customStatus: customStatus || "",
    video: video || "",
    loop: loop !== false,
  });

  manager.save();
  res.json({ success: true, token: session.toJSON() });
});

// Bulk Restore Tokens (from Browser Backup / LocalStorage)
app.post("/api/tokens/bulk-restore", (req, res) => {
  const { tokens } = req.body;
  if (!Array.isArray(tokens)) {
    return res.status(400).json({ success: false, error: "Expected an array of tokens" });
  }
  const restored = manager.bulkRestore(tokens);
  console.log(`[TokenManager] Restored ${restored} accounts from browser backup`);
  res.json({ success: true, restoredCount: restored, tokens: manager.getAll() });
});

// Export Tokens for Render / Cloud Environment Variables
app.get("/api/tokens/export-env", (req, res) => {
  const validSessions = Array.from(manager.sessions.values())
    .filter((s) => s.token && s.token.length >= 20)
    .map((s) => ({
      id: s.id,
      token: s.token,
      label: s.label,
      autoJoin: s.autoJoin,
      defaultGuildId: s.defaultGuildId,
      defaultChannelId: s.defaultChannelId,
      presence: s.presence,
      customStatus: s.customStatus,
      video: s.video,
      loop: s.loop,
    }));

  const jsonString = JSON.stringify(validSessions);
  res.json({
    success: true,
    count: validSessions.length,
    jsonString,
    instructions: "Add an Environment Variable in Render with Key: TOKENS_JSON and Value: <paste jsonString>",
  });
});

app.put("/api/tokens/:id", (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });

  const { label, autoJoin, defaultGuildId, defaultChannelId, presence, customStatus, video, loop, token } = req.body;
  if (label !== undefined) session.label = label;
  if (autoJoin !== undefined) session.autoJoin = !!autoJoin;
  if (defaultGuildId !== undefined) session.defaultGuildId = defaultGuildId;
  if (defaultChannelId !== undefined) session.defaultChannelId = defaultChannelId;
  if (video !== undefined) session.video = video;
  if (loop !== undefined) session.loop = !!loop;
  if (presence !== undefined || customStatus !== undefined) {
    session.setPresence(presence, customStatus);
  }

  if (token && token.trim() !== session.token) {
    session.token = token.trim();
    session.stop().then(() => session.start());
  }

  manager.save();
  broadcastEvent("token_update", session.toJSON());
  res.json({ success: true, token: session.toJSON() });
});

app.delete("/api/tokens/:id", (req, res) => {
  manager.removeSession(req.params.id);
  res.json({ success: true });
});

app.post("/api/tokens/:id/restart", async (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });
  await session.stop();
  await session.start();
  res.json({ success: true });
});

app.post("/api/tokens/:id/presence", (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });
  const { status, customStatus } = req.body;
  session.setPresence(status, customStatus);
  manager.save();
  res.json({ success: true, token: session.toJSON() });
});

app.post("/api/tokens/:id/join", async (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });
  const { guildId, channelId } = req.body;
  if (!guildId || !channelId) {
    return res.status(400).json({ success: false, error: "Guild ID and Channel ID are required" });
  }

  try {
    await session.joinVoice(guildId, channelId);
    res.json({ success: true, currentVoice: session.currentVoice });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post("/api/tokens/:id/leave", (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });
  session.leaveVoice();
  res.json({ success: true });
});

app.post("/api/tokens/:id/stream", async (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });
  const { media, mode = "go-live", loop = true } = req.body;
  const targetMedia = media || session.video;
  if (!targetMedia) {
    return res.status(400).json({ success: false, error: "Please provide a YouTube URL or upload a media file from your PC." });
  }

  try {
    await session.startStream(targetMedia, mode, loop);
    res.json({ success: true, token: session.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post("/api/tokens/:id/stop-stream", (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });
  session.stopStream();
  res.json({ success: true });
});

app.get("/api/tokens/:id/channels", async (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Token not found" });
  try {
    const list = await session.getVoiceChannels();
    res.json({ success: true, guilds: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Bulk Operations
app.post("/api/operations/mass-join", async (req, res) => {
  const { guildId, channelId, tokenIds } = req.body;
  if (!guildId || !channelId) {
    return res.status(400).json({ success: false, error: "guildId and channelId are required" });
  }

  const targets = tokenIds && tokenIds.length > 0
    ? tokenIds.map((id) => manager.get(id)).filter(Boolean)
    : Array.from(manager.sessions.values()).filter((s) => s.isOnline);

  const results = [];
  for (const session of targets) {
    try {
      await session.joinVoice(guildId, channelId);
      results.push({ id: session.id, success: true });
    } catch (e) {
      results.push({ id: session.id, success: false, error: e?.message });
    }
  }

  res.json({ success: true, count: results.filter((r) => r.success).length, results });
});

app.post("/api/operations/mass-stream", async (req, res) => {
  const { media, mode = "go-live", loop = true, tokenIds } = req.body;
  const targets = tokenIds && tokenIds.length > 0
    ? tokenIds.map((id) => manager.get(id)).filter(Boolean)
    : Array.from(manager.sessions.values()).filter((s) => s.currentVoice);

  const streamTarget = media || session.video;
  if (streamTarget) {
    for (const session of targets) {
      try {
        await session.startStream(streamTarget, mode, loop);
      } catch (e) {
        console.error(`[${session.label}] Mass stream failed:`, e?.message);
      }
    }
  }
  res.json({ success: true });
});

app.post("/api/operations/set-all-presence", (req, res) => {
  const { status, customStatus } = req.body;
  for (const session of manager.sessions.values()) {
    session.setPresence(status, customStatus);
  }
  manager.save();
  res.json({ success: true });
});

app.post("/api/operations/restart-all", async (req, res) => {
  for (const session of manager.sessions.values()) {
    await session.stop();
    session.start();
  }
  res.json({ success: true });
});

app.post("/api/operations/disconnect-all", (req, res) => {
  for (const session of manager.sessions.values()) {
    session.leaveVoice();
  }
  res.json({ success: true });
});

app.post("/api/operations/stop-all-streams", (req, res) => {
  for (const session of manager.sessions.values()) {
    session.stopStream();
  }
  res.json({ success: true });
});

// Videos and Media Library API
app.get("/api/videos", (req, res) => {
  try {
    const list = fs.readdirSync(VIDEOS_DIR)
      .filter((f) => /\.(mp4|mkv|mov|avi|webm|mp3|m4a|wav|ogg|flac)$/i.test(f) && !f.endsWith(".part"))
      .map((f) => {
        try {
          const stat = fs.statSync(path.join(VIDEOS_DIR, f));
          return {
            name: f,
            size: stat.size,
            sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + " MB",
            isAudio: /\.(mp3|m4a|wav|ogg|flac)$/i.test(f),
          };
        } catch {
          return { name: f, size: 0, sizeFormatted: "0 MB", isAudio: false };
        }
      });
    res.json({ success: true, videos: list });
  } catch {
    res.json({ success: true, videos: [] });
  }
});

// PC Media Upload Endpoint (Stream-based binary upload, memory < 1MB)
app.post("/api/upload", (req, res) => {
  cleanStorage(); // Auto-clean temp files before handling upload
  const rawFilename = req.headers["x-filename"] || req.query.filename || `upload_${Date.now()}.mp4`;
  const safeFilename = path.basename(decodeURIComponent(rawFilename)).replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!safeFilename || !/\.(mp4|webm|mkv|mov|avi|mp3|wav|m4a|ogg|flac)$/i.test(safeFilename)) {
    return res.status(400).json({
      success: false,
      error: "Invalid file format. Supported media types: MP4, WEBM, MKV, MOV, MP3, WAV, M4A, OGG.",
    });
  }

  const dest = path.join(VIDEOS_DIR, safeFilename);
  const writeStream = fs.createWriteStream(dest);

  req.pipe(writeStream);

  writeStream.on("finish", () => {
    try {
      const stat = fs.statSync(dest);
      console.log(`[Upload] File uploaded from PC: ${safeFilename} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
      res.json({
        success: true,
        filename: safeFilename,
        size: stat.size,
        sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + " MB",
        isAudio: /\.(mp3|m4a|wav|ogg|flac)$/i.test(safeFilename),
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  writeStream.on("error", (err) => {
    console.error("[Upload] Error saving file:", err);
    try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
    res.status(500).json({ success: false, error: err?.message || "File upload failed" });
  });
});

// Delete Media File
app.delete("/api/videos/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const target = path.join(VIDEOS_DIR, filename);
  if (fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
      console.log(`[Media Library] Removed file: ${filename}`);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: err?.message });
    }
  }
  res.status(404).json({ success: false, error: "File not found." });
});

app.post("/api/youtube/download", async (req, res) => {
  const { url, audioOnly = false } = req.body;
  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({ success: false, error: "A valid YouTube URL is required" });
  }

  try {
    const filePath = await resolveYouTube(url, audioOnly);
    res.json({ success: true, filename: path.basename(filePath), path: filePath });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.get("/api/system/stats", (req, res) => {
  const mem = process.memoryUsage();
  const vStats = getVideosFolderStats();
  res.json({
    success: true,
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      maxMB: 256,
      percent: Math.min(100, Math.round((mem.rss / (256 * 1024 * 1024)) * 100)),
    },
    storage: {
      videosMB: Number((vStats.totalBytes / 1024 / 1024).toFixed(1)),
      videosCount: vStats.files.length,
      maxQuotaMB: 512,
    },
    isContainer,
  });
});

app.post("/api/clean-disk", (req, res) => {
  try {
    const freedBytes = cleanStorage({ forceAll: req.body?.deleteAllVideos === true });
    res.json({
      success: true,
      freedMB: (freedBytes / 1024 / 1024).toFixed(2),
      message: "Cache and storage freed successfully!",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: Date.now(),
    sessionsCount: manager?.sessions?.size || 0,
  });
});

const server = http.createServer(app);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n=================================================`);
  console.log(` RedDOGS Multi-Token Video Streamer Dashboard`);
  console.log(` Running on: http://0.0.0.0:${PORT}`);
  console.log(`=================================================\n`);

  // Render & Cloud Free Tier Anti-Sleep Keep-Alive Pinger
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || process.env.EXTERNAL_URL;
  if (selfUrl) {
    console.log(`[Anti-Sleep] Keep-alive self-pinger active for: ${selfUrl}`);
    // Initial ping after 20s
    setTimeout(async () => {
      try {
        await fetch(`${selfUrl}/api/health`, { headers: { "User-Agent": "Render-KeepAlive" } });
      } catch {}
    }, 20000);

    // Recurring ping every 8 minutes (Render free web service sleeps after 15m)
    setInterval(async () => {
      try {
        const res = await fetch(`${selfUrl}/api/health`, {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "Render-KeepAlive" },
        });
        console.log(`[Anti-Sleep] Self-ping status: ${res.status} (keeping Render container awake 24/7)`);
      } catch (e) {
        console.warn(`[Anti-Sleep] Ping note:`, e?.message);
      }
    }, 8 * 60 * 1000);
  }
});
