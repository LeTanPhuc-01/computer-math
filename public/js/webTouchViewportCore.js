// public/js/webTouchViewportCore.js
import { createAppClient } from './webTouchClient.js';

const SESSION_STORAGE_KEY = 'remoteControlRoomCode';

// This is the reusable entrypoint students call from their own script
export function initWebTouchViewport({
  qrCodeContainer,
  cursorElement,
  onTapElement,          // (target, { cursorX, cursorY, rawTap })
  onKeyInput,            // (activeElement, { key, raw })
  onRoomCode,            // (roomCode)
  onCursorMove,          // optional: ({ cursorX, cursorY, deltaX, deltaY })
} = {}) {
  const client = createAppClient();
  const socket = client.socket;

  // ---- Local state ----
  let assignedRoomCode = null;
  let windowWidth = window.innerWidth;
  let windowHeight = window.innerHeight;
  let cursorX = windowWidth / 2;
  let cursorY = windowHeight / 2;
  let cursorVisible = false;

  let lastHoveredElement = null;
  let lastHoveredAssociatedLabels = [];
  let manuallyFocusedElement = null;

  // ---- Helpers (mostly moved directly from your app.js) ----

  function getUniqueSelector(el) {
    if (!el || !(el instanceof Element)) return null;
    if (el.id) return `#${el.id}`;
    let selector = el.tagName.toLowerCase();
    if (el.parentElement) {
      const siblings = Array.from(el.parentElement.children);
      const index = siblings.indexOf(el);
      if (index > -1) selector += `:nth-child(${index + 1})`;
    }
    return selector;
  }

  function updateCursorPosition() {
    if (cursorElement) {
      cursorElement.style.left = `${cursorX}px`;
      cursorElement.style.top = `${cursorY}px`;
    }
    client.reportCursorPosition({ x: cursorX, y: cursorY });
    if (onCursorMove) {
      onCursorMove({ cursorX, cursorY });
    }
  }

  function updateCursorVisibility() {
    if (cursorElement) {
      cursorElement.classList.toggle('visible', cursorVisible);
    }
  }

  function removeManualFocusVisuals() {
    if (manuallyFocusedElement) {
      manuallyFocusedElement.classList.remove('manual-focus');
    }
    manuallyFocusedElement = null;
  }

  function applyManualFocusVisuals(element) {
    removeManualFocusVisuals();
    if (
      element &&
      ((element.tagName === 'INPUT' && element.type === 'text') ||
        element.tagName === 'TEXTAREA')
    ) {
      element.classList.add('manual-focus');
      manuallyFocusedElement = element;
    }
  }

  function removeManualHover() {
    if (lastHoveredElement) {
      lastHoveredElement.classList.remove('manual-hover');
    }
    lastHoveredAssociatedLabels.forEach(label =>
      label.classList.remove('manual-hover-associated')
    );
    lastHoveredElement = null;
    lastHoveredAssociatedLabels = [];
  }

  function isInteractiveForHover(element) {
    if (!element) return false;
    const tagName = element.tagName;
    const type = element.type ? element.type.toLowerCase() : null;

    if (tagName === 'LABEL' && element.htmlFor) {
      const input = document.getElementById(element.htmlFor);
      if (input && (input.type === 'text' || input.tagName === 'TEXTAREA')) {
        return false;
      }
      return true;
    }

    if (
      tagName === 'BUTTON' ||
      tagName === 'A' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      (tagName === 'INPUT' &&
        ['text', 'button', 'submit', 'reset', 'radio', 'checkbox', 'image']
          .includes(type)) ||
      element.classList.contains('clickable-box')
    ) {
      return true;
    }
    return false;
  }

  function handleManualHover() {
    if (!cursorVisible) return;

    let elementUnderCursor = document.elementFromPoint(cursorX, cursorY);
    let targetInteractiveElement = null;
    let associatedLabelsToHover = [];

    if (elementUnderCursor) {
      if (isInteractiveForHover(elementUnderCursor)) {
        targetInteractiveElement = elementUnderCursor;
        if (
          elementUnderCursor.id &&
          (elementUnderCursor.type === 'radio' ||
            elementUnderCursor.type === 'checkbox')
        ) {
          associatedLabelsToHover = Array.from(
            document.querySelectorAll(`label[for="${elementUnderCursor.id}"]`)
          );
        }
      } else if (
        elementUnderCursor.tagName === 'LABEL' &&
        elementUnderCursor.htmlFor
      ) {
        const input = document.getElementById(elementUnderCursor.htmlFor);
        if (input && isInteractiveForHover(input)) {
          targetInteractiveElement =
            input.type === 'text' || input.tagName === 'TEXTAREA'
              ? input
              : elementUnderCursor;
        }
      }
    }

    if (targetInteractiveElement !== lastHoveredElement) {
      removeManualHover();
      if (targetInteractiveElement) {
        targetInteractiveElement.classList.add('manual-hover');
        lastHoveredElement = targetInteractiveElement;
        associatedLabelsToHover.forEach(label =>
          label.classList.add('manual-hover-associated')
        );
        lastHoveredAssociatedLabels = associatedLabelsToHover;
      }
    }
  }

  function generateControllerQRCode(displayRoomCode) {
    if (!qrCodeContainer) return;

    if (!displayRoomCode) {
      qrCodeContainer.innerHTML = '<p style="color:red;">Waiting...</p>';
      return;
    }

    const controllerOrigin = window.location.origin;
    const controllerUrl = `${controllerOrigin}/controller?room=${displayRoomCode}`;
    qrCodeContainer.innerHTML = `<p>${displayRoomCode}</p>`;
    const canvas = document.createElement('canvas');

    QRCode.toCanvas(
      canvas,
      controllerUrl,
      { width: 128, margin: 1, errorCorrectionLevel: 'L' },
      (err) => {
        if (err) {
          console.error('QR Code Generation Error:', err);
          qrCodeContainer.innerHTML +=
            '<p style="color: red;">Error.</p>';
        } else {
          qrCodeContainer.appendChild(canvas);
        }
      }
    );
  }

  // ---- Socket wiring ----

  socket.on('connect', () => {
    removeManualFocusVisuals();
    removeManualHover();

    const previousRoomCode = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (previousRoomCode) {
      client.rejoinRoom(previousRoomCode);
    } else {
      client.registerNewRoom();
    }
  });

  socket.on('your_room_id', (assignedCode) => {
    assignedRoomCode = String(assignedCode || '').toUpperCase();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, assignedRoomCode);

    if (qrCodeContainer) {
      generateControllerQRCode(assignedRoomCode);
    }
    if (onRoomCode) onRoomCode(assignedRoomCode);
  });

  socket.on('rejoin_failed', () => {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    assignedRoomCode = null;
    client.registerNewRoom();
  });

  socket.on('disconnect', () => {
    cursorVisible = false;
    updateCursorVisibility();
    removeManualFocusVisuals();
    removeManualHover();
    if (qrCodeContainer) {
      qrCodeContainer.innerHTML = '<p style="color:red;">Disconnected</p>';
    }
  });

  socket.on('initial_state', (state) => {
    if (!state) return;
    cursorX = state.cursor?.x ?? windowWidth / 2;
    cursorY = state.cursor?.y ?? windowHeight / 2;
    updateCursorPosition();

    removeManualFocusVisuals();

    if (state.focusedElementSelector) {
      try {
        const focusedEl = document.querySelector(state.focusedElementSelector);
        if (focusedEl) {
          focusedEl.focus({ preventScroll: true });
          applyManualFocusVisuals(focusedEl);
          if (
            state.focusedElementValue !== undefined &&
            (focusedEl.tagName === 'INPUT' || focusedEl.tagName === 'TEXTAREA')
          ) {
            focusedEl.value = state.focusedElementValue;
          }
        }
      } catch (e) {
        console.warn('Error applying initial focus selector:', e);
      }
    }
  });

  socket.on('set_cursor_visibility', (isVisible) => {
    cursorVisible = !!isVisible;
    updateCursorVisibility();
    if (!cursorVisible) {
      removeManualHover();
    } else {
      handleManualHover();
    }
  });

  socket.on('cursor_move', (data) => {
    if (!cursorVisible) return;
    const deltaX = data.deltaX || 0;
    const deltaY = data.deltaY || 0;

    cursorX = Math.max(0, Math.min(windowWidth, cursorX + deltaX));
    cursorY = Math.max(0, Math.min(windowHeight, cursorY + deltaY));

    updateCursorPosition();
    handleManualHover();

    if (onCursorMove) {
      onCursorMove({ cursorX, cursorY, deltaX, deltaY });
    }
  });

  socket.on('tap', (rawTap) => {
    let elementUnderCursor = document.elementFromPoint(cursorX, cursorY);
    let finalTargetElement = elementUnderCursor;

    removeManualFocusVisuals();

    if (
      elementUnderCursor &&
      elementUnderCursor.tagName === 'LABEL' &&
      elementUnderCursor.htmlFor
    ) {
      const correspondingInput = document.getElementById(elementUnderCursor.htmlFor);
      if (correspondingInput) {
        finalTargetElement = correspondingInput;
      }
    }

    if (onTapElement) {
      onTapElement(finalTargetElement, {
        cursorX,
        cursorY,
        rawTap,
        getUniqueSelector,
        reportFocusChange: (info) => client.reportFocusChange(info),
        applyManualFocusVisuals,
        removeManualFocusVisuals,
      });
    }

    handleManualHover();
  });

  socket.on('key_input', (raw) => {
    const activeElement = document.activeElement;
    if (onKeyInput) {
      onKeyInput(activeElement, {
        key: raw.key,
        raw,
        getUniqueSelector,
        reportFocusChange: (info) => client.reportFocusChange(info),
      });
    }
  });

  // Resize → keep cursor in bounds
  window.addEventListener('resize', () => {
    windowWidth = window.innerWidth;
    windowHeight = window.innerHeight;
    cursorX = Math.max(0, Math.min(windowWidth, cursorX));
    cursorY = Math.max(0, Math.min(windowHeight, cursorY));
    updateCursorPosition();
    handleManualHover();
  });

  // Focus tracking
  document.body.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target && target !== document.body && target !== manuallyFocusedElement) {
      const selector = getUniqueSelector(target);
      const focusInfo = { selector };
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        focusInfo.value = target.value;
      }
      client.reportFocusChange(focusInfo);
      applyManualFocusVisuals(target);
    }
  });

  document.body.addEventListener('focusout', (event) => {
    const relatedTarget = event.relatedTarget;
    if (!relatedTarget || relatedTarget === document.body) {
      client.reportFocusChange({ selector: null });
      removeManualFocusVisuals();
    }
  });

  // Initial cursor
  updateCursorPosition();
  updateCursorVisibility();

  return {
    client,
    socket,
    getRoomCode: () => assignedRoomCode,
  };
}
