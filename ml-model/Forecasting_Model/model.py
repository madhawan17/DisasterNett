import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, random_split
from sklearn.metrics import f1_score, roc_auc_score
import numpy as np

# Import the dataset class
from dataset import BalancedFlashFloodDataset

# 1. The LSTM Architecture
class FlashFloodLSTM(nn.Module):
    def __init__(self, input_features=4, hidden_size=64, num_layers=2, dropout=0.2):
        super(FlashFloodLSTM, self).__init__()
        self.lstm = nn.LSTM(
            input_size=input_features,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout
        )
        self.fc1 = nn.Linear(hidden_size, 32)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)
        self.fc2 = nn.Linear(32, 1)

    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        last_time_step = lstm_out[:, -1, :] 
        out = self.fc1(last_time_step)
        out = self.relu(out)
        out = self.dropout(out)
        out = self.fc2(out)
        return out.squeeze()

# 2. Setup Device & Data
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Training on device: {device}")

dataset = BalancedFlashFloodDataset("global_flash_flood_data_decade.csv", seq_length=24)

# 80/20 Train-Test Split
train_size = int(0.8 * len(dataset))
test_size = len(dataset) - train_size
train_dataset, test_dataset = random_split(dataset, [train_size, test_size])

train_loader = DataLoader(train_dataset, batch_size=64, shuffle=True)
test_loader = DataLoader(test_dataset, batch_size=64, shuffle=False)

# 3. Initialize Model, Loss, and Optimizer
model = FlashFloodLSTM().to(device)
criterion = nn.BCEWithLogitsLoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)
scaler = torch.amp.GradScaler('cuda') 

EPOCHS = 15
best_test_f1 = 0.0

print("\nStarting Train & Test Loop...")
for epoch in range(EPOCHS):
    # --- TRAINING PHASE ---
    model.train()
    train_loss = 0
    
    for X_batch, Y_batch in train_loader:
        X_batch, Y_batch = X_batch.to(device), Y_batch.to(device)
        optimizer.zero_grad()
        
        with torch.amp.autocast('cuda'):
            outputs = model(X_batch)
            loss = criterion(outputs, Y_batch)
            
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        
        train_loss += loss.item()
        
    # --- TESTING PHASE ---
    model.eval()
    test_loss = 0
    all_preds = []
    all_targets = []
    
    with torch.no_grad():
        for X_batch, Y_batch in test_loader:
            X_batch, Y_batch = X_batch.to(device), Y_batch.to(device)
            outputs = model(X_batch)
            loss = criterion(outputs, Y_batch)
            test_loss += loss.item()
            
            probs = torch.sigmoid(outputs)
            preds = (probs > 0.5).float()
            
            all_preds.extend(preds.cpu().numpy())
            all_targets.extend(Y_batch.cpu().numpy())
            
    # Metrics
    test_f1 = f1_score(all_targets, all_preds)
    try:
        test_auc = roc_auc_score(all_targets, all_preds)
    except ValueError:
        test_auc = 0.0
        
    print(f"Epoch {epoch+1}/{EPOCHS} | Train Loss: {train_loss/len(train_loader):.4f} | Test Loss: {test_loss/len(test_loader):.4f} | Test F1: {test_f1:.4f} | Test AUC: {test_auc:.4f}")
    
    if test_f1 > best_test_f1:
        best_test_f1 = test_f1
        torch.save(model.state_dict(), "best_flash_flood_model.pt")
        print(f"[*] New best model saved with F1: {best_test_f1:.4f}")

print("\nTraining Complete! Get some rest.")