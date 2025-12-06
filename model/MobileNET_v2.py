#!/usr/bin/env python
# coding: utf-8

# In[3]:


'''
ABOUT ME: MobileNET_v2 Trainning and Inference
'''


# In[4]:


import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import torchvision
import torchvision.transforms as transforms
import numpy as np
import matplotlib.pyplot as plt
from tqdm import tqdm
import os
import time


# ------------------
# MODEL ARCHITECTURE
# ------------------

class DepthwiseSeparableConv2d(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size, stride=1, padding=0):
        super(DepthwiseSeparableConv2d, self).__init__()

        self.depthwise = nn.Conv2d(
            in_channels,
            in_channels,
            kernel_size=kernel_size,
            stride=stride,
            padding=padding,
            groups=in_channels,
            bias=False
        )

        self.pointwise = nn.Conv2d(
            in_channels,
            out_channels,
            kernel_size=1,
            bias=False
        )

        self.bn1 = nn.BatchNorm2d(in_channels)
        self.relu = nn.ReLU6(inplace=True)
        self.bn2 = nn.BatchNorm2d(out_channels)


    def forward(self, x):
        x = self.depthwise(x)
        x = self.bn1(x)
        x = self.relu(x)

        x = self.pointwise(x)
        x = self.bn2(x)

        return x

class ResBottleNeck(nn.Module):
    def __init__(self, in_channels, mid_channels, out_channels, kernel_size, stride=1, padding=1, skipConn=False):
        super(ResBottleNeck, self).__init__()

        self.conv1 = nn.Conv2d(in_channels, mid_channels, 1, 1, 0, bias=False) # 1x1
        self.conv2 = nn.Conv2d(mid_channels, mid_channels, kernel_size, stride, padding, bias=False, groups=mid_channels) # 3x3
        self.conv3 = nn.Conv2d(mid_channels, out_channels, 1, 1, 0, bias=False) # 1x1

        self.bn1 = nn.BatchNorm2d(mid_channels)
        self.bn2 = nn.BatchNorm2d(mid_channels)
        self.bn3 = nn.BatchNorm2d(out_channels)
        self.relu = nn.ReLU6(inplace=True)

        self.skipConn = skipConn and stride == 1 and in_channels == out_channels

    def forward(self, x):

        if self.skipConn:
            connection = x

        # Initial Part (1x1).
        out = self.conv1(x)
        out = self.bn1(out)
        out = self.relu(out)

        # Middle Part (3x3 normally).
        out = self.conv2(out)
        out = self.bn2(out)
        out = self.relu(out)

        # Final Part (1x1)
        out = self.conv3(out)
        out = self.bn3(out)

        # Handle the skip connection.
        if self.skipConn:
            out += connection

        return out


class MobileNET_v2(nn.Module):
    def __init__(self, num_classes, in_channels):
        super(MobileNET_v2, self).__init__()

        # Original MobileNET_v2 has stride=2 in this initial layer, but since the input images are already really small (32x32), 
        # we will keep stride=1 in this first convolutional layer.
        self.layer0 = DepthwiseSeparableConv2d(in_channels, 32, 3, 1, 1)

        # MobileNET_vs BottleNeck layers.
        self.layer1 = DepthwiseSeparableConv2d(32, 16, 3, 1, 1)

        self.layer2 = nn.Sequential(
            ResBottleNeck(16, 96, 24, 3, 1, 1),
            ResBottleNeck(24, 144, 24, 3, 1, 1, skipConn=True)
        )

        self.layer3 = nn.Sequential(
            ResBottleNeck(24, 144, 32, 3, 2, 1),
            ResBottleNeck(32, 192, 32, 3, 1, 1, skipConn=True),
            ResBottleNeck(32, 192, 32, 3, 1, 1, skipConn=True)
        )

        self.layer4 = nn.Sequential(
            ResBottleNeck(32, 192, 64, 3, 1, 1),
            ResBottleNeck(64, 384, 64, 3, 1, 1, skipConn=True),
            ResBottleNeck(64, 384, 64, 3, 1, 1, skipConn=True),
            ResBottleNeck(64, 384, 64, 3, 1, 1, skipConn=True)
        )

        self.layer5 = nn.Sequential(
            ResBottleNeck(64, 384, 96, 3, 1, 1),
            ResBottleNeck(96, 576, 96, 3, 1, 1, skipConn=True),
            ResBottleNeck(96, 576, 96, 3, 1, 1, skipConn=True)
        )

        self.layer6 = nn.Sequential(
            ResBottleNeck(96, 576, 160, 3, 2, 1),
            ResBottleNeck(160, 960, 160, 3, 1, 1, skipConn=True),
            ResBottleNeck(160, 960, 160, 3, 1, 1, skipConn=True)
        )

        self.layer7 = ResBottleNeck(160, 960, 320, 3, 1, 1)

        self.layer8 = nn.Sequential(
            nn.Conv2d(320, 1280, 1, 1, 0, bias=False),
            nn.BatchNorm2d(1280),
            nn.ReLU6(inplace=True),
            nn.AdaptiveAvgPool2d(1),
            nn.Conv2d(1280, num_classes, 1, 1, 0)
        )


    def forward(self, x):

        out = self.layer0(x)
        out = self.layer1(out)
        out = self.layer2(out)
        out = self.layer3(out)
        out = self.layer4(out)
        out = self.layer5(out)
        out = self.layer6(out)
        out = self.layer7(out)
        out = self.layer8(out)

        out = torch.flatten(out, 1)

        return out


# ------------
# DATA LOADING
# ------------

def get_mnist_dataloaders(batch_size=128, num_workers=2):
    """Create MNIST dataloaders."""

    # Standard MNIST statistics
    mnist_mean = (0.1307,)
    mnist_std = (0.3081,)

    # Training transforms with augmentation
    transform_train = transforms.Compose([
        transforms.RandomCrop(28, padding=4),
        transforms.RandomRotation(10), # Added rotation for MNIST
        transforms.ToTensor(),
        transforms.Normalize(mnist_mean, mnist_std)
    ])

    # Test transforms without augmentation
    transform_test = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mnist_mean, mnist_std)
    ])

    trainset = torchvision.datasets.MNIST(
        root='./data', train=True, download=True, transform=transform_train
    )
    trainloader = DataLoader(
        trainset, batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=True
    )

    testset = torchvision.datasets.MNIST(
        root='./data', train=False, download=True, transform=transform_test
    )
    testloader = DataLoader(
        testset, batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True
    )

    return trainloader, testloader


# --------
# TRAINING
# --------

def train_epoch(model, trainloader, criterion, optimizer, device, epoch, num_epochs):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    pbar = tqdm(trainloader, desc=f'Epoch {epoch}/{num_epochs}')
    for inputs, labels in pbar:
        inputs, labels = inputs.to(device), labels.to(device)

        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        running_loss += loss.item()
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

        pbar.set_postfix({
            'loss': running_loss / (pbar.n + 1),
            'acc': 100. * correct / total
        })

    return running_loss / len(trainloader), 100. * correct / total


def test(model, testloader, criterion, device):
    model.eval()
    test_loss = 0.0
    correct = 0
    total = 0

    with torch.no_grad():
        for inputs, labels in tqdm(testloader, desc='Testing'):
            inputs, labels = inputs.to(device), labels.to(device)
            outputs = model(inputs)
            loss = criterion(outputs, labels)

            test_loss += loss.item()
            _, predicted = outputs.max(1)
            total += labels.size(0)
            correct += predicted.eq(labels).sum().item()

    test_loss = test_loss / len(testloader)
    test_acc = 100. * correct / total

    print(f'Test Loss: {test_loss:.4f}, Test Accuracy: {test_acc:.2f}%')
    return test_loss, test_acc


def train_model(epochs=10, batch_size=128, lr=0.05, checkpoint_dir='checkpoints'):
    # Setup device
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}")

    os.makedirs(checkpoint_dir, exist_ok=True)
    os.makedirs('results', exist_ok=True)

    print("\nLoading MNIST dataset...")
    trainloader, testloader = get_mnist_dataloaders(batch_size)

    print("Creating MobileNET model for MNIST (1 channel)...")
    model = MobileNET_v2(num_classes=10, in_channels=1).to(device)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"Total parameters: {total_params:,}")

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.SGD(model.parameters(), lr=lr, momentum=0.9, weight_decay=5e-4)
    scheduler = optim.lr_scheduler.MultiStepLR(optimizer, milestones=[5, 8], gamma=0.1)

    train_losses, train_accs = [], []
    test_losses, test_accs = [], []
    best_acc = 0.0

    print("\n" + "="*60)
    print("Starting training...")
    print("="*60 + "\n")

    training_start_time = time.time()

    for epoch in range(1, epochs + 1):
        train_loss, train_acc = train_epoch(
            model, trainloader, criterion, optimizer, device, epoch, epochs
        )
        test_loss, test_acc = test(model, testloader, criterion, device)
        scheduler.step()

        train_losses.append(train_loss)
        train_accs.append(train_acc)
        test_losses.append(test_loss)
        test_accs.append(test_acc)

        print(f'\nEpoch {epoch}/{epochs}:')
        print(f'  Train Loss: {train_loss:.4f} | Train Acc: {train_acc:.2f}%')
        print(f'  Test Loss: {test_loss:.4f} | Test Acc: {test_acc:.2f}%')

        if test_acc > best_acc:
            best_acc = test_acc
            # --- SAVING LOGIC ---
            # This saves the model whenever we get a new best test accuracy
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'test_acc': test_acc,
            }, f'{checkpoint_dir}/mnist_best_model.pth')
            print(f'  ✓ Best model saved! (Acc: {best_acc:.2f}%)')
        print("-" * 60)

    training_end_time = time.time()
    total_training_time = training_end_time - training_start_time

    print(f"\n{'='*60}")
    print('FINAL RESULTS')
    print(f"{'='*60}")
    print(f'Best Test Accuracy: {best_acc:.2f}%')
    print(f'Total Training Time: {total_training_time:.2f}s')
    print(f"{'='*60}\n")

    return model

# ----------------
# INFERENCE CHECK
# ----------------

def measure_inference_speed(weights_path=None):
    """
    Checks if the model is capable of real-time inference.
    Args:
        weights_path (str, optional): Path to the saved model weights.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Checking inference speed on: {device}")

    # 1. Instantiate Model Architecture
    model = MobileNET_v2(num_classes=10, in_channels=1).to(device)

    # 2. Load Weights (If provided)
    if weights_path:
        if os.path.exists(weights_path):
            print(f"Loading weights from {weights_path}...")
            # map_location ensures we can load on CPU even if trained on GPU
            checkpoint = torch.load(weights_path, map_location=device)

            # The training loop saves a dictionary with 'model_state_dict'
            if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                model.load_state_dict(checkpoint['model_state_dict'])
            else:
                # Fallback in case a raw state_dict was saved
                model.load_state_dict(checkpoint)

            print("Weights loaded successfully!")
        else:
            print(f"Warning: File {weights_path} not found. Using random initialization.")
    else:
        print("No weights file provided. Using random initialization.")

    model.eval()

    # 3. Dummy Input
    dummy_input = torch.randn(1, 1, 28, 28).to(device)

    # 4. Warm-up
    print("Warming up...")
    with torch.no_grad():
        for _ in range(20):
            _ = model(dummy_input)

    # 5. Measure
    print("Measuring latency over 100 runs...")
    timings = []
    with torch.no_grad():
        for _ in range(100):
            start = time.perf_counter()
            _ = model(dummy_input)

            if device.type == 'cuda':
                torch.cuda.synchronize()

            end = time.perf_counter()
            timings.append((end - start) * 1000)

    avg_time = np.mean(timings)
    std_time = np.std(timings)
    fps = 1000 / avg_time

    print("\n" + "="*40)
    print("INFERENCE SPEED REPORT")
    print("="*40)
    print(f"Device: {device}")
    print(f"Input Shape: (1, 1, 28, 28)")
    print(f"Average Latency: {avg_time:.4f} ms ± {std_time:.4f} ms")
    print(f"Throughput:      {fps:.2f} FPS")

    if fps > 30:
        print("Verdict: REAL-TIME CAPABLE (Over 30 FPS)")
    else:
        print("Verdict: NOT REAL-TIME (Under 30 FPS)")
    print("="*40 + "\n")


# ----
# MAIN
# ----

if __name__ == "__main__":

    # 1. Set the Mode
    MODE = 'train' # 'train' or 'inference'

    # 2. Define the path for saving/loading
    WEIGHTS_FILE = 'checkpoints/mnist_best_model.pth'

    if MODE == 'train':
        # Training will automatically save to 'checkpoints/mnist_best_model.pth'
        # because the default checkpoint_dir is 'checkpoints'
        train_model(epochs=50, batch_size=128, lr=0.05, checkpoint_dir='checkpoints')

    elif MODE == 'inference':
        # Inference will now attempt to load from that file
        measure_inference_speed(weights_path=WEIGHTS_FILE)

    else:
        print("Please set MODE to 'train' or 'inference'")

