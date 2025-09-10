// @ts-nocheck
/* global chrome */
(() => {
  const SENTINEL = Symbol('sbpip_attached');

  function send(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, ...payload });
    } catch (e) {
      // Ignore if context is unloading
    }
  }

  function handlePlay() {
    send('VIDEO_PLAYING');
  }

  function handlePause() {
    send('VIDEO_PAUSED');
  }

  function handleEnterPiP() {
    send('PIP_ENTERED');
  }

  function handleLeavePiP() {
    send('PIP_EXITED');
  }

  /** @param {HTMLVideoElement} video */
  function attachVideoListeners(video) {
    if (!video || video[SENTINEL]) return;
    video[SENTINEL] = true;

    // Try to ensure PiP isn't disabled by page
    try {
      video.disablePictureInPicture = false;
    } catch (_) {}

    video.addEventListener('play', handlePlay, true);
    video.addEventListener('playing', handlePlay, true);
    video.addEventListener('pause', handlePause, true);
    video.addEventListener('ended', handlePause, true);
    video.addEventListener('enterpictureinpicture', handleEnterPiP, true);
    video.addEventListener('leavepictureinpicture', handleLeavePiP, true);
  }

  /** @param {ParentNode} [root=document] */
  function scanAndAttach(root = document) {
    const videos = /** @type {ParentNode} */ (root).querySelectorAll
      ? /** @type {ParentNode} */ (root).querySelectorAll('video')
      : [];
    videos.forEach(attachVideoListeners);
  }

  // Initial scan
  scanAndAttach();

  // Observe DOM for new videos
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes &&
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const el = /** @type {Element} */ (node);
          if (el.tagName === 'VIDEO') {
            attachVideoListeners(/** @type {HTMLVideoElement} */ (el));
          } else {
            scanAndAttach(/** @type {ParentNode} */ (el));
          }
        });
    }
  });

  try {
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  } catch (_) {}
})();
