// @ts-nocheck
/* global chrome */

let lastPipVideo = null;

function getSortedVideoCandidates() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return [];
  const candidates = videos.filter((v) => !v.disablePictureInPicture);
  if (candidates.length === 0) return [];
  const withMetrics = candidates.map((v) => {
    const rect = v.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const isVisible =
      area > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
    const isPlaying = !v.paused && !v.ended && v.readyState > 2;
    return { v, area, isVisible, isPlaying };
  });
  const visible = withMetrics.filter((m) => m.isVisible);
  const pool = visible.length ? visible : withMetrics;
  pool.sort((a, b) => {
    const scoreA =
      (a.isVisible ? 2 : 0) + (a.isPlaying ? 3 : 0) + a.area / 10000;
    const scoreB =
      (b.isVisible ? 2 : 0) + (b.isPlaying ? 3 : 0) + b.area / 10000;
    return scoreB - scoreA;
  });
  return pool.map((m) => m.v);
}

function waitForPlaying(video, timeoutMs = 800) {
  return new Promise((resolve) => {
    let settled = false;
    const onPlaying = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(true);
    };
    const onTimeUpdate = () => {
      if (settled) return;
      if (video.currentTime > 0) {
        settled = true;
        cleanup();
        resolve(true);
      }
    };
    const onCanPlay = () => {
      if (settled) return;
      // give one frame
      requestAnimationFrame(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(true);
        }
      });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener('playing', onPlaying, true);
      video.removeEventListener('timeupdate', onTimeUpdate, true);
      video.removeEventListener('canplay', onCanPlay, true);
    }
    video.addEventListener('playing', onPlaying, true);
    video.addEventListener('timeupdate', onTimeUpdate, true);
    video.addEventListener('canplay', onCanPlay, true);
  });
}

async function activatePiP() {
  try {
    // If a PiP is already active in this document, exit first to reset state
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }

    const candidates = getSortedVideoCandidates();
    for (const video of candidates) {
      let startedByUs = false;
      const wasMuted = video.muted;
      try {
        if (video.paused) {
          try {
            video.playsInline = true;
            video.muted = true;
            await video.play();
            startedByUs = true;
            await waitForPlaying(video);
          } catch (_) {
            // continue to try PiP anyway
          }
        }
        lastPipVideo = video;
        await video.requestPictureInPicture();
        chrome.runtime.sendMessage({ type: 'pip-status', active: true });
        if (!wasMuted) video.muted = false;
        return true;
      } catch (_) {
        try {
          if (startedByUs) video.pause();
        } catch (_) {}
        try {
          if (!wasMuted) video.muted = false;
        } catch (_) {}
        // try next candidate
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

async function deactivatePiP() {
  try {
    const activePipVideo = document.pictureInPictureElement || lastPipVideo;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
    if (activePipVideo) {
      try {
        activePipVideo.pause();
      } catch (_) {
        /* ignore */
      }
    }
    chrome.runtime.sendMessage({ type: 'pip-status', active: false });
    return true;
  } catch (err) {
    return false;
  }
}

// Keep background informed when user manually closes PiP
document.addEventListener(
  'leavepictureinpicture',
  () => {
    chrome.runtime.sendMessage({ type: 'pip-status', active: false });
  },
  true,
);

// Also inform background when PiP is entered by any means (e.g., page UI/context menu)
document.addEventListener(
  'enterpictureinpicture',
  () => {
    chrome.runtime.sendMessage({ type: 'pip-status', active: true });
  },
  true,
);

// Listen for requests from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message && message.type === 'activate-pip') {
      const ok = await activatePiP();
      sendResponse({ ok });
      return;
    }
    if (message && message.type === 'deactivate-pip') {
      const ok = await deactivatePiP();
      sendResponse({ ok });
      return;
    }
    if (message && message.type === 'query-pip-state') {
      const isActive = !!document.pictureInPictureElement;
      sendResponse({ ok: true, active: isActive });
      return;
    }
    if (message && message.type === 'query-is-playing') {
      const isPlaying =
        !!document.pictureInPictureElement || // Already in PiP counts as playing
        !!Array.from(document.querySelectorAll('video')).find(
          (v) =>
            v.readyState > 2 &&
            !v.paused &&
            !v.ended &&
            v.offsetWidth > 0 &&
            v.offsetHeight > 0,
        );
      sendResponse({ ok: true, isPlaying });
      return;
    }
  })();
  return true; // keep the message channel open for async sendResponse
});

// If the page already has PiP element (e.g., after reload), report it
if (document.pictureInPictureElement) {
  chrome.runtime.sendMessage({ type: 'pip-status', active: true });
}
