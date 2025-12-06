const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const predictionEl = document.getElementById('prediction');
const confidenceEl = document.getElementById('confidence');

// Variables to track drawing state
let isDrawing = false;

// 1. SETUP CANVAS STYLE
// We draw with a thick black brush on a white background
function resetCanvas() {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 15; 
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
}

// Initialize styles
resetCanvas();

// 2. HELPER: Get Coordinates
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    // Support both mouse and touch events
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

// 3. DRAWING EVENT LISTENERS
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// Touch support for mobile
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // prevent scrolling
    startDrawing(e);
});
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    draw(e);
});
canvas.addEventListener('touchend', stopDrawing);

function startDrawing(e) {
    isDrawing = true;
    const pos = getPos(e);
    
    // CRITICAL FIX: We must begin a path and move to the start point
    // BEFORE we try to draw a line.
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
    if (!isDrawing) return;

    const pos = getPos(e);

    // Draw line to new position
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    
    // Reset path to current position for smoother drawing of the next segment
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
}

function stopDrawing() {
    if (isDrawing) {
        isDrawing = false;
        ctx.beginPath(); // Close path
        
        // Trigger prediction when user lifts finger/mouse
        sendToModel();
    }
}

function clearCanvas() {
    resetCanvas();
    predictionEl.innerText = "-";
    confidenceEl.innerText = "Confidence: 0%";
}

// 4. SEND DATA TO PYTHON BACKEND
async function sendToModel() {
    // Convert canvas to Base64 Image String
    const imageData = canvas.toDataURL('image/png');

    try {
        const response = await fetch('http://localhost:5000/predict', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: imageData })
        });

        const result = await response.json();

        if (result.error) {
            console.error(result.error);
            return;
        }

        // Update UI
        predictionEl.innerText = result.digit;
        const confPercent = (result.confidence * 100).toFixed(2);
        confidenceEl.innerText = `Confidence: ${confPercent}%`;

    } catch (error) {
        console.error("Connection Error:", error);
        confidenceEl.innerText = "Backend disconnected";
    }
}