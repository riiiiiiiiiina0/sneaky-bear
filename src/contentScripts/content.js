// @ts-nocheck
/* global chrome */

let lastPipVideo = null;

function findBestVideoElement() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  // Prefer the largest visible playing video
  const scored = videos
    .filter((v) => !v.disablePictureInPicture)
    .map((v) => {
      const rect = v.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      const isVisible =
        area > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      const isPlaying = !v.paused && !v.ended && v.readyState > 2;
      return {
        v,
        score: (isVisible ? 2 : 0) + (isPlaying ? 3 : 0) + area / 10000,
      };
    })
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].v : videos[0];
}

async function activatePiP() {
  try {
    // If a PiP is already active in this document, exit first to reset state
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }

    const video = findBestVideoElement();
    if (!video) {
      return false;
    }

    // Ensure video can play
    if (video.paused) {
      try {
        await video.play();
      } catch (_) {
        /* ignore */
      }
    }

    lastPipVideo = video;
    await video.requestPictureInPicture();
    chrome.runtime.sendMessage({ type: 'pip-status', active: true });
    return true;
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
  })();
  return true; // keep the message channel open for async sendResponse
});

// If the page already has PiP element (e.g., after reload), report it
if (document.pictureInPictureElement) {
  chrome.runtime.sendMessage({ type: 'pip-status', active: true });
}
