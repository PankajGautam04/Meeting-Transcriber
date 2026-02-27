// === Meeting Transcriber - Popup Script ===

let BACKEND_URL = 'http://localhost:3001';
let currentTranscriptId = null;

// === DOM Elements ===
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const detectionCard = document.getElementById('detectionCard');
const detectionTitle = document.getElementById('detectionTitle');
const detectionSubtitle = document.getElementById('detectionSubtitle');
const btnRecord = document.getElementById('btnRecord');
const btnText = document.getElementById('btnText');
const btnIcon = document.getElementById('btnIcon');
const timer = document.getElementById('timer');
const timerText = document.getElementById('timerText');
const transcriptArea = document.getElementById('transcriptArea');
const emptyState = document.getElementById('emptyState');
const tabLive = document.getElementById('tabLive');
const tabHistory = document.getElementById('tabHistory');
const tabSettings = document.getElementById('tabSettings');
const panelLive = document.getElementById('panelLive');
const panelHistory = document.getElementById('panelHistory');
const panelSettings = document.getElementById('panelSettings');
const historyList = document.getElementById('historyList');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');
const btnCopyTranscript = document.getElementById('btnCopyTranscript');
const btnDeleteTranscript = document.getElementById('btnDeleteTranscript');
const btnSettings = document.getElementById('btnSettings');
const apiKeyInput = document.getElementById('apiKeyInput');
const btnToggleKey = document.getElementById('btnToggleKey');
const btnSaveKey = document.getElementById('btnSaveKey');
const keyStatus = document.getElementById('keyStatus');
const backendUrlInput = document.getElementById('backendUrlInput');
const btnSaveBackend = document.getElementById('btnSaveBackend');
const backendStatus = document.getElementById('backendStatus');

let isRecording = false;
let timerInterval = null;
let seconds = 0;

// === Speaker Colors ===
const SPEAKER_COLORS = [
  'speaker-0', 'speaker-1', 'speaker-2',
  'speaker-3', 'speaker-4', 'speaker-5'
];

// === Initialize ===
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  checkMeetingTab();
  loadState();
  setupListeners();
});

// === Load Settings from Storage ===
function loadSettings() {
  chrome.storage.sync.get(['deepgramApiKey', 'backendUrl'], (data) => {
    if (data.deepgramApiKey) {
      apiKeyInput.value = data.deepgramApiKey;
      keyStatus.textContent = '✓ Key saved';
      keyStatus.className = 'key-status saved';
    } else {
      keyStatus.textContent = '⚠ No key set';
      keyStatus.className = 'key-status warning';
    }
    if (data.backendUrl) {
      BACKEND_URL = data.backendUrl;
      backendUrlInput.value = data.backendUrl;
    }
  });
}

// === Check for Meeting Tab ===
function checkMeetingTab() {
  chrome.runtime.sendMessage({ type: 'CHECK_MEETING' }, (response) => {
    if (response && response.meetingDetected) {
      detectionCard.classList.add('detected');
      detectionTitle.textContent = 'Meeting detected';
      detectionSubtitle.textContent = response.meetingUrl || 'Active meeting tab found';
      btnRecord.disabled = false;
    } else {
      detectionCard.classList.remove('detected');
      detectionTitle.textContent = 'No meeting detected';
      detectionSubtitle.textContent = 'Open a Google Meet or Zoom call to get started';
      btnRecord.disabled = true;
    }
  });
}

// === Load State ===
function loadState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (response && response.isRecording) {
      setRecordingUI(true);
      seconds = response.elapsed || 0;
      startTimer();
    }
  });
}

// === Set up Event Listeners ===
function setupListeners() {
  // Record button
  btnRecord.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // Tab switching
  tabLive.addEventListener('click', () => switchTab('live'));
  tabHistory.addEventListener('click', () => switchTab('history'));
  tabSettings.addEventListener('click', () => switchTab('settings'));
  btnSettings.addEventListener('click', () => switchTab('settings'));

  // Modal
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  btnCopyTranscript.addEventListener('click', copyTranscript);
  btnDeleteTranscript.addEventListener('click', deleteTranscript);

  // Settings
  btnSaveKey.addEventListener('click', saveApiKey);
  btnSaveBackend.addEventListener('click', saveBackendUrl);
  btnToggleKey.addEventListener('click', toggleKeyVisibility);

  // Listen for transcript updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TRANSCRIPT_UPDATE') {
      addTranscriptSegment(msg.data);
    }
    if (msg.type === 'RECORDING_STOPPED') {
      setRecordingUI(false);
      stopTimer();
    }
  });
}

// === Settings Functions ===
function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = '✗ Key cannot be empty';
    keyStatus.className = 'key-status error';
    return;
  }

  chrome.storage.sync.set({ deepgramApiKey: key }, () => {
    keyStatus.textContent = '✓ Key saved!';
    keyStatus.className = 'key-status saved';
    // Also update the backend config
    chrome.runtime.sendMessage({
      type: 'UPDATE_API_KEY',
      apiKey: key
    });
  });
}

function saveBackendUrl() {
  const url = backendUrlInput.value.trim();
  if (!url) {
    backendStatus.textContent = '✗ URL cannot be empty';
    backendStatus.className = 'key-status error';
    return;
  }

  BACKEND_URL = url;
  chrome.storage.sync.set({ backendUrl: url }, () => {
    backendStatus.textContent = '✓ URL saved!';
    backendStatus.className = 'key-status saved';
    chrome.runtime.sendMessage({
      type: 'UPDATE_BACKEND_URL',
      backendUrl: url
    });
    setTimeout(() => {
      backendStatus.textContent = '';
    }, 2000);
  });
}

function toggleKeyVisibility() {
  const input = apiKeyInput;
  input.type = input.type === 'password' ? 'text' : 'password';
}

// === Start Recording ===
async function startRecording() {
  // Check if API key is set
  const data = await new Promise(resolve =>
    chrome.storage.sync.get(['deepgramApiKey'], resolve)
  );

  if (!data.deepgramApiKey) {
    // Switch to settings tab to prompt user
    switchTab('settings');
    keyStatus.textContent = '⚠ Please set your API key first';
    keyStatus.className = 'key-status error';
    apiKeyInput.focus();
    return;
  }

  clearTranscript();

  chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
    if (response && response.success) {
      setRecordingUI(true);
      startTimer();
      switchTab('live');
    } else {
      console.error('Failed to start recording:', response?.error);
    }
  });
}

// === Stop Recording ===
function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
    setRecordingUI(false);
    stopTimer();
    loadHistory();
  });
}

// === Recording UI State ===
function setRecordingUI(recording) {
  isRecording = recording;

  if (recording) {
    btnRecord.classList.add('recording');
    btnText.textContent = 'Stop Recording';
    btnIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>`;
    statusBadge.classList.add('recording');
    statusText.textContent = 'Recording';
    timer.classList.add('visible');
  } else {
    btnRecord.classList.remove('recording');
    btnText.textContent = 'Start Recording';
    btnIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <circle cx="12" cy="12" r="6"/>
    </svg>`;
    statusBadge.classList.remove('recording');
    statusText.textContent = 'Idle';
    timer.classList.remove('visible');
  }
}

// === Timer ===
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    seconds++;
    timerText.textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  seconds = 0;
  timerText.textContent = '00:00:00';
}

function formatTime(totalSec) {
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// === Transcript ===
function clearTranscript() {
  transcriptArea.innerHTML = '';
  emptyState && transcriptArea.appendChild(emptyState);
}

function addTranscriptSegment(data) {
  // Remove empty state if present
  const empty = transcriptArea.querySelector('.empty-state');
  if (empty) empty.remove();

  const { speaker, text, timestamp, isFinal } = data;
  const speakerIdx = speaker % SPEAKER_COLORS.length;

  // Check if we should update an existing interim segment
  const existingInterim = transcriptArea.querySelector(`.transcript-segment.interim[data-speaker="${speaker}"]`);
  if (existingInterim && !isFinal) {
    existingInterim.querySelector('.segment-text').textContent = text;
    scrollToBottom();
    return;
  }

  // If final and there was an interim, replace it
  if (existingInterim && isFinal) {
    existingInterim.querySelector('.segment-text').textContent = text;
    existingInterim.classList.remove('interim');
    scrollToBottom();
    return;
  }

  // Create new segment
  const segment = document.createElement('div');
  segment.className = `transcript-segment${isFinal ? '' : ' interim'}`;
  segment.dataset.speaker = speaker;

  const speakerLabel = speaker === 0 ? 'You' : `Speaker ${speaker}`;

  segment.innerHTML = `
    <div class="segment-header">
      <span class="speaker-label ${SPEAKER_COLORS[speakerIdx]}">${speakerLabel}</span>
      <span class="segment-time">${formatTimestamp(timestamp)}</span>
    </div>
    <div class="segment-text">${escapeHtml(text)}</div>
  `;

  transcriptArea.appendChild(segment);
  scrollToBottom();
}

function scrollToBottom() {
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const totalSec = Math.floor(ts);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === Tab Switching ===
function switchTab(tab) {
  tabLive.classList.toggle('active', tab === 'live');
  tabHistory.classList.toggle('active', tab === 'history');
  tabSettings.classList.toggle('active', tab === 'settings');
  panelLive.classList.toggle('active', tab === 'live');
  panelHistory.classList.toggle('active', tab === 'history');
  panelSettings.classList.toggle('active', tab === 'settings');

  if (tab === 'history') {
    loadHistory();
  }
}

// === History ===
async function loadHistory() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/transcripts`);
    const json = await res.json();

    // API returns { success, data, count } — extract the array
    const transcripts = json.data || json || [];

    historyList.innerHTML = '';

    if (!Array.isArray(transcripts) || transcripts.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" width="48" height="48" opacity="0.3">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>No saved transcripts yet</p>
      `;
      historyList.appendChild(emptyDiv);
      return;
    }

    transcripts.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.onclick = () => viewTranscript(t.id);

      const date = new Date(t.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      item.innerHTML = `
        <div class="history-icon">
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="history-info">
          <div class="history-title">${escapeHtml(t.title || 'Untitled Meeting')}</div>
          <div class="history-meta">${date} • ${formatDuration(t.duration)} • ${t.speaker_count || 0} speaker(s)</div>
        </div>
        <div class="history-arrow">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      `;

      historyList.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load history:', err);
    historyList.innerHTML = '<div class="empty-state"><p>Cannot connect to server</p></div>';
  }
}

function formatDuration(seconds) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// === View Transcript ===
async function viewTranscript(id) {
  try {
    currentTranscriptId = id;
    const res = await fetch(`${BACKEND_URL}/api/transcripts/${id}`);
    const json = await res.json();

    // API returns { success, data } — extract the transcript object
    const data = json.data || json;

    modalTitle.textContent = data.title || 'Untitled Meeting';
    modalBody.innerHTML = '';

    if (data.segments && data.segments.length) {
      data.segments.forEach((seg) => {
        const speakerIdx = seg.speaker_id % SPEAKER_COLORS.length;
        const div = document.createElement('div');
        div.className = 'transcript-segment';
        div.innerHTML = `
          <div class="segment-header">
            <span class="speaker-label ${SPEAKER_COLORS[speakerIdx]}">${escapeHtml(seg.speaker_label)}</span>
            <span class="segment-time">${formatTimestamp(seg.start_time)}</span>
          </div>
          <div class="segment-text">${escapeHtml(seg.text)}</div>
        `;
        modalBody.appendChild(div);
      });
    } else {
      modalBody.innerHTML = '<div class="empty-state"><p>No segments in this transcript</p></div>';
    }

    modalOverlay.classList.add('visible');
  } catch (err) {
    console.error('Failed to load transcript:', err);
  }
}

// === Copy Transcript ===
function copyTranscript() {
  const segments = modalBody.querySelectorAll('.transcript-segment');
  let text = '';

  segments.forEach((seg) => {
    const speaker = seg.querySelector('.speaker-label')?.textContent || '';
    const content = seg.querySelector('.segment-text')?.textContent || '';
    const time = seg.querySelector('.segment-time')?.textContent || '';
    text += `[${time}] ${speaker}: ${content}\n`;
  });

  navigator.clipboard.writeText(text).then(() => {
    btnCopyTranscript.querySelector('svg + *')?.remove();
    const span = document.createElement('span');
    span.textContent = 'Copied!';
    btnCopyTranscript.appendChild(span);
    setTimeout(() => {
      span.textContent = 'Copy';
    }, 1500);
  });
}

// === Delete Transcript ===
async function deleteTranscript() {
  if (!currentTranscriptId) return;

  try {
    await fetch(`${BACKEND_URL}/api/transcripts/${currentTranscriptId}`, {
      method: 'DELETE'
    });
    closeModal();
    loadHistory();
  } catch (err) {
    console.error('Failed to delete transcript:', err);
  }
}

// === Close Modal ===
function closeModal() {
  modalOverlay.classList.remove('visible');
  currentTranscriptId = null;
}
