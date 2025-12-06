// public/js/controller.js
import { createControllerClient } from './webTouchClient.js';

// High-level controller client (wraps socket.io + room logic)
const client = createControllerClient();

// --- DOM references ---
const touchSurface = document.getElementById('touchSurface');
const virtualKeyboard = document.getElementById('virtualKeyboard');
const introAnimation = document.getElementById('introAnimation');
const statusMessage = document.getElementById('statusMessage');
const manualJoinForm = document.getElementById('manualJoinForm');
const manualRoomInput = document.getElementById('manualRoomIdInput');
const joinManualButton = document.getElementById('joinManualRoomButton');
const controllerUiWrapper = document.getElementById('controllerUiWrapper');

// Keyboard layers
const layers = {
  letters: document.getElementById('layer-letters'),
  numbers: document.getElementById('layer-numbers'),
  symbols2: document.getElementById('layer-symbols2'),
};
const shiftLettersKey = document.getElementById('shiftLetters');
const letterKeys = layers.letters.querySelectorAll('.keyboard-key[data-key]');

// --- State ---
// This is purely for UI / status text; the client wrapper tracks the room internally.
let targetRoomCode = null; // UPPERCASE code currently joined

// Pointer/tap state
const activePointers = new Map();
const TAP_DURATION_THRESHOLD = 250;
const TAP_MOVE_THRESHOLD = 10;
let animationStopped = false;

// Two-finger tap state
let touchStartTime_2f = 0;
let touchStartCount_2f = 0;
let twoFingerTapDetected = false;

// --- Helpers ---

function getRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  return room ? room.toUpperCase() : null;
}

function updateKeyboardDisplay(controllerState) {
  if (!controllerState) return;
  const { keyboardMode, isShiftActive } = controllerState;

  // Activate the correct layer
  Object.entries(layers).forEach(([mode, el]) => {
    if (!el) return;
    el.classList.toggle('active', mode === keyboardMode);
  });

  // Letters layer: update key labels and shift style
  if (keyboardMode === 'letters') {
    letterKeys.forEach((keyEl) => {
      const baseKey = keyEl.dataset.key;
      const shiftKey = keyEl.dataset.shift;
      if (!baseKey) return;

      if (baseKey === ' ') {
        keyEl.textContent = 'Space';
      } else if (baseKey.length === 1) {
        keyEl.textContent = isShiftActive && shiftKey ? shiftKey : baseKey;
      }
    });

    if (shiftLettersKey) {
      shiftLettersKey.classList.toggle('active', isShiftActive);
    }
  } else if (shiftLettersKey) {
    shiftLettersKey.classList.remove('active');
  }
}

function stopIntroAnimation() {
  if (animationStopped) return;
  console.log('First interaction, stopping intro animation.');
  introAnimation.classList.add('hidden');
  setTimeout(() => {
    if (introAnimation.parentNode) {
      introAnimation.style.display = 'none';
    }
  }, 500);
  animationStopped = true;
}

function showControllerUI() {
  manualJoinForm.style.display = 'none';
  controllerUiWrapper.style.display = 'flex';
  touchSurface.style.display = 'block';
  virtualKeyboard.style.display = 'block';
  statusMessage.style.display = 'block';
}

function showManualJoinUI(
  errorMessage = 'Please enter the 4-letter Room Code to join.'
) {
  manualJoinForm.style.display = 'block';
  controllerUiWrapper.style.display = 'none';
  statusMessage.textContent = errorMessage;
  statusMessage.style.backgroundColor = 'lightcoral';
  statusMessage.style.display = 'block';
}

function disableControllerInput() {
  touchSurface.style.pointerEvents = 'none';
  virtualKeyboard.style.pointerEvents = 'none';
  touchSurface.style.opacity = '0.5';
  virtualKeyboard.style.opacity = '0.5';
}

function enableControllerInput() {
  touchSurface.style.pointerEvents = 'auto';
  virtualKeyboard.style.pointerEvents = 'auto';
  touchSurface.style.opacity = '1';
  virtualKeyboard.style.opacity = '1';
}

// Attempt to join a room (given a 4-letter code)
// Uses the controller client wrapper instead of socket.emit directly.
function attemptToJoinRoom(roomCode) {
  const upperRoomCode = roomCode ? roomCode.toUpperCase() : null;
  if (!upperRoomCode) {
    showManualJoinUI('Cannot join room (no code provided).');
    return;
  }

  targetRoomCode = upperRoomCode;
  console.log(`Attempting to register for room: ${targetRoomCode}`);
  statusMessage.textContent = `Joining Room: ${targetRoomCode}...`;
  statusMessage.style.backgroundColor = '#ddd';

  // This calls into the wrapper, which will emit 'register_controller_room'
  // and track the room internally.
  client.joinRoom(upperRoomCode);

  animationStopped = false;
  introAnimation.classList.remove('hidden');
  introAnimation.style.display = 'flex';

  showControllerUI();
  enableControllerInput();
}

// --- Pointer events ---

touchSurface.addEventListener('pointerdown', (event) => {
  if (!targetRoomCode) return;
  stopIntroAnimation();

  // Right-click => send "right click" tap
  if (event.button === 2) {
    event.preventDefault();
    client.sendTap('pointer_button_right');
    return;
  }

  if (event.isPrimary) {
    event.preventDefault();
    try {
      touchSurface.setPointerCapture(event.pointerId);
    } catch (e) {
      // ignore
    }

    activePointers.set(event.pointerId, {
      startTime: Date.now(),
      startX: event.clientX,
      startY: event.clientY,
      prevX: event.clientX,
      prevY: event.clientY,
    });
  }
});

touchSurface.addEventListener('pointermove', (event) => {
  if (!targetRoomCode || !activePointers.has(event.pointerId)) return;
  stopIntroAnimation();
  event.preventDefault();

  const pointerState = activePointers.get(event.pointerId);
  const deltaX = event.clientX - pointerState.prevX;
  const deltaY = event.clientY - pointerState.prevY;

  if (deltaX !== 0 || deltaY !== 0) {
    // Use wrapper instead of socket.emit('cursor_move', ...)
    client.sendCursorMove(deltaX, deltaY);
  }

  pointerState.prevX = event.clientX;
  pointerState.prevY = event.clientY;
});

function handlePointerEnd(event) {
  if (!targetRoomCode) return;
  stopIntroAnimation();

  if (activePointers.has(event.pointerId)) {
    const pointerState = activePointers.get(event.pointerId);
    const duration = Date.now() - pointerState.startTime;
    const distance = Math.sqrt(
      (event.clientX - pointerState.startX) ** 2 +
      (event.clientY - pointerState.startY) ** 2
    );

    if (duration < TAP_DURATION_THRESHOLD && distance < TAP_MOVE_THRESHOLD) {
      console.log('>>> Tap detected (single-pointer)');
      client.sendTap('single_tap');
    }

    try {
      if (touchSurface.hasPointerCapture && touchSurface.hasPointerCapture(event.pointerId)) {
        touchSurface.releasePointerCapture(event.pointerId);
      }
    } catch (e) {
      // ignore
    }

    activePointers.delete(event.pointerId);
  }
}

touchSurface.addEventListener('pointerup', handlePointerEnd);
touchSurface.addEventListener('pointercancel', handlePointerEnd);
touchSurface.addEventListener('pointerleave', (event) => {
  if (!targetRoomCode) return;
  if (activePointers.has(event.pointerId)) {
    try {
      if (touchSurface.hasPointerCapture && touchSurface.hasPointerCapture(event.pointerId)) {
        touchSurface.releasePointerCapture(event.pointerId);
      }
    } catch (e) {
      // ignore
    }
    activePointers.delete(event.pointerId);
  }
});

// --- Touch events for two-finger tap ---

touchSurface.addEventListener(
  'touchstart',
  (event) => {
    if (!targetRoomCode) return;
    stopIntroAnimation();

    touchStartCount_2f = event.touches.length;
    twoFingerTapDetected = false;

    if (touchStartCount_2f === 2) {
      event.preventDefault();
      touchStartTime_2f = Date.now();
    }
  },
  { passive: false }
);

touchSurface.addEventListener(
  'touchend',
  (event) => {
    if (!targetRoomCode) return;
    stopIntroAnimation();

    if (
      touchStartCount_2f === 2 &&
      !twoFingerTapDetected &&
      event.touches.length < 2
    ) {
      const tapDuration_2f = Date.now() - touchStartTime_2f;
      if (tapDuration_2f < 350) {
        console.log('>>> Tap detected (two-finger)');
        client.sendTap('two_finger');
        twoFingerTapDetected = true;
        event.preventDefault();
      }
    }

    if (event.touches.length === 0) {
      touchStartCount_2f = 0;
      touchStartTime_2f = 0;
      twoFingerTapDetected = false;
    }
  },
  { passive: false }
);

touchSurface.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

// --- Virtual keyboard ---

virtualKeyboard.addEventListener('click', (event) => {
  if (!targetRoomCode) return;
  stopIntroAnimation();

  const target = event.target.closest('.keyboard-key');
  if (!target) return;

  let keyToSend = null;
  let extra = {};

  if (target.classList.contains('key-mode-switch')) {
    const targetMode = target.dataset.targetMode;
    if (targetMode) {
      keyToSend = 'ToggleMode';
      extra.targetMode = targetMode;
    }
  } else if (target.id === 'shiftLetters') {
    keyToSend = 'ToggleShift';
  } else if (target.dataset.key) {
    keyToSend = target.dataset.key;
  }

  if (keyToSend) {
    client.sendKey(keyToSend, extra);

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }
});

// --- Manual join input handling ---

manualRoomInput.addEventListener('input', (event) => {
  const start = event.target.selectionStart;
  const end = event.target.selectionEnd;
  event.target.value = event.target.value.toUpperCase();
  event.target.setSelectionRange(start, end);
});

joinManualButton.addEventListener('click', () => {
  const manualCode = manualRoomInput.value.trim().toUpperCase();
  if (manualCode.length === 4) {
    attemptToJoinRoom(manualCode);
  } else {
    alert('Please enter a valid 4-letter Room Code.');
  }
});

manualRoomInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    joinManualButton.click();
  }
});

// --- Controller client event handlers ---
//
// All socket-level details are encapsulated in createControllerClient.
// We just react to the high-level events it exposes.

client.onConnected(() => {
  console.log('Connected to server.');
  statusMessage.textContent = 'Connected. Waiting for Room Code...';
  statusMessage.style.backgroundColor = '#ddd';
  enableControllerInput();

  const roomCodeFromUrl = getRoomCodeFromUrl();
  if (roomCodeFromUrl) {
    attemptToJoinRoom(roomCodeFromUrl);
  } else {
    showManualJoinUI();
    disableControllerInput();
    manualRoomInput.focus();
  }
});

client.onDisconnected((reason) => {
  console.log('Disconnected...', reason);
  activePointers.clear();
  targetRoomCode = null;
  showManualJoinUI(
    `Disconnected${reason ? `: ${reason}` : ''}. Please enter Room Code to reconnect.`
  );
  disableControllerInput();
});

client.onControllerStateChange((controllerState) => {
  if (!controllerState) return;

  updateKeyboardDisplay(controllerState);

  // First successful update after joining -> set "Connected" status
  if (targetRoomCode && statusMessage.textContent.startsWith('Joining')) {
    statusMessage.textContent = `Connected to Room: ${targetRoomCode}`;
    statusMessage.style.backgroundColor = 'lightgreen';
    enableControllerInput();
  }
});

client.onInvalidRoom((failedRoomCode) => {
  const displayCode =
    failedRoomCode || manualRoomInput.value.trim().toUpperCase();
  console.error(`Server rejected room code: ${displayCode}`);
  targetRoomCode = null;
  showManualJoinUI(
    `Error: Invalid or Expired Room Code "${displayCode}"!`
  );
  disableControllerInput();
  manualRoomInput.focus();
});

client.onAppDisconnected(() => {
  const closedRoomCode = targetRoomCode;
  console.warn(`App for room ${closedRoomCode} disconnected.`);
  targetRoomCode = null;
  showManualJoinUI(
    `App Disconnected - Room "${closedRoomCode}" Closed. Enter a new Room Code.`
  );
  disableControllerInput();
  manualRoomInput.focus();
});

// Optional: react if the app comes back for the same room
client.onAppReconnected(() => {
  if (!targetRoomCode) return;
  console.log(`App for room ${targetRoomCode} reconnected.`);
  statusMessage.textContent = `Reconnected to Room: ${targetRoomCode}`;
  statusMessage.style.backgroundColor = 'lightgreen';
  enableControllerInput();
});
