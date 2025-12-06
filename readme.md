# WebTouch Kiosk – Room-Based Remote Web Controller

This project implements a real-time remote-control system for web pages using **Node.js**, **Express**, and **Socket.IO**. It uses a **room-based hybrid architecture** so that:

- Each **viewport app** (`app.html`) runs as an independent instance with its own 4-letter **Room Code**.
- One or more **controllers** (`controller.html`) can connect to a specific viewport via that Room Code.
- The **server** acts as a smart relay + state manager, while the **viewport app** handles the actual UI updates for low-latency interaction.

The codebase is structured so you can use it as a **instructive module**: where you can keep the WebTouch plumbing as-is and focus on building your own frontend UI on top of it.

---

## Directory Structure

```text
.
├─ lib/
│  └─ webTouchController.js       # Server-side Socket.IO room logic (attachWebTouchController)
├─ public/
│  ├─ app.html                    # Demo viewport app (full-page controlled UI)
│  ├─ controller.html             # Touch controller UI
│  ├─ css/
│  │  ├─ webtouch.css             # Shared theme + primitive styles (wt-* classes)
│  │  ├─ webtouchController.css   # Styles specific to controller.html
│  │  └─ webtouchViewport.css     # Styles specific to app.html viewport demo
│  └─ js/
│     ├─ app.js                   # Viewport app logic (room, QR, cursor, hover/focus)
│     ├─ controller.js            # Touch controller logic (join form, touchpad, keyboard)
│     └─ webTouchClient.js        # Browser client wrapper for Socket.IO (app + controller)
├─ server.js                      # Express + Socket.IO server entrypoint
├─ package.json
└─ readme.md
````

---

## High-Level Architecture

### Rooms & Codes

* Each `app.html` instance is assigned a 4-letter **Room Code** (e.g., `ABCD`) by the server.
* The server tracks **per-room state** in memory: app socket, controller sockets, keyboard mode/shift state, last cursor/focus info.
* Controllers connect to a **specific** room by:

  * Scanning the QR code shown on that app, or
  * Entering the Room Code manually on `/controller`.

### Hybrid Architecture

The flow is intentionally “hybrid”:

* **Server** (`lib/webTouchController.js`)

  * Validates and relays events **within the correct room**:

    * `cursor_move` (controller → app)
    * `tap` (controller → app)
    * `key_input` (controller → app, processed through per-room keyboard state)
  * Manages room state:

    * `appSocketId`, `controllerSocketIds`
    * Keyboard mode / shift (`controllerState`)
    * Last known cursor + focus info for rejoin (`report_cursor_position`, `report_focus_change`)
  * Handles app and controller connect/reconnect/disconnect logic.

* **Viewport App** (`public/app.html` + `public/js/app.js`)

  * Renders the **full-page demo UI** (text inputs, textarea, radios/checkboxes, clickable box).
  * Shows its Room Code + QR code in the top-right corner.
  * Processes relayed events **locally** for responsiveness:

    * Moves the red virtual cursor.
    * Computes hover (green outline) and focus (blue outline) on DOM elements.
    * Applies text input changes on key events.
  * Reports cursor + focus state back to the server so reconnecting apps can restore context.

* **Touch Controller** (`public/controller.html` + `public/js/controller.js`)

  * Renders a **trackpad + soft keyboard** layout, optimized for touch devices.
  * On load:

    * Reads `?room=CODE` from the URL and attempts to join that room, or
    * Shows a **manual Room Code entry** form if none is provided.
  * Sends:

    * Pointer deltas (`cursor_move`)
    * Taps (`tap`) – single-finger, two-finger, right-click, etc.
    * Key presses (`key_input`) from the multi-layer keyboard (letters / numbers / symbols).
  * Receives `update_controller_state` to keep its keyboard mode/shift UI in sync with the server’s room state.

---

## Core Modules

### 1. Server-Side: `lib/webTouchController.js`

This module encapsulates all Socket.IO room logic. It exports:

```js
const { attachWebTouchController } = require('./lib/webTouchController');

attachWebTouchController(io, {
  // optional configuration
  debug: true,          // enable console logging
  defaultSensitivity: 2 // scale for cursor movement deltas
});
```

Responsibilities:

* Generates 4-letter **Room Codes** from an alphabet (no external ID libs needed).
* Manages a `roomStates` Map keyed by Room Code:

  * `appSocketId`
  * `controllerSocketIds` (Set)
  * `lastKnownCursor` (x, y, visible)
  * `lastKnownFocusSelector`, `lastKnownFocusValue`
  * `controllerState` (keyboardMode, isShiftActive)
  * `sensitivity` per room
* Listens for:

  * `register_app_room`, `rejoin_app_room`
  * `register_controller_room`
  * `cursor_move`, `tap`, `key_input` (from controllers)
  * `report_cursor_position`, `report_focus_change` (from app)
* Emits:

  * `your_room_id`, `initial_state`, `set_cursor_visibility` (to app)
  * `invalid_room`, `app_disconnected`, `app_reconnected`, `update_controller_state` (to controllers)

### 2. Browser-Side Client Wrapper: `public/js/webTouchClient.js`

Provides a small, unopinionated API on top of Socket.IO:

```js
import { createAppClient, createControllerClient } from './js/webTouchClient.js';

const appClient = createAppClient();
const controllerClient = createControllerClient();
```

* **App client:**

  ```js
  const client = createAppClient();

  client.registerNewRoom();
  client.rejoinRoom(roomId);

  client.onConnected(fn);
  client.onDisconnected(fn);
  client.onInitialState(fn);
  client.onCursorMove(fn);             // when server relays controller move
  client.onTap(fn);                    // when server relays controller tap
  client.onKeyInput(fn);               // when server relays processed key
  client.onCursorVisibilityChange(fn); // show/hide remote cursor

  client.reportCursorPosition({ x, y });
  client.reportFocusChange({ selector, value? });
  ```

* **Controller client:**

  ```js
  const client = createControllerClient();

  client.joinRoom(roomCode);

  client.onConnected(fn);
  client.onDisconnected(fn);
  client.onInvalidRoom(fn);       // server says room doesn’t exist
  client.onAppDisconnected(fn);   // app for that room closed
  client.onAppReconnected(fn);    // app came back
  client.onControllerStateChange(fn); // keyboard mode/shift

  client.sendCursorMove(deltaX, deltaY);
  client.sendTap('single_tap' | 'two_finger' | 'pointer_button_right');
  client.sendKey(key, extra);     // includes ToggleMode / ToggleShift / chars
  ```

This wrapper lets students build their **own app/ controller UIs** without hand-wiring raw `socket.on/emit` everywhere.

### 3. Demo Viewport App: `public/app.html` + `public/js/app.js`

* Uses `webTouchClient.createAppClient` to:

  * Request a new room or rejoin an existing one (via `sessionStorage`).
  * Receive `your_room_id`, and generate a QR code pointing to `/controller?room=CODE` using the `qrcode` CDN library.
  * Process relayed `cursor_move`, `tap`, and `key_input` events.

* Handles:

  * Virtual cursor rendering & movement.
  * Hit-testing elements under the cursor (using `document.elementFromPoint`).
  * Distinguishing hover vs focus vs click for labels/inputs/radios/checkboxes.
  * Manual hover/focus visuals (`manual-hover`, `manual-focus` classes).
  * Remote typing into focused inputs/textareas (Backspace, Enter, characters).

### 4. Touch Controller: `public/controller.html` + `public/js/controller.js`

* Uses `webTouchClient.createControllerClient` to:

  * Join a room via URL param (`?room=CODE`) or manual form.
  * Emit pointer deltas and taps from the touch surface.
  * Emit key input events from the on-screen keyboard (letters / numbers / symbols).

* UI:

  * Controller layout styled via `webtouchController.css`.
  * Intro overlay animation demonstrating drag on first interaction.
  * Soft keyboard with:

    * Shift (⇧)
    * Mode switches (?123 / ABC / symbols)
    * Backspace, Enter, Space
  * Status messages for “Connecting…”, “Invalid room”, “App disconnected”, etc.

---

## CSS Layers

To keep things modular:

* `public/css/webtouch.css`
  Shared `wt-*` utilities and theming primitives (e.g., used by any future WebTouch UIs).

* `public/css/webtouchController.css`
  Layout + styles specific to the controller page (`controller.html`):
  touch surface, manual join form, keyboard rows/keys, intro animation.

* `public/css/webtouchViewport.css`
  Layout + styles specific to the viewport demo (`app.html`):
  full-page layout, QR badge, `main-content`, `inputArea`, manual hover/focus classes, etc.

Students can:

* Use your styles as-is, or
* Swap in their own CSS that keeps the same IDs/class hooks used by `app.js` / `controller.js`.

---

## Running the Demo Locally

### 1. Install dependencies

From the project root:

```bash
npm install
```

(Minimal dependencies: `express`, `socket.io`. The QRCode library is loaded via CDN in `app.html`.)

### 2. Start the server

```bash
node server.js
# or if you have nodemon:
# npx nodemon server.js
```

By default this listens on `http://localhost:3000`.

### 3. Open the viewport app

In a desktop browser:

* Visit: `http://localhost:3000/`
* You’ll see:

  * A full-page UI with a “Click Me” box and a form.
  * A **QR badge** in the top-right showing a 4-letter Room Code and a QR code pointing to `/controller?room=CODE`.

### 4. Connect a controller

On a phone/tablet (same network):

* **Option A – QR Code:**
  Scan the QR from the app page. It will open `/controller?room=CODE`.

* **Option B – Manual Code:**
  Go to `http://<your-machine-ip>:3000/controller` and type in the Room Code shown on the app.

Once joined:

* A red cursor should appear on the app screen.
* Dragging on the controller’s touch area moves the cursor.
* Tapping triggers clicks & focus.
* Using the on-screen keyboard types into the focused field on the app.

---

## Using WebTouch in Your Own App (For Students)

You can treat this repo as a **starter library**:

1. **Server side**

   In your own Express app, after creating a Socket.IO server:

   ```js
   const { attachWebTouchController } = require('./lib/webTouchController');

   attachWebTouchController(io, {
     debug: false,
     defaultSensitivity: 2.0,
   });
   ```

   Keep your existing routes (`/`, `/api/...`) as normal.

2. **Client side – viewport**

   In your HTML:

   ```html
   <script src="/socket.io/socket.io.js"></script>
   <script type="module" src="/js/app.js"></script>
   ```

   In `app.js`, either:

   * Reuse the provided `public/js/app.js` and tweak the DOM it targets, or
   * Build your own with:

     ```js
     import { createAppClient } from './webTouchClient.js';

     const client = createAppClient();
     client.registerNewRoom();

     client.onCursorMove(({ deltaX, deltaY }) => {
       // move your own cursor / highlight
     });

     client.onTap(() => {
       // decide how a “tap” manipulates your app
     });

     client.onKeyInput(({ key }) => {
       // handle text input in your UI
     });
     ```

3. **Client side – controller**

   In your controller page:

   ```html
   <script src="/socket.io/socket.io.js"></script>
   <script type="module" src="/js/controller.js"></script>
   ```

   Or write your own controller logic using:

   ```js
   import { createControllerClient } from './webTouchClient.js';

   const client = createControllerClient();
   client.joinRoom('ABCD'); // or from URL/form
   client.sendCursorMove(dx, dy);
   client.sendTap();
   client.sendKey('a');
   ```

This separation lets students focus on building **interesting UIs** while relying on a stable WebTouch networking layer.

---

## Troubleshooting

* **Controller says “Invalid room”**

  * Make sure the Room Code matches exactly (4 letters).
  * Ensure the app page is open and has already registered its room.

* **No cursor appears on the app**

  * Confirm the controller successfully joined (no “Invalid room”).
  * Check browser console on both app and controller pages for errors.
  * Verify that the app includes `socket.io.js` and `app.js` correctly.

* **Typing doesn’t appear in the app inputs**

  * Ensure a text input or textarea is focused on the app when typing.
  * Check that `key_input` events are received in the app console.
  * Make sure the CSS classes for `manual-focus` haven’t been removed/renamed.

---
