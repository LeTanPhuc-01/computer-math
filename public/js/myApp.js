// public/js/myApp.js

// Import the shared WebTouch "viewport engine".
// This function sets up socket.io, rooms, cursor, focus tracking, etc.,
// and then calls the callbacks we define below when events happen.
import { initWebTouchViewport } from './webTouchViewportCore.js';

// Grab the DOM elements that this demo cares about.
// Students would replace these with their own app's elements.
const qrCodeContainer = document.getElementById('qrCodeContainer');
const cursorElement = document.getElementById('cursor');
const testBox = document.getElementById('testBox');
const testForm = document.getElementById('testForm');

/**
 * Demo-only helper:
 * "Clears" the form by resetting all values to a known state.
 * This is called when:
 *  - user presses Enter in a non-textarea input, or
 *  - user submits the form normally in the browser.
 */
function simulateFormClear(form) {
  console.log('Simulating form clear on submit...');

  // Reset text input and textarea
  form.elements['textField'].value = '';
  form.elements['textArea'].value = '';

  // Reset radio buttons, defaulting to opt2
  const radios = form.elements['radioGroup'];
  for (let radio of radios) {
    radio.checked = radio.value === 'opt2';
  }

  // Reset checkboxes: A/B unchecked, C checked
  form.elements['checkItem1'].checked = false;
  form.elements['checkItem2'].checked = false;
  form.elements['checkItem3'].checked = true;
}

// --- Wire WebTouch viewport into THIS specific page ---
//
// We pass our DOM references + callbacks into initWebTouchViewport.
// The core module will:
//
//  - connect to the WebTouch server,
//  - create/rejoin rooms,
//  - sync cursor state,
//  - and call our onTapElement/onKeyInput handlers when a controller acts.
initWebTouchViewport({
  // Where to render the QR code + room code
  qrCodeContainer,
  // The visual element representing the remote cursor
  cursorElement,

  /**
   * Called whenever the controller sends a "tap" event.
   *  - `target` is the DOM element under the remote cursor (or null).
   *  - `helpers` are utility functions from the core module that we can use
   *    to report focus state and decorate the UI.
   */
  onTapElement(target, helpers) {
    // Unpack helper functions from the core:
    //  - reportFocusChange: tells the server what is focused now
    //  - applyManualFocusVisuals: adds .manual-focus CSS to highlight inputs
    //  - getUniqueSelector: generates a CSS selector to re-find an element later
    const { reportFocusChange, applyManualFocusVisuals, getUniqueSelector } = helpers;

    // If the user tapped "empty space" (no element under cursor):
    //  → clear focus on the page and notify the server.
    if (!target) {
      const prev = document.activeElement;
      if (prev && prev !== document.body && typeof prev.blur === 'function') {
        prev.blur();
      }
      reportFocusChange({ selector: null });
      return;
    }

    // Demo-specific behavior:
    // If they tapped the "Click Me!" box, change its text briefly.
    if (target === testBox) {
      testBox.textContent = 'Clicked!';
      setTimeout(() => (testBox.textContent = 'Click Me!'), 1500);
    }

    // Check if the target is a text field or textarea.
    // We treat these specially for focus highlighting and key input.
    const isTextInput =
      (target.tagName === 'INPUT' && target.type === 'text') ||
      target.tagName === 'TEXTAREA';

    // Let the browser handle the real focus/click behavior:
    //  - focus ensures the element becomes the active input
    //  - click triggers any built-in click behavior (buttons, labels, etc.)
    if (typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
    if (typeof target.click === 'function') {
      target.click();
    }

    // If we ended up focusing a text input, add the manual-focus CSS
    // so the student can see which element is remote-controlled.
    if (isTextInput) {
      applyManualFocusVisuals(target);
    }

    // After the tap, determine which element is now actually focused.
    const active = document.activeElement;

    // Convert that element into a CSS selector so we can restore this
    // focus later (e.g., after refresh or reconnect).
    const selector = getUniqueSelector(active === document.body ? null : active);

    // Build a focus info payload for the server.
    const focusInfo = { selector };

    // If the focused element is an input/textarea, also capture its current value
    // so reconnecting clients can restore the text.
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      focusInfo.value = active.value;
    }

    // Notify the server about the new focus state.
    reportFocusChange(focusInfo);
  },

  /**
   * Called whenever the controller sends a "key_input" event.
   *  - `activeElement` is whatever element currently has focus on this page.
   *  - The second arg carries the key and some helper utilities.
   *
   * This function decides how keys mutate the page state.
   */
  onKeyInput(activeElement, { key, reportFocusChange, getUniqueSelector }) {
    // If focus is not on an input or textarea, ignore the key.
    // (We just log it to show that something happened.)
    if (
      !activeElement ||
      (activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA')
    ) {
      console.log('Key input, but no suitable element focused.');
      return;
    }

    const inputElement = activeElement;
    const start = inputElement.selectionStart;
    const end = inputElement.selectionEnd;
    const currentValue = inputElement.value;
    let valueChanged = false;

    // Handle Backspace:
    //  - If no selection, delete one character to the left.
    //  - If a selection exists, delete the selected range.
    if (key === 'Backspace') {
      if (start === end && start > 0) {
        inputElement.value =
          currentValue.substring(0, start - 1) + currentValue.substring(end);
        inputElement.selectionStart = inputElement.selectionEnd = start - 1;
        valueChanged = true;
      } else if (start < end) {
        inputElement.value =
          currentValue.substring(0, start) + currentValue.substring(end);
        inputElement.selectionStart = inputElement.selectionEnd = start;
        valueChanged = true;
      }

    // Handle Enter key:
    } else if (key === 'Enter') {
      if (inputElement.tagName === 'TEXTAREA') {
        // For textareas, Enter inserts a newline
        inputElement.value =
          currentValue.substring(0, start) + '\n' + currentValue.substring(end);
        inputElement.selectionStart = inputElement.selectionEnd = start + 1;
        valueChanged = true;
      } else if (inputElement.form) {
        // Demo-specific behavior:
        // For non-textarea inputs with a form, Enter "clears" the form.
        simulateFormClear(inputElement.form);
      }

    // Handle regular character keys and space:
    } else if (key.length === 1 || key === ' ') {
      // Insert the character at the current cursor/selection position.
      inputElement.value =
        currentValue.substring(0, start) + key + currentValue.substring(end);
      inputElement.selectionStart = inputElement.selectionEnd = start + key.length;
      valueChanged = true;
    }

    if (valueChanged) {
      // Fire a standard 'input' event so any listeners react to value changes.
      inputElement.dispatchEvent(
        new Event('input', { bubbles: true, cancelable: true })
      );

      // Report the new value + selector to the server so reconnects can restore it.
      const selector = getUniqueSelector(inputElement);
      reportFocusChange({ selector, value: inputElement.value });
    }
  },
});

// --- Local browser-only behavior (not part of WebTouch core) ---
//
// This is just to make the demo feel "normal" when used with mouse/keyboard.
// If user submits the form with a local mouse click / Enter, we apply
// the same "clear" behavior as the remote Enter-press above.
if (testForm) {
  testForm.addEventListener('submit', (e) => {
    e.preventDefault();          // Prevent actual navigation/submit
    simulateFormClear(testForm); // Reuse the same reset logic
  });
}
