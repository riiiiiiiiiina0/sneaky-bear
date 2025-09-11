(function () {
  if (document.documentElement.hasAttribute('data-sbp-injected')) return;
  document.documentElement.setAttribute('data-sbp-injected', '1');

  const STYLE_ID = '__sneakyBearPipStyle';
  const OVERLAY_CLASS = '__sbp-overlay';
  const BUTTON_CLASS = '__sbp-btn';
  const BUTTON_PIP_CLASS = '__sbp-btn-pip';
  const BUTTON_FS_CLASS = '__sbp-btn-fs';

  let isFullscreen = false;

  // Notify background when this frame enters/leaves PiP
  function attachPiPEventListeners(video) {
    if (!video || video.__sbpPipListenersAttached) return;
    const onEnter = () => {
      try {
        chrome.runtime.sendMessage({ type: 'sbp-pip-entered' });
      } catch (_) {}
    };
    const onLeave = () => {
      try {
        chrome.runtime.sendMessage({ type: 'sbp-pip-exited' });
      } catch (_) {}
    };
    try {
      video.addEventListener('enterpictureinpicture', onEnter);
      video.addEventListener('leavepictureinpicture', onLeave);
    } catch (_) {}
    try {
      if (typeof video['webkitSetPresentationMode'] === 'function') {
        video.addEventListener('webkitpresentationmodechanged', () => {
          try {
            const mode = video['webkitPresentationMode'];
            if (mode === 'picture-in-picture') onEnter();
            else if (mode === 'inline' || mode === 'fullscreen') onLeave();
          } catch (_) {}
        });
      }
    } catch (_) {}
    video.__sbpPipListenersAttached = true;
  }

  // Helpers for custom full-page mode
  function enterFullpage(video) {
    if (video.hasAttribute('data-sbp-fullpage')) return;
    // Remember parent and next sibling for restoration
    const parent = video.parentNode;
    const next = video.nextSibling;
    const hasControls = video.hasAttribute('controls');
    video.setAttribute('data-sbp-fullpage', '1');
    video.setAttribute('controls', 'controls');
    video.classList.add('sbp-fullpage');
    // Store parent and next sibling references
    video.__sbp_fullpage_restore = { parent, next, hasControls };
    // Move video directly under body
    document.body.appendChild(video);
    isFullscreen = true;
  }

  function exitFullpage(video) {
    if (!video.hasAttribute('data-sbp-fullpage')) return;
    video.removeAttribute('data-sbp-fullpage');
    video.classList.remove('sbp-fullpage');
    // Restore to original parent and position if possible
    const { parent, next, hasControls } = video.__sbp_fullpage_restore || {};
    if (parent) {
      if (next && next.parentNode === parent) {
        parent.insertBefore(video, next);
      } else {
        parent.appendChild(video);
      }
    }
    if (hasControls) video.setAttribute('controls', 'controls');
    else video.removeAttribute('controls');
    delete video.__sbp_fullpage_restore;
    isFullscreen = false;
  }

  function toggleFullpage(video) {
    if (video.hasAttribute('data-sbp-fullpage')) exitFullpage(video);
    else enterFullpage(video);
  }

  function ensureStylesInjected() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${OVERLAY_CLASS} {
        position: absolute;
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: center;
        z-index: 2147483647; /* on top */
        pointer-events: none; /* allow mouse to hit video except buttons */
        opacity: 0;
        transition: opacity 120ms ease-in-out;
      }
      .${OVERLAY_CLASS}.__visible { opacity: 1; }
      .${BUTTON_CLASS} {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 36px;
        padding: 0 12px;
        border-radius: 18px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        font-size: 13px;
        font-weight: 600;
        border: 1px solid rgba(255,255,255,0.6);
        color: #111;
        background: rgba(255,255,255,0.92);
        box-shadow: 0 2px 10px rgba(0,0,0,0.25);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
      }
      .${BUTTON_CLASS}:hover { filter: brightness(0.95); }
      .${BUTTON_CLASS}:active { transform: translateY(1px); }

      /* Hide overlay in PiP window (some browsers expose a minimal document) */
      @media (display-mode: picture-in-picture) {
        .${OVERLAY_CLASS} { display: none !important; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function createOverlayForVideo(video) {
    console.log('🐻‍❄️ [createOverlayForVideo]', video);
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;

    const pipBtn = document.createElement('button');
    pipBtn.className = `${BUTTON_CLASS} ${BUTTON_PIP_CLASS}`;
    pipBtn.textContent = 'PiP';

    const fsBtn = document.createElement('button');
    fsBtn.className = `${BUTTON_CLASS} ${BUTTON_FS_CLASS}`;
    fsBtn.textContent = 'Fullscreen';

    overlay.appendChild(pipBtn);
    overlay.appendChild(fsBtn);

    // Manage hover visibility
    let isHovering = false;
    let hideTimer = null;

    function setVisible(visible) {
      if (visible) overlay.classList.add('__visible');
      else overlay.classList.remove('__visible');
    }

    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!isHovering) setVisible(false);
      }, 160);
    }

    function attachHover(elem) {
      elem.addEventListener('mouseenter', () => {
        if (isFullscreen) return;
        isHovering = true;
        setVisible(true);
      });
      elem.addEventListener('mouseleave', () => {
        isHovering = false;
        scheduleHide();
      });
    }

    attachHover(video);
    attachHover(overlay);

    // Position overlay to cover the video exactly and center buttons inside
    function updateOverlayPosition() {
      const rect = video.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        return;
      }
      overlay.style.pointerEvents = 'none'; // reset; buttons re-enable
      overlay.style.position = 'fixed';
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.transform = 'none';
      overlay.style.zIndex = '2147483647';
    }

    const reposition = () => updateOverlayPosition();
    const ro = new ResizeObserver(reposition);
    try {
      ro.observe(video);
    } catch (_) {}
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });

    // Wire buttons
    pipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        // Ensure this video is playing
        if (video.paused) {
          try {
            await video.play();
          } catch (err) {
            try {
              video.muted = true;
              await video.play();
            } catch (_) {}
          }
        }

        // Enter PiP for this video (switch from other PiP if needed)
        const currentPiP = document.pictureInPictureElement;
        if (typeof video.requestPictureInPicture === 'function') {
          if (currentPiP && currentPiP !== video) {
            try {
              await document.exitPictureInPicture();
            } catch (_) {}
          }
          if (document.pictureInPictureElement !== video) {
            await video.requestPictureInPicture();
          }
        } else if (typeof video.webkitSetPresentationMode === 'function') {
          if (video.webkitPresentationMode !== 'picture-in-picture') {
            try {
              video.webkitSetPresentationMode('picture-in-picture');
            } catch (_) {}
          }
        }
      } catch (err) {
        console.warn('PiP failed:', err);
      }
    });

    fsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        toggleFullpage(video);
        // Reposition overlay after style change
        requestAnimationFrame(() => {
          const rect = video.getBoundingClientRect();
          if (rect && rect.width && rect.height && video.__sbpOverlay) {
            const evt = new Event('resize');
            window.dispatchEvent(evt);
          }
        });
      } catch (err) {
        console.warn('Fullscreen failed:', err);
      }
    });

    // Insert overlay into DOM and position
    document.documentElement.appendChild(overlay);
    // Ensure buttons re-enable pointer events over them
    overlay.querySelectorAll('button').forEach((btn) => {
      btn.style.pointerEvents = 'auto';
    });

    // Initial position
    requestAnimationFrame(reposition);

    // Track association for cleanup on the video only
    video.__sbpOverlay = overlay;

    return overlay;
  }

  function removeOverlayForVideo(video) {
    const overlay = video && video.__sbpOverlay;
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    if (video) delete video.__sbpOverlay;
  }

  function upsertOverlay(video) {
    if (!video) return;
    // Always ensure PiP listeners are attached (even if overlay already exists)
    attachPiPEventListeners(video);
    if (!video.__sbpOverlay) createOverlayForVideo(video);
  }

  function handleNewNode(node) {
    if (!(node instanceof Element)) return;
    if (node.tagName === 'VIDEO') {
      upsertOverlay(node);
    }
    const videos = node.querySelectorAll('video');
    videos.forEach(upsertOverlay);
  }

  function handleRemovedNode(node) {
    if (!(node instanceof Element)) return;
    if (node.tagName === 'VIDEO') removeOverlayForVideo(node);
    const videos = node.querySelectorAll('video');
    videos.forEach(removeOverlayForVideo);
  }

  function scanExistingVideos() {
    const videos = document.querySelectorAll('video');
    console.log('🐻‍❄️ [scanExistingVideos]', videos);
    videos.forEach(upsertOverlay);
  }

  function startObserving() {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(handleNewNode);
          m.removedNodes.forEach(handleRemovedNode);
        }
        if (
          m.type === 'attributes' &&
          m.target instanceof Element &&
          m.target.tagName === 'VIDEO'
        ) {
          upsertOverlay(m.target);
        }
      }
    });
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style', 'class', 'hidden'],
    });
  }

  function init() {
    ensureStylesInjected();
    scanExistingVideos();
    startObserving();
    // ESC exits custom full-page mode
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document
          .querySelectorAll('video[data-sbp-fullpage]')
          .forEach((v) => exitFullpage(v));
      }
    });

    // Respond to a background request to exit PiP and pause
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.type !== 'sbp-exit-pip-pause') return false;
        (async () => {
          let handled = false;
          try {
            const pipEl = document.pictureInPictureElement;
            if (pipEl) {
              try {
                await document.exitPictureInPicture();
              } catch (_) {}
              try {
                if (typeof pipEl['pause'] === 'function') pipEl['pause']();
              } catch (_) {}
              handled = true;
            }
          } catch (_) {}
          if (!handled) {
            try {
              const videos = Array.from(document.querySelectorAll('video'));
              for (const v of videos) {
                if (
                  typeof v['webkitSetPresentationMode'] === 'function' &&
                  v['webkitPresentationMode'] === 'picture-in-picture'
                ) {
                  try {
                    v['webkitSetPresentationMode']('inline');
                  } catch (_) {}
                  try {
                    if (typeof v['pause'] === 'function') v['pause']();
                  } catch (_) {}
                  handled = true;
                }
              }
            } catch (_) {}
          }
          try {
            sendResponse({ ok: handled });
          } catch (_) {}
        })();
        return true; // async response
      });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
