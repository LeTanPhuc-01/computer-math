from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
from io import BytesIO
from PIL import Image
import sys
import os

# --- DEBUGGING SECTION ---
# We check if the files exist before importing
print(f"Current Working Directory: {os.getcwd()}")
files = os.listdir('.')
if 'ocr.py' not in files:
    print("❌ CRITICAL ERROR: ocr.py not found in this folder!")
    print(f"Files found: {files}")
    sys.exit(1)

# Import directly to see the full traceback if it fails
print("Attempting to import OCR_Engine from ocr.py...")
from ocr import OCR_Engine
print("✅ Import successful!")
# -------------------------

app = Flask(__name__)
CORS(app)

print("Initializing OCR Engine...")
engine = OCR_Engine("./weights/mnist_best_model.pth") 

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        image_data = data.get('image')

        if not image_data:
            return jsonify({'error': 'No image provided'}), 400

        header, encoded = image_data.split(",", 1)
        binary_data = base64.b64decode(encoded)
        
        temp_filename = "temp_web_input.png"
        with open(temp_filename, "wb") as f:
            f.write(binary_data)

        digit, conf = engine.predict_image(temp_filename)

        if os.path.exists(temp_filename):
            os.remove(temp_filename)

        return jsonify({
            'digit': digit,
            'confidence': float(conf)
        })

    except Exception as e:
        print(f"Error during prediction: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting Flask Server...")
    print("Connect your browser to http://localhost:5000")
    app.run(debug=True, port=5000)