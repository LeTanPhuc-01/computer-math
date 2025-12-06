// public/js/webTouchClient.js
// Must be loaded AFTER the Socket.IO client script:
//   <script src="/socket.io/socket.io.js"></script>
//
// This file exposes two small "SDK" helpers:
//   - createAppClient()       → used by the viewport app
//   - createControllerClient() → used by the controller UI

// -----------------------------------------------------------------------------
// App-side client (viewport)
// -----------------------------------------------------------------------------

export function createAppClient({ serverUrl = undefined } = {}) {
  // Open a Socket.IO connection to the same origin by default,
  // or to an explicit URL if provided.
  const socket = serverUrl ? io(serverUrl) : io();

  // Single handler slots; higher-level code assigns with .onX(fn).
  const handlers = {
    onConnected: () => {},
    onDisconnected: () => {},       // (reason) => void
    onRejoinFailed: () => {},       // (roomId) => void
    onInitialState: () => {},       // (state) => void
    onCursorMove: () => {},         // (data) => void
    onTap: () => {},                // (data) => void
    onKeyInput: () => {},           // (data) => void
    onCursorVisibilityChange: () => {}, // (visible) => void
  };

  let currentRoomId = null;

  // --- Incoming events from server ---

  socket.on('connect', () => handlers.onConnected());

  // Pass along the disconnect "reason" from Socket.IO
  socket.on('disconnect', (reason) => handlers.onDisconnected(reason));

  socket.on('your_room_id', (roomId) => {
    currentRoomId = roomId;
  });

  socket.on('initial_state', (state) => {
    handlers.onInitialState(state || {});
  });

  socket.on('cursor_move', (data) => {
    handlers.onCursorMove(data);
  });

  socket.on('tap', (data) => {
    handlers.onTap(data);
  });

  socket.on('key_input', (data) => {
    handlers.onKeyInput(data);
  });

  socket.on('set_cursor_visibility', (visible) => {
    handlers.onCursorVisibilityChange(visible);
  });

  socket.on('rejoin_failed', () => {
    handlers.onRejoinFailed(currentRoomId);
  });

  // --- Public API for app side ---

  return {
    // Expose the raw socket just in case advanced code wants it.
    socket,

    // Read the last-known room ID assigned by the server.
    getRoomId() {
      return currentRoomId;
    },

    // Ask the server to create a brand-new room for this app.
    registerNewRoom() {
      socket.emit('register_app_room');
    },

    // Try to rejoin a previously assigned room.
    rejoinRoom(roomId) {
      socket.emit('rejoin_app_room', roomId);
    },

    // Report cursor position to server (roomId added automatically).
    reportCursorPosition(pos) {
      if (!currentRoomId) return;
      socket.emit('report_cursor_position', {
        roomId: currentRoomId,
        pos,
      });
    },

    // Report focus changes to server (selector + value, etc.).
    reportFocusChange(focusInfo) {
      if (!currentRoomId) return;
      socket.emit('report_focus_change', {
        roomId: currentRoomId,
        focusInfo,
      });
    },

    // Handler registration (one listener per event type).
    onConnected(fn) { handlers.onConnected = fn || (() => {}); },
    onDisconnected(fn) { handlers.onDisconnected = fn || (() => {}); },
    onRejoinFailed(fn) { handlers.onRejoinFailed = fn || (() => {}); },
    onInitialState(fn) { handlers.onInitialState = fn || (() => {}); },
    onCursorMove(fn) { handlers.onCursorMove = fn || (() => {}); },
    onTap(fn) { handlers.onTap = fn || (() => {}); },
    onKeyInput(fn) { handlers.onKeyInput = fn || (() => {}); },
    onCursorVisibilityChange(fn) {
      handlers.onCursorVisibilityChange = fn || (() => {});
    },
  };
}

// -----------------------------------------------------------------------------
// Controller-side client
// -----------------------------------------------------------------------------

export function createControllerClient({ serverUrl = undefined } = {}) {
  // Open a Socket.IO connection
  const socket = serverUrl ? io(serverUrl) : io();

  // Single handler slots; controller.js wires these up.
  const handlers = {
    onConnected: () => {},             // () => void
    onDisconnected: () => {},          // (reason) => void
    onInvalidRoom: () => {},           // (roomId) => void
    onAppDisconnected: () => {},       // () => void
    onAppReconnected: () => {},        // () => void
    onControllerStateChange: () => {}, // (controllerState) => void
  };

  let currentRoomId = null;

  // --- Incoming events from server ---

  socket.on('connect', () => handlers.onConnected());

  // Forward disconnect "reason" to the handler.
  socket.on('disconnect', (reason) => handlers.onDisconnected(reason));

  socket.on('invalid_room', (roomId) => {
    handlers.onInvalidRoom(roomId);
  });

  socket.on('app_disconnected', () => {
    handlers.onAppDisconnected();
  });

  socket.on('app_reconnected', () => {
    handlers.onAppReconnected();
  });

  socket.on('update_controller_state', (data) => {
    // Server sends { controllerState: { keyboardMode, isShiftActive, ... } }
    handlers.onControllerStateChange(data.controllerState || {});
  });

  // --- Public API for controller side ---

  return {
    socket,

    // Join a room; wrapper keeps track of the uppercased room ID.
    joinRoom(roomId) {
      currentRoomId = String(roomId || '').toUpperCase();
      socket.emit('register_controller_room', currentRoomId);
    },

    // Send pointer deltas to the app in this room.
    sendCursorMove(deltaX, deltaY) {
      if (!currentRoomId) return;
      socket.emit('cursor_move', {
        roomId: currentRoomId,
        deltaX,
        deltaY,
      });
    },

    // Send tap events; "source" can be 'single_tap', 'two_finger',
    // 'pointer_button_right', or any other string your app understands.
    sendTap(source = 'controller') {
      if (!currentRoomId) return;
      socket.emit('tap', {
        roomId: currentRoomId,
        source,
      });
    },

    // Send key events; "extra" can hold targetMode, etc.
    sendKey(key, extra = {}) {
      if (!currentRoomId) return;
      socket.emit('key_input', {
        roomId: currentRoomId,
        key,
        ...extra,
      });
    },

    // Handler registration
    onConnected(fn) { handlers.onConnected = fn || (() => {}); },
    onDisconnected(fn) { handlers.onDisconnected = fn || (() => {}); },
    onInvalidRoom(fn) { handlers.onInvalidRoom = fn || (() => {}); },
    onAppDisconnected(fn) { handlers.onAppDisconnected = fn || (() => {}); },
    onAppReconnected(fn) { handlers.onAppReconnected = fn || (() => {}); },
    onControllerStateChange(fn) {
      handlers.onControllerStateChange = fn || (() => {});
    },
  };
}
