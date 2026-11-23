// ==========================================================================
// RedDOGS Multi-Token Streamer & VC Suite - Frontend Engine
// ==========================================================================

let tokens = [];
let availableVideos = [];

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  fetchTokens();
  fetchVideos();
  setupSSE();
  setupDragAndDrop();

  // Close modals on Esc key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModals();
  });
});

// Real-Time SSE Listener
function setupSSE() {
  const events = new EventSource("/api/events");
  events.onmessage = (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      if (type === "init" && Array.isArray(data)) {
        tokens = data;
        updateMetrics();
        renderTokensGrid();
      } else if (type === "token_update" || type === "tokens_changed") {
        fetchTokens(false);
      }
    } catch {}
  };
  events.onerror = () => {
    setTimeout(setupSSE, 5000);
  };
}

// Fetch all tokens and update UI
async function fetchTokens(renderLoading = true) {
  try {
    const res = await fetch("/api/tokens");
    const json = await res.json();
    tokens = Array.isArray(json) ? json : (json.tokens || []);

    const hasConfiguredTokens = tokens.some((t) => t.token && t.token.length >= 20);

    if (hasConfiguredTokens) {
      // Save valid tokens to browser localStorage backup
      try {
        localStorage.setItem("reddogs_tokens_backup", JSON.stringify(tokens));
      } catch {}
    } else {
      // Server returned empty tokens (e.g. Render restarted / redeployed)
      // Check if browser has saved backup and auto-restore
      try {
        const saved = localStorage.getItem("reddogs_tokens_backup");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.some((t) => t.token && t.token.length >= 20)) {
            console.log("[Auto-Restore] Cloud container restarted. Restoring accounts from browser backup...");
            const restoreRes = await fetch("/api/tokens/bulk-restore", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tokens: parsed }),
            });
            const restoreJson = await restoreRes.json();
            if (restoreJson.success && restoreJson.tokens) {
              tokens = restoreJson.tokens;
              console.log(`[Auto-Restore] Restored ${restoreJson.restoredCount} accounts!`);
            }
          }
        }
      } catch (e) {
        console.warn("[Auto-Restore] Note:", e);
      }
    }

    updateMetrics();
    renderTokensGrid();
  } catch (err) {
    console.error("Failed to fetch tokens:", err);
    const container = document.getElementById("tokens-grid");
    if (container && (!tokens || tokens.length === 0)) {
      container.innerHTML = `
        <div class="empty-loader">
          <p style="color: #f87171; font-weight: 700; margin-bottom: 8px;">Failed to load accounts: ${escapeHtml(err.message)}</p>
          <button class="btn btn-secondary" onclick="fetchTokens()">Retry Connection</button>
        </div>`;
    }
  }
}

async function exportTokensForRender() {
  try {
    const res = await fetch("/api/tokens/export-env");
    const json = await res.json();
    if (!json.success || !json.jsonString || json.count === 0) {
      alert("No configured accounts found to export. Please add your token first.");
      return;
    }
    await navigator.clipboard.writeText(json.jsonString);
    alert(
      `🎉 Copied TOKENS_JSON to clipboard!\n\nTo keep your tokens PERMANENT on Render:\n1. Open your Render Dashboard -> reddogs-streamer\n2. Click the 'Environment' tab\n3. Click 'Add Environment Variable'\n   - Key: TOKENS_JSON\n   - Value: (Paste from clipboard)\n4. Click 'Save Changes'\n\nNow your accounts will never be lost even if Render restarts!`
    );
  } catch (e) {
    alert("Export error: " + e.message);
  }
}

// Fetch available local videos and audio
async function fetchVideos() {
  try {
    const res = await fetch("/api/videos");
    const json = await res.json();
    if (json.success && Array.isArray(json.videos)) {
      availableVideos = json.videos;
      updateVideoSelects();
    }
  } catch {}
}

function updateVideoSelects() {
  const select = document.getElementById("stream-video-select");
  const listEl = document.getElementById("saved-library-list");

  if (!select) return;

  if (availableVideos.length === 0) {
    select.innerHTML = '<option value="">-- No uploaded media found --</option>';
    if (listEl) listEl.innerHTML = '<span style="color: #888; font-size: 12px;">No videos stored in dashboard/videos/</span>';
    return;
  }

  select.innerHTML = availableVideos
    .map((v) => {
      const name = typeof v === "string" ? v : v.name;
      const sizeStr = v.sizeFormatted ? ` (${v.sizeFormatted})` : "";
      const icon = v.isAudio ? "🎵 " : "🎬 ";
      return `<option value="${escapeHtml(name)}">${icon}${escapeHtml(name)}${sizeStr}</option>`;
    })
    .join("");

  if (listEl) {
    listEl.innerHTML = availableVideos
      .map((v) => {
        const name = typeof v === "string" ? v : v.name;
        const sizeStr = v.sizeFormatted ? v.sizeFormatted : "";
        const icon = v.isAudio ? "🎵" : "🎬";
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 5px 8px; border-radius: 4px; font-size: 12px;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;" title="${escapeHtml(name)}">${icon} ${escapeHtml(name)} (${sizeStr})</span>
            <button type="button" class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px; color: #ff5252;" onclick="deleteMediaFile('${escapeHtml(name)}')">🗑️</button>
          </div>
        `;
      })
      .join("");
  }
}

async function cleanDiskStorage() {
  const btn = document.getElementById("btn-free-storage");
  if (btn) btn.textContent = "⏳ Freeing...";
  try {
    const res = await fetch("/api/clean-disk", { method: "POST" });
    const json = await res.json();
    if (json.success) {
      alert(`Storage & RAM cleaned successfully! Reclaimed ${json.freedMB || 0} MB.`);
      fetchVideos();
    } else {
      alert("Clean failed: " + json.error);
    }
  } catch (e) {
    alert("Error cleaning storage: " + e.message);
  } finally {
    if (btn) btn.textContent = "🧹 Free Storage & RAM";
  }
}

async function deleteMediaFile(filename) {
  if (!filename) return;
  if (!confirm(`Delete "${filename}" from server storage to free space?`)) return;
  try {
    const res = await fetch(`/api/videos/${encodeURIComponent(filename)}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) {
      fetchVideos();
    } else {
      alert("Failed to delete: " + json.error);
    }
  } catch (e) {
    alert("Delete error: " + e.message);
  }
}

// Update Top Metric Stat Counters
function updateMetrics() {
  const total = tokens.length;
  const online = tokens.filter((t) => t.isOnline).length;
  const streaming = tokens.filter((t) => t.isStreaming).length;
  const inVoice = tokens.filter((t) => t.currentVoice !== null).length;

  document.getElementById("metric-total").textContent = total;
  document.getElementById("metric-online").textContent = online;
  document.getElementById("metric-streaming").textContent = streaming;
  document.getElementById("metric-in-voice").textContent = inVoice;
}

// Render Account Cards
function renderTokensGrid() {
  const container = document.getElementById("tokens-grid");
  if (!container) return;

  if (tokens.length === 0) {
    container.innerHTML = `
      <div class="empty-loader">
        <p style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 8px;">No Discord accounts connected</p>
        <p style="color: var(--text-muted); margin-bottom: 16px;">Add your Discord user token to start joining voice channels and streaming.</p>
        <button class="btn btn-primary" onclick="openNewTokenModal()">+ Add Discord Account</button>
      </div>`;
    return;
  }

  container.innerHTML = tokens.map((token) => renderTokenCard(token)).join("");
}

function renderTokenCard(token) {
  let cardClass = "account-card";
  let statusBadge = "";
  let statusDotClass = "status-offline";

  if (token.isStreaming) {
    cardClass += " is-streaming";
    statusDotClass = "status-streaming";
    const modeLabel = token.streamType === "cam" ? "CAM" : token.streamType === "audio" ? "AUDIO" : "LIVE";
    statusBadge = `<span class="status-badge badge-streaming">● ${modeLabel}</span>`;
  } else if (token.isOnline) {
    cardClass += " is-online";
    if (token.presence === "idle") {
      statusDotClass = "status-idle";
      statusBadge = `<span class="status-badge badge-idle">● IDLE</span>`;
    } else if (token.presence === "dnd") {
      statusDotClass = "status-dnd";
      statusBadge = `<span class="status-badge badge-dnd">● DND</span>`;
    } else {
      statusDotClass = "status-online";
      statusBadge = `<span class="status-badge badge-online">● ONLINE</span>`;
    }
  } else if (token.isConnecting) {
    statusDotClass = "status-idle";
    statusBadge = `<span class="status-badge badge-idle">● CONNECTING</span>`;
  } else {
    statusBadge = `<span class="status-badge badge-offline">● OFFLINE</span>`;
  }

  const avatarUrl = token.user?.avatar || "logo.png";
  const displayName = token.user?.username || token.label || "Discord Account";
  const tag = token.user?.discriminator && token.user.discriminator !== "0" ? `#${token.user.discriminator}` : "";

  // Voice connection status display
  let voiceHtml = `
    <div class="detail-item">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path></svg>
      <span>Voice: Disconnected</span>
    </div>`;

  if (token.currentVoice) {
    voiceHtml = `
      <div class="voice-connected-box">
        <span style="display: flex; align-items: center; gap: 6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          In #${escapeHtml(token.currentVoice.channelName)} (${escapeHtml(token.currentVoice.guildName)})
        </span>
        <button class="btn-micro" style="color: #fca5a5;" onclick="leaveVoice('${token.id}')">Leave</button>
      </div>`;
  }

  // Streaming status display
  let streamHtml = "";
  if (token.isStreaming) {
    const typeLabel = token.streamType === "cam" ? "Webcam Video" : token.streamType === "audio" ? "Audio Player" : "Screen Share";
    streamHtml = `
      <div class="streaming-box">
        <span style="display: flex; align-items: center; gap: 6px;">
          <div class="waveform-bars">
            <span class="waveform-bar"></span>
            <span class="waveform-bar"></span>
            <span class="waveform-bar"></span>
            <span class="waveform-bar"></span>
          </div>
          ${escapeHtml(typeLabel)}: ${escapeHtml(token.currentMedia || "")}
        </span>
        <button class="btn-micro" style="color: #fca5a5;" onclick="stopStream('${token.id}')">Stop</button>
      </div>`;
  }

  // Offline / Error warning box with 1-click Edit button
  let errorHtml = "";
  if (!token.isOnline) {
    errorHtml = `
      <div class="card-error-alert">
        <span>⚠️ Account Offline: Enter Discord token to connect</span>
        <button class="btn-micro" style="color: #fca5a5; border-color: rgba(239, 68, 68, 0.4);" onclick="openEditTokenModal('${token.id}')">Edit Token</button>
      </div>`;
  } else if (token.error) {
    errorHtml = `
      <div class="card-error-alert">
        <span>⚠️ ${escapeHtml(token.error)}</span>
      </div>`;
  }

  const customStatusText = token.customStatus ? `"${escapeHtml(token.customStatus)}"` : "No custom status";

  return `
    <div class="${cardClass}" id="card-${token.id}">
      <div class="card-top">
        <div class="profile-group">
          <div class="avatar-wrapper">
            <img class="account-avatar" src="${avatarUrl}" alt="${escapeHtml(displayName)}" onerror="this.src='logo.png'">
            <span class="avatar-status-dot ${statusDotClass}"></span>
          </div>
          <div class="profile-info">
            <div class="account-name">
              ${escapeHtml(displayName)}
              <span class="client-badge">PRO</span>
            </div>
            <div class="account-tag">${tag ? escapeHtml(tag) : escapeHtml(token.maskedToken || "Unset")}</div>
          </div>
        </div>
        ${statusBadge}
      </div>

      <div class="card-details">
        <div class="detail-item" style="color: var(--text-muted); font-style: italic;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${customStatusText}</span>
        </div>
        ${voiceHtml}
        ${streamHtml}
        ${errorHtml}
      </div>

      <div class="card-actions-wrapper">
        <div class="actions-primary-row">
          ${
            !token.currentVoice
              ? `<button class="act-btn act-join" onclick="openJoinVcModal('${token.id}')">🔊 Join VC</button>`
              : `<button class="act-btn act-leave" onclick="leaveVoice('${token.id}')">🚪 Leave VC</button>`
          }

          ${
            token.isStreaming && token.streamType === "go-live"
              ? `<button class="act-btn act-stop" onclick="stopStream('${token.id}')">⏹️ Live OFF</button>`
              : `<button class="act-btn act-live" onclick="quickStream('${token.id}', 'go-live')">⚡ Live ON</button>`
          }

          ${
            token.isStreaming && token.streamType === "cam"
              ? `<button class="act-btn act-stop" onclick="stopStream('${token.id}')">⏹️ Cam OFF</button>`
              : `<button class="act-btn act-cam" onclick="quickStream('${token.id}', 'cam')">📹 Cam ON</button>`
          }

          ${
            token.isStreaming && token.streamType === "audio"
              ? `<button class="act-btn act-stop" onclick="stopStream('${token.id}')">⏹️ Audio OFF</button>`
              : `<button class="act-btn act-audio" onclick="quickStream('${token.id}', 'audio')">🎵 Audio</button>`
          }
        </div>

        <div class="actions-utility-row">
          <button class="act-btn act-subtle" onclick="openEditTokenModal('${token.id}')">✏️ Edit Token</button>
          <button class="act-btn act-subtle" onclick="restartToken('${token.id}')">🔄 Restart</button>
          <button class="act-btn act-subtle act-danger" onclick="deleteToken('${token.id}')">🗑️ Delete</button>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// 1-Click Join Voice Channel Modal (No Manual Typing Required)
// ==========================================================================

async function openJoinVcModal(tokenId) {
  closeModals();
  const token = tokens.find((t) => t.id === tokenId);
  if (!token) return;

  if (!token.isOnline) {
    alert("⚠️ This account is currently OFFLINE.\n\nPlease click 'Edit Token' on its card, enter your real Discord User Token, and click Save so it goes ONLINE first.");
    return;
  }

  document.getElementById("join-vc-token-id").value = tokenId;
  document.getElementById("join-vc-account-name").textContent = `Select voice channel for ${token.user?.username || token.label}`;
  document.getElementById("join-vc-manual-guild").value = token.defaultGuildId || "";
  document.getElementById("join-vc-manual-channel").value = token.defaultChannelId || "";

  const select = document.getElementById("join-vc-channel-select");
  select.innerHTML = '<option value="">Loading accessible channels...</option>';
  document.getElementById("modal-join-vc").classList.add("active");

  try {
    const res = await fetch(`/api/tokens/${tokenId}/channels`);
    const json = await res.json();
    if (json.success && json.guilds && json.guilds.length > 0) {
      select.innerHTML = '<option value="">-- Choose a Voice Channel to Join --</option>';
      for (const g of json.guilds) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = `🏰 ${g.name}`;
        for (const ch of g.channels) {
          const opt = document.createElement("option");
          opt.value = `${g.id}|${ch.id}`;
          opt.textContent = `🔊 ${ch.name}`;
          if (token.defaultChannelId === ch.id) opt.selected = true;
          optgroup.appendChild(opt);
        }
        select.appendChild(optgroup);
      }
    } else {
      select.innerHTML = '<option value="">No channels found (you can enter IDs manually below)</option>';
    }
  } catch {
    select.innerHTML = '<option value="">Could not load channels (enter IDs manually below)</option>';
  }
}

async function submitJoinVoiceOnly() {
  const tokenId = document.getElementById("join-vc-token-id").value;
  const selectVal = document.getElementById("join-vc-channel-select").value;
  let guildId = document.getElementById("join-vc-manual-guild").value.trim();
  let channelId = document.getElementById("join-vc-manual-channel").value.trim();

  // If user selected from dropdown, use it!
  if (selectVal && selectVal.includes("|")) {
    const parts = selectVal.split("|");
    guildId = parts[0];
    channelId = parts[1];
  }

  if (!guildId || !channelId) {
    alert("Please select a Voice Channel from the list (or enter Guild & Channel IDs manually).");
    return;
  }

  try {
    const joinRes = await fetch(`/api/tokens/${tokenId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId, channelId }),
    });
    const joinJson = await joinRes.json();
    if (joinJson.success) {
      closeModals();
      fetchTokens();
    } else {
      alert("Failed to join voice channel: " + joinJson.error);
    }
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

// ==========================================================================
// PC Media Upload (Drag & Drop + File Selection)
// ==========================================================================

function setupDragAndDrop() {
  const dropzone = document.getElementById("upload-dropzone");
  if (!dropzone) return;

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      uploadFile(files[0]);
    }
  });
}

function handleFileSelected(event) {
  const files = event.target.files;
  if (files && files.length > 0) {
    uploadFile(files[0]);
  }
}

function uploadFile(file) {
  if (!file) return;

  const validExts = /\.(mp4|webm|mkv|mov|avi|mp3|wav|m4a|ogg|flac)$/i;
  if (!validExts.test(file.name)) {
    alert("Please select a valid media file:\nMP4, WEBM, MKV, MOV, MP3, WAV, M4A, OGG");
    return;
  }

  const progressWrap = document.getElementById("upload-progress-wrap");
  const progressFill = document.getElementById("upload-progress-fill");
  const progressInfo = document.getElementById("upload-progress-info");
  const uploadedPill = document.getElementById("uploaded-file-pill");

  progressWrap.style.display = "flex";
  uploadedPill.style.display = "none";
  progressFill.style.width = "0%";
  progressInfo.textContent = `Uploading ${file.name}: 0%`;

  const xhr = new XMLHttpRequest();
  const safeFilename = encodeURIComponent(file.name);
  xhr.open("POST", `/api/upload?filename=${safeFilename}`);
  xhr.setRequestHeader("x-filename", safeFilename);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = `${pct}%`;
      progressInfo.textContent = `Uploading ${file.name}: ${pct}% (${(e.loaded / 1024 / 1024).toFixed(1)}MB / ${(e.total / 1024 / 1024).toFixed(1)}MB)`;
    }
  };

  xhr.onload = () => {
    progressWrap.style.display = "none";
    if (xhr.status === 200) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.success) {
          document.getElementById("uploaded-media-filename").value = res.filename;
          document.getElementById("uploaded-file-name").textContent = res.filename;
          document.getElementById("uploaded-file-size").textContent = res.sizeFormatted;
          document.getElementById("uploaded-file-badge").textContent = res.isAudio ? "AUDIO" : "VIDEO";
          uploadedPill.style.display = "flex";
          fetchVideos(); // Refresh library dropdown
        } else {
          alert("Upload failed: " + res.error);
        }
      } catch {
        alert("Upload parsing error.");
      }
    } else {
      alert("Upload failed with HTTP status: " + xhr.status);
    }
  };

  xhr.onerror = () => {
    progressWrap.style.display = "none";
    alert("Network error during file upload.");
  };

  xhr.send(file);
}

function clearUploadedFile() {
  document.getElementById("uploaded-media-filename").value = "";
  document.getElementById("uploaded-file-pill").style.display = "none";
  document.getElementById("media-file-input").value = "";
}

async function deleteSelectedMedia() {
  const select = document.getElementById("stream-video-select");
  const filename = select.value;
  if (!filename) {
    alert("Please select a file to delete.");
    return;
  }

  if (!confirm(`Delete "${filename}" from server storage?`)) return;

  try {
    const res = await fetch(`/api/videos/${encodeURIComponent(filename)}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) {
      fetchVideos();
    } else {
      alert("Failed to delete: " + json.error);
    }
  } catch (e) {
    alert("Delete error: " + e.message);
  }
}

// ==========================================================================
// Stream Modal (Audio Player, Screen Share, Camera)
// ==========================================================================

function quickStream(tokenId, mode) {
  openStreamModal(tokenId, mode);
}

async function openStreamModal(tokenId, defaultMode = "go-live") {
  closeModals();
  const token = tokens.find((t) => t.id === tokenId);
  if (!token) return;

  if (!token.isOnline) {
    alert("⚠️ This account is currently OFFLINE.\n\nPlease click 'Edit Token' on its card, paste your Discord User Token, and click Save so it connects first.");
    return;
  }

  document.getElementById("stream-token-id").value = tokenId;
  document.getElementById("stream-account-name").textContent = `Configure streaming for ${token.user?.username || token.label}`;
  document.getElementById("stream-manual-guild").value = token.defaultGuildId || token.currentVoice?.guildId || "";
  document.getElementById("stream-manual-channel").value = token.defaultChannelId || token.currentVoice?.channelId || "";
  document.getElementById("stream-loop").checked = true;

  setStreamTab(defaultMode);

  // If account is ALREADY in voice, show banner and hide channel picker
  const currentVcBadge = document.getElementById("stream-current-vc-badge");
  const currentVcText = document.getElementById("stream-current-vc-text");
  const vcSelect = document.getElementById("stream-vc-select");
  const manualAccordion = document.getElementById("stream-manual-accordion");

  if (token.currentVoice) {
    currentVcBadge.style.display = "flex";
    currentVcText.textContent = `Connected in #${token.currentVoice.channelName} (${token.currentVoice.guildName}) ✅`;
    vcSelect.style.display = "none";
    manualAccordion.style.display = "none";
  } else {
    currentVcBadge.style.display = "none";
    vcSelect.style.display = "block";
    manualAccordion.style.display = "block";
    vcSelect.innerHTML = '<option value="">Loading accessible channels...</option>';

    try {
      const res = await fetch(`/api/tokens/${tokenId}/channels`);
      const json = await res.json();
      if (json.success && json.guilds && json.guilds.length > 0) {
        vcSelect.innerHTML = '<option value="">-- Choose a Voice Channel to Join --</option>';
        for (const g of json.guilds) {
          const optgroup = document.createElement("optgroup");
          optgroup.label = `🏰 ${g.name}`;
          for (const ch of g.channels) {
            const opt = document.createElement("option");
            opt.value = `${g.id}|${ch.id}`;
            opt.textContent = `🔊 ${ch.name}`;
            optgroup.appendChild(opt);
          }
          vcSelect.appendChild(optgroup);
        }
      } else {
        vcSelect.innerHTML = '<option value="">No channels found (enter IDs manually below)</option>';
      }
    } catch {
      vcSelect.innerHTML = '<option value="">Could not load channels (enter IDs manually below)</option>';
    }
  }

  document.getElementById("modal-stream").classList.add("active");
}

function setStreamTab(mode) {
  document.getElementById("stream-type").value = mode;
  document.querySelectorAll(".stream-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-mode") === mode);
  });
}

function onMediaSourceToggle(type) {
  document.getElementById("media-input-upload").style.display = type === "upload" ? "block" : "none";
  document.getElementById("media-input-youtube").style.display = type === "youtube" ? "block" : "none";
  document.getElementById("media-input-local").style.display = type === "local" ? "block" : "none";
}

async function submitStartStream() {
  const tokenId = document.getElementById("stream-token-id").value;
  const token = tokens.find((t) => t.id === tokenId);
  const streamType = document.getElementById("stream-type").value;
  const loop = document.getElementById("stream-loop").checked;

  const mediaSourceType = document.querySelector('input[name="media-src-type"]:checked').value;
  let media = "";

  if (mediaSourceType === "upload") {
    media = document.getElementById("uploaded-media-filename").value.trim();
    if (!media) {
      alert("Please upload a media file from your PC first, or switch to YouTube / Saved Library.");
      return;
    }
  } else if (mediaSourceType === "youtube") {
    media = document.getElementById("stream-youtube-url").value.trim();
    if (!media) {
      alert("Please paste a valid YouTube video or song link.");
      return;
    }
  } else {
    media = document.getElementById("stream-video-select").value;
  }

  // Determine Guild and Voice Channel
  let guildId = token?.currentVoice?.guildId || "";
  let channelId = token?.currentVoice?.channelId || "";

  if (!channelId) {
    const selectVal = document.getElementById("stream-vc-select").value;
    const manualGuild = document.getElementById("stream-manual-guild").value.trim();
    const manualChannel = document.getElementById("stream-manual-channel").value.trim();

    if (selectVal && selectVal.includes("|")) {
      const parts = selectVal.split("|");
      guildId = parts[0];
      channelId = parts[1];
    } else if (manualGuild && manualChannel) {
      guildId = manualGuild;
      channelId = manualChannel;
    }

    if (!guildId || !channelId) {
      alert("Please choose a Voice Channel from the list to join.");
      return;
    }

    // Join VC first
    try {
      const joinRes = await fetch(`/api/tokens/${tokenId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId, channelId }),
      });
      const joinJson = await joinRes.json();
      if (!joinJson.success) {
        alert("Failed to join voice channel: " + joinJson.error);
        return;
      }
    } catch (e) {
      alert("Failed to join voice channel: " + e.message);
      return;
    }
  }

  // Start Streaming
  try {
    const streamRes = await fetch(`/api/tokens/${tokenId}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media, mode: streamType, loop }),
    });
    const streamJson = await streamRes.json();
    if (streamJson.success) {
      closeModals();
      fetchTokens();
    } else {
      alert("Failed to start stream: " + streamJson.error);
    }
  } catch (e) {
    alert("Stream error: " + e.message);
  }
}

// Stop Stream & Leave VC
async function stopStream(tokenId) {
  try {
    await fetch(`/api/tokens/${tokenId}/stop-stream`, { method: "POST" });
    fetchTokens();
  } catch (e) {
    console.error("Stop stream error:", e);
  }
}

async function leaveVoice(tokenId) {
  try {
    await fetch(`/api/tokens/${tokenId}/leave`, { method: "POST" });
    fetchTokens();
  } catch (e) {
    console.error("Leave voice error:", e);
  }
}

// ==========================================================================
// Mass VC Join Modal
// ==========================================================================

async function openMassJoinModal() {
  closeModals();
  const onlineToken = tokens.find((t) => t.isOnline);
  if (!onlineToken) {
    alert("Please ensure at least one account is ONLINE to load voice channels.");
    return;
  }

  const checklist = document.getElementById("mass-tokens-checklist");
  checklist.innerHTML = tokens
    .map(
      (t) => `
    <label class="checklist-item">
      <input type="checkbox" class="mass-token-cb" value="${t.id}" ${t.isOnline ? "checked" : ""}>
      <span style="display: flex; align-items: center; gap: 6px;">
        <span class="dot ${t.isOnline ? "dot-online" : "dot-dnd"}"></span>
        <strong>${escapeHtml(t.user?.username || t.label)}</strong>
        <small style="color: var(--text-muted);">${t.isOnline ? "(Online)" : "(Offline)"}</small>
      </span>
    </label>`
    )
    .join("");

  const select = document.getElementById("mass-vc-select");
  select.innerHTML = '<option value="">Loading channels...</option>';
  document.getElementById("modal-mass-join").classList.add("active");

  try {
    const res = await fetch(`/api/tokens/${onlineToken.id}/channels`);
    const json = await res.json();
    if (json.success && json.guilds && json.guilds.length > 0) {
      select.innerHTML = '<option value="">-- Choose a Voice Channel to Join --</option>';
      for (const g of json.guilds) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = `🏰 ${g.name}`;
        for (const ch of g.channels) {
          const opt = document.createElement("option");
          opt.value = `${g.id}|${ch.id}`;
          opt.textContent = `🔊 ${ch.name}`;
          optgroup.appendChild(opt);
        }
        select.appendChild(optgroup);
      }
    } else {
      select.innerHTML = '<option value="">No channels found (enter IDs manually below)</option>';
    }
  } catch {
    select.innerHTML = '<option value="">Could not load channels</option>';
  }
}

function onMassVcChanged() {
  const val = document.getElementById("mass-vc-select").value;
  if (val && val.includes("|")) {
    const [guildId, channelId] = val.split("|");
    document.getElementById("mass-guild-id").value = guildId;
    document.getElementById("mass-channel-id").value = channelId;
  }
}

function selectAllMassTokens(select) {
  document.querySelectorAll(".mass-token-cb").forEach((cb) => (cb.checked = select));
}

async function submitMassJoin() {
  const selectVal = document.getElementById("mass-vc-select").value;
  let guildId = document.getElementById("mass-guild-id").value.trim();
  let channelId = document.getElementById("mass-channel-id").value.trim();

  if (selectVal && selectVal.includes("|")) {
    const parts = selectVal.split("|");
    guildId = parts[0];
    channelId = parts[1];
  }

  if (!guildId || !channelId) {
    alert("Please select a Voice Channel to join.");
    return;
  }

  const tokenIds = Array.from(document.querySelectorAll(".mass-token-cb:checked")).map((cb) => cb.value);
  if (tokenIds.length === 0) {
    alert("Please select at least one account.");
    return;
  }

  try {
    const res = await fetch("/api/operations/mass-join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId, channelId, tokenIds }),
    });
    const json = await res.json();
    if (json.success) {
      closeModals();
      fetchTokens();
    } else {
      alert("Mass join failed: " + json.error);
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}

// ==========================================================================
// Account Form Modal (Add / Edit)
// ==========================================================================

function openNewTokenModal() {
  closeModals();
  document.getElementById("form-token-id").value = "";
  document.getElementById("token-form-title").textContent = "Add Discord Account";
  document.getElementById("form-token-input").value = "";
  document.getElementById("form-label-input").value = "";
  document.getElementById("form-presence-input").value = "online";
  document.getElementById("form-custom-status-input").value = "";
  document.getElementById("modal-token-form").classList.add("active");
}

function openEditTokenModal(tokenId) {
  closeModals();
  const token = tokens.find((t) => t.id === tokenId);
  if (!token) return;

  document.getElementById("form-token-id").value = token.id;
  document.getElementById("token-form-title").textContent = `Edit ${token.user?.username || token.label}`;
  document.getElementById("form-token-input").value = token.token || "";
  document.getElementById("form-label-input").value = token.label || "";
  document.getElementById("form-presence-input").value = token.presence || "online";
  document.getElementById("form-custom-status-input").value = token.customStatus || "";
  document.getElementById("modal-token-form").classList.add("active");
}

async function submitTokenForm() {
  const id = document.getElementById("form-token-id").value;
  const token = document.getElementById("form-token-input").value.trim();
  const label = document.getElementById("form-label-input").value.trim();
  const presence = document.getElementById("form-presence-input").value;
  const customStatus = document.getElementById("form-custom-status-input").value.trim();

  if (!token) {
    alert("Please enter a Discord User Token.");
    return;
  }

  const payload = { token, label, presence, customStatus };
  const method = id ? "PUT" : "POST";
  const url = id ? `/api/tokens/${id}` : "/api/tokens";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.success) {
      closeModals();
      fetchTokens();
    } else {
      alert("Error: " + json.error);
    }
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

function toggleTokenVisibility() {
  const input = document.getElementById("form-token-input");
  input.type = input.type === "password" ? "text" : "password";
}

// Token Actions: Restart / Delete
async function restartToken(tokenId) {
  try {
    await fetch(`/api/tokens/${tokenId}/restart`, { method: "POST" });
    fetchTokens();
  } catch (e) {
    console.error("Restart error:", e);
  }
}

async function deleteToken(tokenId) {
  if (!confirm("Are you sure you want to remove this Discord account?")) return;
  try {
    await fetch(`/api/tokens/${tokenId}`, { method: "DELETE" });
    fetchTokens();
  } catch (e) {
    console.error("Delete error:", e);
  }
}

// Bulk Operations
async function bulkSetPresence(status) {
  try {
    await fetch("/api/operations/set-all-presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchTokens();
  } catch {}
}

async function bulkRestart() {
  try {
    await fetch("/api/operations/restart-all", { method: "POST" });
    fetchTokens();
  } catch {}
}

async function bulkDisconnectVCs() {
  try {
    await fetch("/api/operations/disconnect-all", { method: "POST" });
    fetchTokens();
  } catch {}
}

async function bulkStopStreams() {
  try {
    await fetch("/api/operations/stop-all-streams", { method: "POST" });
    fetchTokens();
  } catch {}
}

// Utility: Modal close & escape HTML
function closeModals() {
  document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.remove("active"));
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}