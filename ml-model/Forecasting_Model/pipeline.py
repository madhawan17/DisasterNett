import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, roc_auc_score
import random
import warnings

# Suppress sklearn warnings for clean terminal output
warnings.filterwarnings("ignore")

# ==========================================
# 1. THE DATASET (10:1 Imbalance Logic)
# ==========================================
class ImbalancedFloodDataset(Dataset):
    def __init__(self, csv_path, seq_length=24):
        print(f"Loading dataset from {csv_path}...")
        df = pd.read_csv(csv_path)
        
        self.scaler = StandardScaler()
        feature_cols = ['Precipitation_mm', 'Soil_Moisture', 'Temperature_C', 'Elevation_m']
        scaled_features = self.scaler.fit_transform(df[feature_cols])
        targets = df['Flash_Flood_Risk'].values
        
        self.valid_sequences = []
        self.labels = []
        
        flood_indices = []
        no_flood_indices = []
        
        print("Extracting 24-hour sequences...")
        for i in range(len(df) - seq_length):
            if targets[i + seq_length] == 1:
                flood_indices.append(i)
            else:
                no_flood_indices.append(i)
                
        num_floods = len(flood_indices)
        num_safe = len(no_flood_indices)
        
        if num_floods == 0:
            raise ValueError("No flood events found in dataset!")
            
        # --- THE HACKATHON SECRET: 10:1 Imbalance ---
        IMBALANCE_RATIO = 10 
        num_safe_to_keep = min(num_floods * IMBALANCE_RATIO, num_safe)
        
        sampled_no_flood_indices = random.sample(no_flood_indices, num_safe_to_keep)
        all_indices = flood_indices + sampled_no_flood_indices
        random.shuffle(all_indices)
        
        for idx in all_indices:
            self.valid_sequences.append(scaled_features[idx : idx + seq_length])
            self.labels.append(targets[idx + seq_length])
            
        print(f"\n--- DATASET READY ---")
        print(f"Total Sequences: {len(self.labels):,}")
        print(f"Floods (1): {num_floods:,} | Safe (0): {num_safe_to_keep:,}\n")

    def __len__(self):
        return len(self.valid_sequences)

    def __getitem__(self, idx):
        x_seq = self.valid_sequences[idx]
        y_label = self.labels[idx]
        return torch.tensor(x_seq, dtype=torch.float32), torch.tensor(y_label, dtype=torch.float32)

# ==========================================
# 2. THE LSTM ARCHITECTURE
# ==========================================
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

# ==========================================
# 3. THE EXECUTION ENGINE (Train & Test)
# ==========================================
if __name__ == "__main__":
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Hardware initialized. Training on: {device}")

    # Load the big dataset
    dataset = ImbalancedFloodDataset("global_flash_flood_data_decade.csv", seq_length=24)

    # 80/20 Train-Test Split
    train_size = int(0.8 * len(dataset))
    test_size = len(dataset) - train_size
    train_dataset, test_dataset = random_split(dataset, [train_size, test_size])

    # DataLoaders chunk the data for the RTX 4050
    train_loader = DataLoader(train_dataset, batch_size=64, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=64, shuffle=False)

    # Init Model
    model = FlashFloodLSTM().to(device)
    
    # --- THE PENALTY WEIGHT ---
    # Tells the model that missing a flood is 10x worse than a false alarm
    weight = torch.tensor([10.0], device=device)
    criterion = nn.BCEWithLogitsLoss(pos_weight=weight)
    
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    scaler = torch.amp.GradScaler('cuda') 

    EPOCHS = 10 # Kept to 10 so you can get some sleep
    best_test_f1 = 0.0

    print("\nStarting Deep Learning Pipeline...")
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
            print(f"[*] Best model saved with F1: {best_test_f1:.4f}")

    print("\nPipeline Complete! The model 'best_flash_flood_model.pt' is ready for tomorrow.")