// js/app.js (ES module)

// IMPORTANT: frontend (Live Server) 5500, backend 8000
const API_BASE = "http://127.0.0.1:8000";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const LARGE_PDF_CLIENT_PREVIEW_LIMIT = 50 * 1024 * 1024; // 50MB
const PDF_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/legacy/build/pdf.worker.min.js";

const el = (id) => document.getElementById(id);

const dropzone = el("dropzone");
const fileInput = el("fileInput");
const browseBtn = el("browseBtn");
const clearBtn = el("clearBtn");

const fileNameEl = el("fileName");
const fileSizeEl = el("fileSize");
const filePagesEl = el("filePages");

const outputFormatEl = el("outputFormat");
const ocrLanguageEl = el("ocrLanguage");
const fontModeEl = el("fontMode");

const optDenoiseEl = el("optDenoise");
const optDeskewEl = el("optDeskew");
const optContrastEl = el("optContrast");
const optNormalizeDpiEl = el("optNormalizeDpi");
const optLayoutEl = el("optLayout");
const optTablesEl = el("optTables");
const targetDpiEl = el("targetDpi");

const startBtn = el("startBtn");
const pauseBtn = el("pauseBtn");
const resumeBtn = el("resumeBtn");
const cancelBtn = el("cancelBtn");

const statusPill = el("statusPill");
const stageTextEl = el("stageText");
const progressTextEl = el("progressText");
const etaTextEl = el("etaText");
const progressFillEl = el("progressFill");
const logBoxEl = el("logBox");
const downloadAreaEl = el("downloadArea");
const copyLogBtn = el("copyLogBtn");

let selectedFile = null;
let uploadId = null;
let fileId = null;
let jobId = null;

let abortController = null;
let paused = false;
let currentPhase = "idle";

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function appendLog(line) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  logBoxEl.textContent += `\n[${ts}] ${line}`;
  logBoxEl.scrollTop = logBoxEl.scrollHeight;
}

function setStatus({ pill = "wait", stage = "—", progress = 0, eta = "—", logAppend = null }) {
  stageTextEl.textContent = stage;
  progressTextEl.textContent = `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
  etaTextEl.textContent = eta;
  progressFillEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;

  statusPill.classList.remove("soc-pill-wait", "soc-pill-run", "soc-pill-ok", "soc-pill-bad");
  statusPill.classList.add(
    pill === "run" ? "soc-pill-run" :
    pill === "ok" ? "soc-pill-ok" :
    pill === "bad" ? "soc-pill-bad" : "soc-pill-wait"
  );

  statusPill.textContent =
    pill === "run" ? "Running" :
    pill === "ok" ? "Completed" :
    pill === "bad" ? "Error" : "Idle";

  if (logAppend) appendLog(logAppend);
}

function resetUI() {
  selectedFile = null;
  uploadId = null;
  fileId = null;
  jobId = null;
  paused = false;
  currentPhase = "idle";
  abortController = null;

  fileNameEl.textContent = "No file selected";
  fileNameEl.classList.add("soc-muted");
  fileSizeEl.textContent = "—";
  filePagesEl.textContent = "—";

  startBtn.disabled = true;
  clearBtn.disabled = true;
  pauseBtn.disabled = true;
  resumeBtn.disabled = true;
  cancelBtn.disabled = true;

  downloadAreaEl.textContent = "No output yet.";
  downloadAreaEl.classList.add("soc-muted");
  logBoxEl.textContent = "Ready.";

  setStatus({ pill: "wait", stage: "—", progress: 0, eta: "—" });
}

function validateFile(file) {
  const okExt = new Set(["pdf", "jpg", "jpeg", "png", "tif", "tiff"]);
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!okExt.has(ext)) throw new Error("Unsupported file. Please upload PDF, JPG, PNG, or TIFF.");
}

async function tryGetPdfPageCountClient(file) {
  if (file.size > LARGE_PDF_CLIENT_PREVIEW_LIMIT) return null;

  const pdfjs = window.pdfjsLib;
  if (!pdfjs) return null;

  try { pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER; } catch {}

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  return doc.numPages;
}

function uploadResumeKey(file) {
  return `soc:resume:${file.name}:${file.size}:${file.lastModified}`;
}

function setButtonsForPhase() {
  if (currentPhase === "idle") {
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    cancelBtn.disabled = true;
    return;
  }
  if (currentPhase === "uploading" || currentPhase === "converting") {
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
    cancelBtn.disabled = false;
    return;
  }
  if (currentPhase === "done" || currentPhase === "error") {
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    cancelBtn.disabled = true;
  }
}

async function api(path, { method = "GET", headers = {}, body = null, signal } = {}) {
  const url = API_BASE + path; // FIX: always call backend
  const res = await fetch(url, { method, headers, body, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function getOptions() {
  return {
    output: outputFormatEl.value,
    language: ocrLanguageEl.value,
    fontMode: fontModeEl.value,
    preprocessing: {
      denoise: !!optDenoiseEl.checked,
      deskew: !!optDeskewEl.checked,
      contrast: !!optContrastEl.checked,
      normalizeDpi: !!optNormalizeDpiEl.checked,
      layout: !!optLayoutEl.checked,
      tables: !!optTablesEl.checked
    },
    targetDpi: targetDpiEl.value
  };
}

// UI events
browseBtn.addEventListener("click", () => fileInput.click());
clearBtn.addEventListener("click", resetUI);

fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (f) await onFileSelected(f);
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const f = e.dataTransfer.files?.[0];
  if (f) await onFileSelected(f);
});
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

copyLogBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(logBoxEl.textContent || "");
  appendLog("Log copied to clipboard.");
});

pauseBtn.addEventListener("click", async () => {
  paused = true;
  if (abortController) abortController.abort("paused");
  appendLog("Paused.");
  pauseBtn.disabled = true;
  resumeBtn.disabled = false;

  if (currentPhase === "converting" && jobId) {
    try { await api(`/api/job/${jobId}/pause`, { method: "POST" }); } catch {}
  }
});

resumeBtn.addEventListener("click", async () => {
  paused = false;
  appendLog("Resuming...");
  resumeBtn.disabled = true;

  if (currentPhase === "converting" && jobId) {
    try { await api(`/api/job/${jobId}/resume`, { method: "POST" }); } catch {}
    pauseBtn.disabled = false;
    return;
  }

  if ((currentPhase === "uploading" || currentPhase === "idle") && selectedFile) {
    startBtn.click();
  }
});

cancelBtn.addEventListener("click", async () => {
  paused = false;
  if (abortController) abortController.abort("cancelled");
  appendLog("Cancel requested.");

  if (jobId) {
    try { await api(`/api/job/${jobId}/cancel`, { method: "POST" }); } catch {}
  }
  setStatus({ pill: "bad", stage: "Cancelled", progress: 0 });
  currentPhase = "error";
  setButtonsForPhase();
});

async function onFileSelected(file) {
  resetUI();

  try { validateFile(file); }
  catch (err) {
    setStatus({ pill: "bad", stage: "Validation error", progress: 0, logAppend: err.message });
    return;
  }

  selectedFile = file;

  fileNameEl.textContent = file.name;
  fileNameEl.classList.remove("soc-muted");
  fileSizeEl.textContent = humanBytes(file.size);
  filePagesEl.textContent = "Calculating…";

  clearBtn.disabled = false;
  startBtn.disabled = false;

  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const isTiff = /\.(tif|tiff)$/i.test(file.name);

  try {
    if (isPdf) {
      const pages = await tryGetPdfPageCountClient(file);
      filePagesEl.textContent = pages == null ? "Will be detected server-side" : String(pages);
    } else if (isTiff) {
      filePagesEl.textContent = "Multi-page (TIFF)";
    } else {
      filePagesEl.textContent = "1";
    }
  } catch {
    filePagesEl.textContent = "—";
  }
}

appendLog("Start Conversion clicked ✅");

startBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  startBtn.disabled = true;
  clearBtn.disabled = true;
  paused = false;

  try {
    currentPhase = "uploading";
    setButtonsForPhase();
    setStatus({ pill: "run", stage: "Uploading (chunked)", progress: 0, eta: "—", logAppend: "Upload started." });

    const init = await api("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: selectedFile.name,
        size: selectedFile.size,
        mime: selectedFile.type || null
      })
    });

    uploadId = init.uploadId;

    const key = uploadResumeKey(selectedFile);
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    let startChunkIndex = saved?.uploadId === uploadId ? (saved?.nextChunkIndex || 0) : 0;

    await uploadFileInChunks(selectedFile, uploadId, startChunkIndex, key);

    const completed = await api("/api/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId })
    });

    fileId = completed.fileId;
    if (completed.pages) filePagesEl.textContent = String(completed.pages);

    localStorage.removeItem(key);
    appendLog("Upload completed.");

    currentPhase = "converting";
    setButtonsForPhase();
    setStatus({ pill: "run", stage: "OCR processing", progress: 0, eta: "—", logAppend: "Conversion started." });

    const options = getOptions();
    const started = await api("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, options })
    });

    jobId = started.jobId;
    await pollJob(jobId);

  } catch (err) {
    const msg = err?.message || String(err);
    currentPhase = "error";
    setButtonsForPhase();
    setStatus({ pill: "bad", stage: "Failed", progress: 0, logAppend: msg });
    startBtn.disabled = false;
    clearBtn.disabled = false;
  }
});

async function uploadFileInChunks(file, uploadId, startChunkIndex, resumeKey) {
  abortController = new AbortController();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let idx = startChunkIndex; idx < totalChunks; idx++) {
    if (paused) throw new Error("paused");

    const start = idx * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const chunk = file.slice(start, end);

    localStorage.setItem(resumeKey, JSON.stringify({ uploadId, nextChunkIndex: idx }));

    await api("/api/upload/chunk", {
      method: "POST",
      headers: {
        "X-Upload-Id": uploadId,
        "X-Chunk-Index": String(idx),
        "X-Chunk-Total": String(totalChunks),
        "Content-Type": "application/octet-stream"
      },
      body: chunk,
      signal: abortController.signal
    });

    const prog = ((idx + 1) / totalChunks) * 100;
    setStatus({ pill: "run", stage: "Uploading (chunked)", progress: prog, eta: "—" });
  }

  localStorage.setItem(resumeKey, JSON.stringify({ uploadId, nextChunkIndex: totalChunks }));
}

async function pollJob(jobId) {
  while (true) {
    const st = await api(`/api/job/${jobId}/status`, { method: "GET" });

    const progress = Number(st.progress ?? 0);
    const stage = st.stage || st.status || "Processing";
    const eta = (st.etaSeconds != null) ? `${Math.max(0, Math.round(st.etaSeconds))}s` : "—";

    setStatus({ pill: "run", stage, progress, eta });
    if (st.logTail) appendLog(st.logTail);

    if (st.status === "completed") {
      currentPhase = "done";
      setButtonsForPhase();
      setStatus({ pill: "ok", stage: "Completed", progress: 100, eta: "0s", logAppend: "Conversion completed." });

      if (st.downloadUrl) {
        let url = st.downloadUrl;
        if (url.startsWith("/")) url = API_BASE + url; // FIX for download
        downloadAreaEl.classList.remove("soc-muted");
        downloadAreaEl.innerHTML = `<a href="${url}" download>Download output</a>`;
      }
      clearBtn.disabled = false;
      return;
    }

    if (st.status === "failed") {
      currentPhase = "error";
      setButtonsForPhase();
      setStatus({ pill: "bad", stage: "Failed", progress, eta, logAppend: st.error || "Job failed." });
      clearBtn.disabled = false;
      return;
    }

    await new Promise(r => setTimeout(r, 900));
  }
}

resetUI();
appendLog("app.js loaded ✅");
appendLog("Backend URL: " + API_BASE);