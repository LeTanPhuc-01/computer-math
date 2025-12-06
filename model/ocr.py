import torch
import torchvision.transforms as transforms
from PIL import Image, ImageOps
import numpy as np
from MobileNET_v2 import MobileNET_v2

class OCR_Engine:
    def __init__(self, weights_path, device='cpu'):
        self.device = torch.device(device)
        
        # Initialize Model
        self.model = MobileNET_v2(num_classes=10, in_channels=1).to(self.device)
        
        # Load Weights
        print(f"Loading weights from {weights_path}...")
        checkpoint = torch.load(weights_path, map_location=self.device)
        
        # Handle dictionary vs state_dict saving formats
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            self.model.load_state_dict(checkpoint['model_state_dict'])
        else:
            self.model.load_state_dict(checkpoint)
            
        self.model.eval() # Important: Sets model to evaluation mode
        print("Model loaded successfully.")

    def preprocess_image(self, image_path):
        """
        Converts a raw image file into a tensor compatible with MNIST training.
        """
        # Load image
        img = Image.open(image_path).convert('L') # Convert to Grayscale ('L')

        # --- CRITICAL STEP: INVERSION ---
        # Check if image is Black text on White background (standard paper).
        # MNIST is White text on Black background. We must invert it.
        # A simple check is to look at the average pixel value.
        stat = ImageOps.grayscale(img).getextrema()
        if stat: # This is a naive check; usually, you just assume inputs are black-on-white
             img = ImageOps.invert(img)

        # Define the exact transforms used in training (minus augmentation)
        transform = transforms.Compose([
            transforms.Resize((28, 28)),    # Force resize to 28x28
            transforms.ToTensor(),          # Convert to [0,1] tensor
            transforms.Normalize((0.1307,), (0.3081,)) # MNIST Stats
        ])
        
        img_tensor = transform(img)
        
        # Add batch dimension: (1, 28, 28) -> (1, 1, 28, 28)
        img_tensor = img_tensor.unsqueeze(0).to(self.device)
        
        return img_tensor

    def predict_image(self, image_path):
        tensor = self.preprocess_image(image_path)
        
        with torch.no_grad():
            outputs = self.model(tensor)
            
            # Get probabilities (optional, but good for confidence)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)
            confidence, predicted = torch.max(probabilities, 1)
            
            digit = predicted.item()
            conf = confidence.item()
            
        return digit, conf

if __name__ == "__main__":
    # Path to your saved weights
    WEIGHTS = 'weights/mnist_best_model.pth'
    
    # Initialize the OCR engine
    ocr = OCR_Engine(WEIGHTS)
    
    # Run on an image
    # Make sure you have an image named 'my_digit.png' or change this path
    try:
        digit, confidence = ocr._image('test_image.png')
        print(f"Predicted Digit: {digit}")
        print(f"Confidence: {confidence*100:.2f}%")
    except FileNotFoundError:
        print("Please provide a valid image path to test.")