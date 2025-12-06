// lib/webTouchController.js
'use strict';

/**
 * WebTouch Controller Server Module
 *
 * Attach this to an existing Socket.IO instance to support:
 * - 4-letter room codes
 * - One "app" (kiosk) per room
 * - Multiple controllers per room
 * - Remote cursor + tap events
 * - Soft keyboard events with mode & shift state
 */

const DEFAULT_OPTIONS = {
  codeLength: 4,
  alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  defaultSensitivity: 2.0,
  debug: false,
};

function attachWebTouchController(io, userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const { codeLength, alphabet, defaultSensitivity, debug } = options;

  // Simple debug logger
  const log = (...args) => {
    if (debug) console.log('[WebTouch]', ...args);
  };
  const warn = (...args) => console.warn('[WebTouch]', ...args);

  // --- Room Code Generation ---
  function generateRoomCode() {
    let code = '';
    for (let i = 0; i < codeLength; i++) {
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return code;
  }

  // --- Per-Room State Store ---
  // Map<RoomCode (UPPERCASE), RoomState>
  const roomStates = new Map();

  function createInitialRoomState(appSocketId) {
    return {
      appSocketId,
      controllerSocketIds: new Set(),
      lastKnownCursor: {
        x: 400,
        y: 300,
        isVisible: false,
      },
      lastKnownFocusSelector: null,
      lastKnownFocusValue: '',
      controllerState: {
        keyboardMode: 'letters', // 'letters' | 'numbers' | 'symbols2'
        isShiftActive: false,
      },
      sensitivity: defaultSensitivity,
    };
  }

  function getInitialStateForApp(roomState) {
    if (!roomState) return {};
    return {
      cursor: roomState.lastKnownCursor,
      focusedElementSelector: roomState.lastKnownFocusSelector,
      focusedElementValue: roomState.lastKnownFocusValue,
      hoveredElementSelector: null,
    };
  }

  function broadcastControllerStateToRoom(roomCode) {
    const roomState = roomStates.get(roomCode);
    if (!roomState) return;

    const payload = {
      controllerState: roomState.controllerState,
    };

    roomState.controllerSocketIds.forEach((sid) => {
      io.to(sid).emit('update_controller_state', payload);
    });
  }

  // --- Socket.IO Wiring ---
  io.on('connection', (socket) => {
    log('Client connected:', socket.id);
    let currentRoomCode = null; // track room for disconnect cleanup

    // --- Disconnect handling ---
    socket.on('disconnect', () => {
      log('Client disconnected:', socket.id, 'from room:', currentRoomCode);

      if (!currentRoomCode) return;

      const roomState = roomStates.get(currentRoomCode);
      if (!roomState) {
        warn('Disconnect: room not found for code', currentRoomCode);
        return;
      }

      // If the app (kiosk) disconnects, shut down the room and notify controllers
      if (socket.id === roomState.appSocketId) {
        log(
          'App owner disconnected for room',
          currentRoomCode,
          'socket:',
          socket.id
        );

        roomState.controllerSocketIds.forEach((controllerSid) => {
          const controllerSocket = io.sockets.sockets.get(controllerSid);
          if (controllerSocket) {
            controllerSocket.emit('app_disconnected');
            controllerSocket.leave(currentRoomCode);
          }
        });

        roomStates.delete(currentRoomCode);
        log('Room removed:', currentRoomCode);
        return;
      }

      // Otherwise, it might be a controller disconnecting
      if (roomState.controllerSocketIds.has(socket.id)) {
        roomState.controllerSocketIds.delete(socket.id);
        log(
          'Controller',
          socket.id,
          'left room',
          currentRoomCode,
          'remaining:',
          roomState.controllerSocketIds.size
        );

        // If that was the last controller, hide cursor on the app
        if (
          roomState.controllerSocketIds.size === 0 &&
          roomState.lastKnownCursor.isVisible
        ) {
          roomState.lastKnownCursor.isVisible = false;
          if (roomState.appSocketId) {
            io.to(roomState.appSocketId).emit('set_cursor_visibility', false);
          }
        }
      }
    });

    // --- App registration: new room ---
    socket.on('register_app_room', () => {
      let roomCode = generateRoomCode();
      while (roomStates.has(roomCode)) {
        roomCode = generateRoomCode();
      }

      currentRoomCode = roomCode;
      log('App registering new room:', roomCode, 'socket:', socket.id);

      const newRoomState = createInitialRoomState(socket.id);
      roomStates.set(roomCode, newRoomState);

      socket.join(roomCode);
      socket.emit('your_room_id', roomCode);
      socket.emit('initial_state', getInitialStateForApp(newRoomState));
      socket.emit('set_cursor_visibility', false);
    });

    // --- App rejoin existing room ---
    socket.on('rejoin_app_room', (roomCode) => {
      const upperRoomCode = String(roomCode || '').toUpperCase();
      log('App attempting to rejoin room:', upperRoomCode, 'socket:', socket.id);

      const roomState = roomStates.get(upperRoomCode);
      if (!roomState) {
        warn('rejoin_app_room failed, room not found:', upperRoomCode);
        socket.emit('rejoin_failed', upperRoomCode);
        return;
      }

      currentRoomCode = upperRoomCode;
      const oldAppSocketId = roomState.appSocketId;
      roomState.appSocketId = socket.id;

      socket.join(upperRoomCode);
      log(
        'App rejoined room',
        upperRoomCode,
        'new socket:',
        socket.id,
        'old socket:',
        oldAppSocketId
      );

      socket.emit('your_room_id', upperRoomCode);
      socket.emit('initial_state', getInitialStateForApp(roomState));
      socket.emit(
        'set_cursor_visibility',
        roomState.lastKnownCursor.isVisible
      );

      // Notify controllers that app is back
      roomState.controllerSocketIds.forEach((controllerSid) => {
        io.to(controllerSid).emit('app_reconnected');
      });
    });

    // --- Controller registration: join room ---
    socket.on('register_controller_room', (roomCode) => {
      const upperRoomCode = String(roomCode || '').toUpperCase();
      log(
        'Controller attempting to join room:',
        upperRoomCode,
        'socket:',
        socket.id
      );

      const roomState = roomStates.get(upperRoomCode);
      if (!roomState) {
        warn('Controller failed to join invalid/expired room:', upperRoomCode);
        socket.emit('invalid_room', upperRoomCode);
        socket.disconnect();
        return;
      }

      currentRoomCode = upperRoomCode;
      roomState.controllerSocketIds.add(socket.id);
      socket.join(upperRoomCode);

      log(
        'Controller joined room',
        upperRoomCode,
        'socket:',
        socket.id,
        'total controllers:',
        roomState.controllerSocketIds.size
      );

      // First controller -> show cursor on app
      let cursorVisibilityChanged = false;
      if (!roomState.lastKnownCursor.isVisible) {
        roomState.lastKnownCursor.isVisible = true;
        cursorVisibilityChanged = true;
      }

      // Sync keyboard state to this controller
      socket.emit('update_controller_state', {
        controllerState: roomState.controllerState,
      });

      if (cursorVisibilityChanged && roomState.appSocketId) {
        const appSocket = io.sockets.sockets.get(roomState.appSocketId);
        if (appSocket) {
          io.to(roomState.appSocketId).emit('set_cursor_visibility', true);
        } else {
          warn(
            'cursor visibility: app socket not found for room',
            upperRoomCode,
            'socket:',
            roomState.appSocketId
          );
          roomState.lastKnownCursor.isVisible = true;
        }
      }
    });

    // --- App-side state reporting (cursor + focus) ---

    socket.on('report_cursor_position', (data) => {
      if (!data || !data.roomId || !data.pos) return;
      const upperRoomCode = String(data.roomId).toUpperCase();
      const roomState = roomStates.get(upperRoomCode);
      if (!roomState || socket.id !== roomState.appSocketId) return;

      roomState.lastKnownCursor.x = data.pos.x;
      roomState.lastKnownCursor.y = data.pos.y;
    });

    socket.on('report_focus_change', (data) => {
      if (!data || !data.roomId || !data.focusInfo) return;
      const upperRoomCode = String(data.roomId).toUpperCase();
      const roomState = roomStates.get(upperRoomCode);
      if (!roomState || socket.id !== roomState.appSocketId) return;

      roomState.lastKnownFocusSelector = data.focusInfo.selector || null;
      roomState.lastKnownFocusValue = data.focusInfo.value || '';
    });

    // --- Controller actions -> forward to app ---

    socket.on('cursor_move', (data) => {
      if (!data || !data.roomId) return;
      const upperRoomCode = String(data.roomId).toUpperCase();
      const roomState = roomStates.get(upperRoomCode);

      if (!roomState || !roomState.controllerSocketIds.has(socket.id)) {
        warn(
          'cursor_move: invalid room or sender',
          upperRoomCode,
          'socket:',
          socket.id
        );
        return;
      }

      if (!roomState.appSocketId) return;

      const appSocket = io.sockets.sockets.get(roomState.appSocketId);
      if (!appSocket) {
        warn(
          'cursor_move: app socket not connected for room',
          upperRoomCode,
          'socket:',
          roomState.appSocketId
        );
        return;
      }

      const sensitiveData = {
        deltaX: (data.deltaX || 0) * roomState.sensitivity,
        deltaY: (data.deltaY || 0) * roomState.sensitivity,
      };

      io.to(roomState.appSocketId).emit('cursor_move', sensitiveData);
    });

    socket.on('tap', (data) => {
      if (!data || !data.roomId) return;
      const upperRoomCode = String(data.roomId).toUpperCase();
      const roomState = roomStates.get(upperRoomCode);

      if (!roomState || !roomState.controllerSocketIds.has(socket.id)) {
        warn(
          'tap: invalid room or sender',
          upperRoomCode,
          'socket:',
          socket.id
        );
        return;
      }

      if (!roomState.appSocketId) return;

      const appSocket = io.sockets.sockets.get(roomState.appSocketId);
      if (!appSocket) {
        warn(
          'tap: app socket not connected for room',
          upperRoomCode,
          'socket:',
          roomState.appSocketId
        );
        return;
      }

      io.to(roomState.appSocketId).emit('tap', {
        source: data.source,
      });
    });

    socket.on('key_input', (data) => {
      if (!data || !data.roomId || !data.key) return;
      const upperRoomCode = String(data.roomId).toUpperCase();
      const roomState = roomStates.get(upperRoomCode);

      if (!roomState || !roomState.controllerSocketIds.has(socket.id)) {
        warn(
          'key_input: invalid room or sender',
          upperRoomCode,
          'socket:',
          socket.id
        );
        return;
      }

      const key = data.key;
      let controllerStateChanged = false;
      let keyToBroadcast = null;

      // Mode switching
      if (key === 'ToggleMode') {
        const allowedModes = ['letters', 'numbers', 'symbols2'];
        if (data.targetMode && allowedModes.includes(data.targetMode)) {
          if (roomState.controllerState.keyboardMode !== data.targetMode) {
            roomState.controllerState.keyboardMode = data.targetMode;
            roomState.controllerState.isShiftActive = false;
            controllerStateChanged = true;
          }
        }
      }
      // Shift toggle (only in letters mode)
      else if (key === 'ToggleShift') {
        if (roomState.controllerState.keyboardMode === 'letters') {
          roomState.controllerState.isShiftActive =
            !roomState.controllerState.isShiftActive;
          controllerStateChanged = true;
        }
      }
      // Regular key
      else {
        if (
          roomState.controllerState.keyboardMode === 'letters' &&
          roomState.controllerState.isShiftActive &&
          key.length === 1 &&
          key >= 'a' &&
          key <= 'z'
        ) {
          keyToBroadcast = key.toUpperCase();
          roomState.controllerState.isShiftActive = false;
          controllerStateChanged = true;
        } else {
          keyToBroadcast = key;
        }
      }

      if (controllerStateChanged) {
        broadcastControllerStateToRoom(upperRoomCode);
      }

      if (keyToBroadcast && roomState.appSocketId) {
        const appSocket = io.sockets.sockets.get(roomState.appSocketId);
        if (!appSocket) {
          warn(
            'key_input: app socket not connected for room',
            upperRoomCode,
            'socket:',
            roomState.appSocketId
          );
          return;
        }
        io.to(roomState.appSocketId).emit('key_input', {
          key: keyToBroadcast,
        });
      }
    });
  });

  // Optionally expose state for debugging/inspection (read-only usage recommended)
  return {
    options,
    roomStates,
  };
}

module.exports = {
  attachWebTouchController,
};
