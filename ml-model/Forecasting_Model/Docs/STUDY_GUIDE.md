# FloodSense System - Complete Study Guide & Revision Notes

This guide covers all major system components, architecture decisions, and key concepts discussed. Use this for revision and quick reference.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Data Pipeline](#data-pipeline)
3. [Feature Engineering](#feature-engineering)
4. [Dataset Construction](#dataset-construction)
5. [Label Generation](#label-generation)
6. [LSTM Architecture](#lstm-architecture)
7. [Loss Functions & Training](#loss-functions--training)
8. [Evaluation & Metrics](#evaluation--metrics)
9. [Threshold Optimization](#threshold-optimization)
10. [Model Comparison: Nowcast vs Forecast](#model-comparison-nowcast-vs-forecast)
11. [Inference Pipeline](#inference-pipeline)
12. [Key Terminology](#key-terminology)

---

## System Overview

### What is FloodSense?

**FloodSense** is a **serving-first ML system** that predicts flash flood risk using LSTM neural networks trained on historical weather data from Open-Meteo APIs.

### Two Independent Capabilities:

1. **Nowcast** (`best.pt`)
   - Predicts: Current flood risk NOW
   - Uses: Past 96 hours of weather data
   - Loss: Weighted BCE (pos_weight=200)
   - Metrics: PR-AUC=0.9923, ROC-AUC=0.9999

2. **Forecast** (`forecast_24h.pt`)
   - Predicts: Flood risk in NEXT 24 HOURS
   - Uses: Past 96 hours + Future 24 hours
   - Loss: Focal Loss (γ=2, α=0.5)
   - Metrics: PR-AUC=0.9597, ROC-AUC=1.0000
   - Threshold: 0.7276 (F1-optimized)

### System Architecture (3 Layers):

```
┌─────────────────────────────────────────┐
│  SERVING LAYER (FastAPI)                │
│  - /predict endpoint (nowcast)          │
│  - /forecast endpoint (24h ahead)       │
│  - Stateless, handles real-time requests│
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  MODEL LAYER (PyTorch LSTM)             │
│  - Loaded models: best.pt + forecast.pt │
│  - Artifacts: scaler.joblib             │
│  - Inference: <2s per request           │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  DATA LAYER (Open-Meteo APIs)           │
│  - Archive API (historical weather)     │
│  - Forecast API (future weather)        │
│  - Elevation API (terrain height)       │
└─────────────────────────────────────────┘
```

---

## Data Pipeline

### Data Source: Open-Meteo APIs

**Why Open-Meteo?**
- Free, no API keys required
- Global coverage (any lat/lon on Earth)
- Hourly resolution weather data
- Reliable for research/production

### Three API Calls:

| API | Data | Used For | Hours |
|-----|------|----------|-------|
| **Archive API** | ERA5-Land reanalysis | Historical weather | Past 96 hours |
| **Forecast API** | GFS/IFS NWP models | Future weather | Next 24 hours |
| **Elevation API** | SRTM terrain data | Terrain height | Constant per location |

### Raw Data Retrieved:

```
For any coordinate (lat, lon):

Archive API returns (96 rows):
- Precipitation (mm)
- Soil moisture (%)
- Temperature (°C)
- Wind speed (km/h)
- Relative humidity (%)

Forecast API returns (120 rows = 96 historical + 24 future):
- Same 5 variables as above
- Tagged with is_forecast flag
```

### Total Dataset Size:

- **5.8 Million rows** of historical observations
- **45 Global cities** (diverse climates)
- **2010 - February 2026** (16+ years of data)
- **Hourly resolution** (1 row per hour per city)
- **Source**: Kaggle Global Flash Flood Dataset

---

## Feature Engineering

### Why Feature Engineering?

Raw weather variables (precipitation, soil moisture, temperature) alone are **insufficient** for flood prediction. LSTM needs **temporal context** and **derived signals** to learn patterns.

### 5 Raw Variables → 13 Engineered Features

| Category | Feature | Formula | Why Important |
|----------|---------|---------|----------------|
| **Base (4)** | Precipitation_mm | Raw value | Immediate rainfall |
| | Soil_Moisture | Raw value | Ground saturation |
| | Temperature_C | Raw value | Evaporation rate |
| | Elevation_m | Constant | Terrain slope affects runoff |
| **Rolling Windows (4)** | Rain_3h | Sum(last 3h) | Rainfall intensity trend |
| | Rain_6h | Sum(last 6h) | Medium-term accumulation |
| | Rain_12h | Sum(last 12h) | Long-term accumulation |
| | Rain_24h | Sum(last 24h) | Day-long rainfall pattern |
| **Interaction (1)** | Precip_x_Soil | Precip × Soil | Nonlinear saturation effect |
| **Lags (3)** | Soil_lag1 | Soil_t-1 | Soil memory (1h back) |
| | Soil_lag3 | Soil_t-3 | Soil memory (3h back) |
| | Soil_rate | (Soil_current - Soil_lag1) | How fast soil changes |
| **Temperature (1)** | Temp_lag1 | Temp_t-1 | Evaporation context |

### Feature Engineering Steps:

```
Step 1: Calculate rolling aggregates
  Rain_3h = sum(Precip[t-2:t])
  Rain_6h = sum(Precip[t-5:t])
  ... etc

Step 2: Create interactions
  Precip_x_Soil = Precipitation * Soil_Moisture

Step 3: Compute lags
  Soil_lag1 = shift(Soil_Moisture, 1)
  Soil_lag3 = shift(Soil_Moisture, 3)

Step 4: Calculate rates
  Soil_rate = Soil_current - Soil_lag1

Step 5: Stack all features
  Result: 13 columns per row

Output: 13-dimensional feature vector per hour
```

### Example Calculation:

```
Hour: 12:00 UTC

Raw Data at t=12:
  Precip = 2.1 mm
  Soil = 0.45 (45%)
  Temp = 22°C

Derived at t=12:
  Rain_3h = Precip[10] + Precip[11] + Precip[12] 
          = 1.5 + 0.8 + 2.1 = 4.4 mm
  
  Rain_6h = sum(Precip[7:12]) = 8.2 mm
  Rain_12h = sum(Precip[1:12]) = 15.3 mm
  Rain_24h = sum(Precip[prev day + today]) = 28.7 mm
  
  Precip_x_Soil = 2.1 × 0.45 = 0.945
  
  Soil_lag1 = Soil[11] = 0.43
  Soil_lag3 = Soil[9] = 0.42
  Soil_rate = 0.45 - 0.43 = 0.02
  
  Temp_lag1 = Temp[11] = 21.5°C

Feature Vector (t=12):
[2.1, 0.45, 22, 4.4, 8.2, 15.3, 28.7, 0.945, 0.43, 0.42, 0.02, 21.5, <elevation>]
↑
13 dimensions, normalized to μ=0, σ=1
```

---

## Dataset Construction

### Step-by-Step Process:

#### Step 1: Raw Data (5.8M rows, 5 features)

```
Timestamp          | Precip | Soil  | Temp | Wind | Humidity
2010-01-01 00:00   | 0      | 0.3   | 15   | 5    | 45
2010-01-01 01:00   | 0.2    | 0.31  | 14   | 6    | 48
...
2026-02-28 23:00   | 3.5    | 0.65  | 18   | 12   | 60

Total: 5,808,552 rows from 45 cities
```

#### Step 2: Feature Engineering (5.8M rows, 13 features)

```
All 5 raw features → Processed through engineering pipeline

Output: data/processed/flood.csv (5.8M rows × 13 columns)
```

#### Step 3: Sliding Window Creation

**Why sliding windows?**
- LSTM needs temporal sequences, not isolated points
- 24-hour window gives model context for short-term prediction
- Creates overlapping sequences from continuous time series

**Window Creation Algorithm:**

```python
window_size = 24  # hours
stride = 1        # overlap by 23 hours

for i in range(len(data) - window_size):
    window = data[i:i+window_size]  # 24 consecutive hours
    label = data[i+window_size]      # Next hour label
    
    training_samples.append((window, label))

# Result: 4.6M windows from 5.8M rows
```

**Visualization:**

```
Raw sequence:  [0, 1, 2, 3, 4, 5, 6, ...., 5.8M]
Window 1:      [0←──────────────────→23], Label: [24]
Window 2:          [1←──────────────→24], Label: [25]
Window 3:              [2←─────────→25], Label: [26]
...
Window 4.6M:        [4.6M-24←─────→4.6M], Label: [4.6M+1]

Each window = (24, 13) tensor
Each label = scalar (0 or 1)
```

#### Step 4: Train/Test Split (non-shuffled)

**Why non-shuffled?**
- Temporal data has autocorrelation
- Shuffling breaks temporal structure
- Can cause data leakage between train & test
- Real-world is time-ordered

**Split:**

```
Total samples: 4.6M windows

Train (80%): 3.68M samples
  - Dates: 2010-01-01 to ~2022-12-01
  - Used for: Model training

Test (20%): 920K samples
  - Dates: ~2022-12-01 to 2026-02-28
  - Used for: Evaluation, threshold optimization
```

#### Step 5: Balanced Batch Creation

**The Imbalance Problem:**

```
Raw label distribution:
  Flood (1):     6,500 samples
  No flood (0):  5.8M samples
  
Ratio: 1 flood : 893 non-floods
```

**Solution: WeightedRandomSampler**

```python
# Each epoch, sampler adjusts probability
# to draw 50% floods, 50% non-floods per batch

while training:
    batch_size = 256
    
    from_sampler:
      - 128 flood samples (1)
      - 128 non-flood samples (0)
    
    Effective ratio in batch: 1:1 (balanced)
    Actual data ratio: 1:893 (preserved downsampler knows true dist)
    
    # Model learns equally from both classes
```

### Final Dataset Summary:

```
Original:      5.8M rows × 5 features
After FE:      5.8M rows × 13 features
After window:  4.6M samples × (24, 13)
Train split:   3.68M samples (80%)
Test split:    920K samples (20%)
Batch balance: 50/50 flood ratio (effective)
```

---

## Label Generation

### Binary Flood Detection Rule

The label `y ∈ {0, 1}` is computed using **physics-based thresholds**:

```python
def compute_label(precip_3h, soil_moisture):
    """
    Is this hour a flood event?
    """
    
    condition_1 = precip_3h >= 30  # Heavy rainfall alone
    condition_2 = (precip_3h >= 20) AND (soil_moisture >= 0.35)
    
    if condition_1 OR condition_2:
        return 1  # FLOOD
    else:
        return 0  # NO FLOOD
```

### Why This Rule?

| Scenario | Precip_3h | Soil | Decision | Reason |
|----------|-----------|------|----------|--------|
| Heavy rain, dry soil | 35 mm | 0.2 | **FLOOD** | Threshold 1: precip ≥ 30 mm |
| Moderate rain, saturated soil | 25 mm | 0.4 | **FLOOD** | Threshold 2: precip ≥ 20 AND soil ≥ 0.35 |
| Light rain, dry soil | 5 mm | 0.2 | NO FLOOD | Neither threshold met |
| No rain, wet soil | 0 mm | 0.6 | NO FLOOD | Neither threshold met |

### Class Imbalance Statistics:

```
Flood events:     6,500 (0.11% of data)
Non-flood events: 5.8M (99.89% of data)

Ratio: 1 : 893

Challenge: Model could achieve 99.89% accuracy
          by predicting "always no flood"
          → Need special loss functions
          → Need balanced sampling
          → Need PR-AUC metric (not accuracy)
```

---

## LSTM Architecture

### Why LSTM for Time Series?

```
Traditional RNN:
  h_t = tanh(W[x_t, h_{t-1}])
  
Problem: Vanishing gradient
  - Gradient shrinks exponentially over 24 timesteps
  - Model forgets information from early timesteps
  
Solution: LSTM (Long Short-Term Memory)
  - Cell state flows through all timesteps unchanged
  - Gates control what to remember & forget
  - Solves vanishing gradient problem
```

### LSTM Cell Mechanics:

```
┌─────────────────────────────────────────┐
│         LSTM CELL (Simplified)          │
├─────────────────────────────────────────┤
│                                         │
│  Input: x_t (current feature)           │
│  Prior: h_{t-1} (previous hidden state) │
│         c_{t-1} (previous cell state)   │
│                                         │
│  1. Forget gate: f_t = σ(W_f·[x_t,h])   │
│     ↓ How much cell state to discard?   │
│                                         │
│  2. Input gate: i_t = σ(W_i·[x_t,h])    │
│     ↓ How much new info to add?         │
│                                         │
│  3. Cell update: c̃_t = tanh(W_c·[x_t,h])│
│     ↓ What new information?             │
│                                         │
│  4. Cell state: c_t = f_t⊙c̃ + i_t⊙c̃_t  │
│     ↓ Update cell (multiplicative)      │
│                                         │
│  5. Output gate: o_t = σ(W_o·[x_t,h])   │
│     ↓ What to expose as hidden state?   │
│                                         │
│  6. Hidden state: h_t = o_t ⊙ tanh(c_t) │
│     ↓ Output to next layer              │
│                                         │
└─────────────────────────────────────────┘

Key: Cell state c_t flows from t=1 to t=24
     without multiplication, only addition
     → No vanishing gradient!
```

### Full FloodLSTM Architecture:

```
INPUT: (batch_size=256, seq_len=24, input_dim=13)

LAYER 1: LSTM (input_size=13, hidden_size=128, num_layers=1)
  ├─ Processes 24 timesteps
  ├─ Learns local temporal patterns
  ├─ Output: (256, 24, 128)  [each timestep → 128 features]

LAYER 2: LSTM (input_size=128, hidden_size=128, num_layers=1)
  ├─ Processes output from Layer 1
  ├─ Learns global context patterns
  ├─ Output: (256, 24, 128)

TAKE LAST HIDDEN STATE:
  ├─ h_n from Layer 2 at t=24
  ├─ Shape: (256, 128)
  ├─ Rationale: Contains aggregate info about all 24 hours

DROPOUT: (p=0.3)
  ├─ Drop 30% of activations (training only)
  ├─ Regularization to prevent overfitting
  ├─ Output: (256, 128)

LINEAR HEAD: (in_features=128, out_features=1)
  ├─ Learned parameters:
  │  - Weight matrix: (1, 128)
  │  - Bias: scalar
  ├─ Computation: logit = X @ W^T + b
  ├─ Output: (256, 1)

SIGMOID ACTIVATION: σ(x) = 1 / (1 + e^-x)
  ├─ Converts logit to probability [0, 1]
  ├─ Output: (256, 1) ∈ [0, 1]

OUTPUT: Batch of 256 probabilities
```

### Why This Architecture?

```
Layer 1 (128 hidden):
  ✓ Learns local temporal patterns over 24 hours
  ✓ Detects short-term rainfall spikes
  ✓ Captures soil moisture trends

Layer 2 (128 hidden):
  ✓ Learns global context from Layer 1 abstractions
  ✓ Detects compound patterns
  ✓ Integrates information across full window

Linear head:
  ✓ Simple 128→1 transformation
  ✓ Computes weighted combination of LSTM features
  ✓ Interpretable: Which LSTM features predict floods?

Sigmoid:
  ✓ Converts logit to probability [0, 1]
  ✓ Matches binary classification objective
  ✓ Enables threshold-based decisions
```

---

## Loss Functions & Training

### Two Models, Two Different Losses:

| Model | Loss | Formula | Why? |
|-------|------|---------|------|
| **best.pt** (nowcast) | Weighted BCE | -[y·log(p) + (1-y)·log(1-p)] × weight | Simpler, class weights |
| **forecast_24h.pt** (forecast) | Focal Loss | α(1-p)^γ·BCE | Focuses on hard examples |

### Weighted Binary Cross-Entropy (best.pt):

```
Standard BCE Loss:
  BCE = -[y·log(p) + (1-y)·log(1-p)]
  
  y=1 (actual flood):     -log(p)          [penalize low prob]
  y=0 (actual no-flood):  -log(1-p)        [penalize high prob]

Problem with imbalance:
  Dataset: 1 flood : 893 non-floods
  
  Naive model predicts all 0 (no flood):
    Loss = -893·log(1) - 1·log(0.01) ≈ 4.6
    (Mostly correct, but useless)

Solution: Weighted BCE
  Loss = -[y·log(p)·W_pos + (1-y)·log(1-p)·W_neg]
  
  pos_weight = 200
  neg_weight = 1
  
  y=1 (flood):     -log(p) × 200  [heavily penalize missing floods]
  y=0 (no-flood):  -log(1-p) × 1  [normal penalty]
  
  Now model learns: "Floods are 200x important"
```

### Focal Loss (forecast_24h.pt):

```
Focal Loss:
  FL(p_t) = -α(1-p_t)^γ · log(p_t)
  
  where:
    α = 0.5 (balance parameter)
    γ = 2.0 (focusing parameter)
    p_t = probability of true class

Mechanism:
  - If p_t ≈ 1.0 (model confident & correct):
    (1-p_t) ≈ 0 → FL ≈ 0  [ignore easy examples]
    
  - If p_t ≈ 0.5 (model uncertain):
    (1-p_t) ≈ 0.5 → FL ≈ higher  [focus on hard examples]
    
  - If p_t ≈ 0 (model confident but wrong):
    (1-p_t) ≈ 1 → FL ≈ very high  [heavily penalize]

Effect of γ=2:
  - Increases suppression of easy examples
  - More focus on misclassifications & uncertain cases
  - Better performance on imbalanced data
```

### Training Strategy:

```
CONFIGURATION (from config.yaml):
  model:
    hidden_size: 128
    lstm_layers: 2
    dropout: 0.3
  
  train:
    epochs: 30
    batch_size: 256
    lr: 0.001
    optimizer: AdamW
    scheduler: CosineAnnealingLR
    grad_clip: 1.0
  
  early_stopping:
    patience: 15
    metric: PR-AUC
  
  loss:
    name: "focal" (for forecast) / "bce" (for nowcast)
    pos_weight: 200 (for bce)

TRAINING LOOP:
  For epoch in 1..30:
    loss = 0
    
    for batch in DataLoader:
      # WeightedRandomSampler ensures 50/50 flood ratio
      predictions = model(batch_x)  # shape: (256, 1)
      
      loss = focal_loss(predictions, batch_y)  # scalar
      
      loss.backward()  # Compute gradients via BPTT
      
      torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
      
      optimizer.step()  # Adam update
      scheduler.step()  # Cosine annealing
      
      loss += loss.item()
    
    # Validate on test set
    test_metrics = evaluate(test_set)
    
    # Track best PR-AUC
    if test_metrics['pr_auc'] > best_pr_auc:
      best_pr_auc = test_metrics['pr_auc']
      torch.save(checkpoint)  # Save model
      patience_counter = 0
    else:
      patience_counter += 1
    
    # Early stopping
    if patience_counter >= 15:
      break

RESULT:
  Stopped at epoch 7/30
  Best PR-AUC: 0.9597
  No overfitting (improving metrics → stopped early)
```

---

## Evaluation & Metrics

### Why PR-AUC for Imbalanced Data?

```
ACCURACY (misleading for imbalance):
  
  Model: Always predict 0 (no flood)
  Accuracy = 5.8M / 5.8M = 99.89%
  
  Seems excellent! But...
    - Never catches any floods
    - Useless for real-world protection
    
  ✗ Accuracy is NOT the right metric

F1-SCORE (too simplistic):
  F1 = 2 × (Precision × Recall) / (Precision + Recall)
  
  Better than accuracy, but...
    - Doesn't capture full curve of precision/recall tradeoff
    - Single number hides behavior at different thresholds

PRECISION-RECALL AUC (perfect for imbalance):
  
  Plot precision vs recall at 200 different thresholds
  Calculate area under curve
  Range: [0, 1]
  
  Why better:
    ✓ Shows full precision-recall tradeoff
    ✓ Accounts for imbalance naturally
    ✓ Values both catching floods (recall) & valid alerts (precision)
    ✓ Single metric that's hard to game
```

### All Six Metrics (forecast_24h.pt):

| Metric | Value | Interpretation |
|--------|-------|-----------------|
| **PR-AUC** | 0.9597 | 96% precision-recall balance |
| **ROC-AUC** | 1.0000 | Perfect discrimination (p=1) vs p=0 |
| **F1-Score** | 0.8906 | 89% balanced performance |
| **Precision** | 0.8686 | 87% of alerts are true positives |
| **Recall** | 0.9138 | 91% of actual floods are caught |
| **Test Loss** | 0.0868 | Focal loss very low |

### Metric Interpretations:

```
PRECISION = TP / (TP + FP)
  = "Of all alerts issued, how many are correct?"
  = 0.8686 = 87% of warnings are valid
  
  High precision:
    ✓ People trust the warnings
    ✗ Might miss some floods (low recall)

RECALL = TP / (TP + FN)
  = "Of all actual floods, how many are caught?"
  = 0.9138 = 91% of floods are detected
  
  High recall:
    ✓ Don't miss floods
    ✗ Might have false alarms (low precision)

PR-AUC SUMMARY:
  ✓ High precision (87%)
  ✓ High recall (91%)
  ✓ Both conditions met = excellent model
```

### Precision-Recall Curve:

```
Precision
    1.0 │•                    ← Better (high P & R)
        │ •
  0.87 ├──•─────────────────  ← Operating point
        │   •
        │     •
  0.5  │       •
        │         •
        │           •
  0.0  └─────────────────────
        0   0.5   0.91   1.0   Recall
        
Area under curve = PR-AUC = 0.9597
(96.97% of curve area is above baseline)
```

---

## Threshold Optimization

### Why Not Use Default 0.5?

```
Default threshold = 0.5:
  prediction = 1 if p >= 0.5 else 0

Problem with imbalance:
  - Threshold 0.5 assumes equal class importance
  - With 1:893 ratio, 0.5 is too conservative
  - Would miss many floods (low recall)

Solution: Find F1-optimal threshold via grid search
```

### F1-Score Grid Search Algorithm:

```python
def find_optimal_threshold(predictions, labels):
    """
    Test 200 candidate thresholds
    Find which maximizes F1-score
    """
    
    # Generate 200 evenly-spaced candidates
    thresholds = np.linspace(
        start=probs.min(),    # ~0.001
        stop=probs.max(),     # ~0.999
        num=200
    )
    
    best_f1 = 0
    best_thr = 0.5
    
    for thr in thresholds:
        # Convert probabilities to binary predictions
        predictions = (probs >= thr).astype(int)
        
        # Compute F1-score for this threshold
        f1 = f1_score(labels, predictions)
        
        # Track best
        if f1 > best_f1:
            best_f1 = f1
            best_thr = thr
    
    return best_thr, best_f1

# Result:
optimal_threshold = 0.7276
optimal_f1 = 0.8906
```

### Threshold Comparison:

```
Threshold | Precision | Recall | F1-Score | Interpretation
----------|-----------|--------|----------|----------------
0.5       | 0.72      | 0.95   | 0.8214   | High recall, low precision
0.6       | 0.78      | 0.93   | 0.8496   | Better balance
0.7       | 0.85      | 0.92   | 0.8833   | Good balance
0.7276    | 0.8686    | 0.9138 | 0.8906   | ✓ BEST (F1 peak)
0.75      | 0.88      | 0.90   | 0.8899   | Slightly lower F1
0.8       | 0.92      | 0.84   | 0.8780   | High precision, low recall
0.9       | 0.95      | 0.60   | 0.7377   | Too high (too conservative)

Grid search finds: 0.7276 maximizes F1 on test set
```

### Why 0.7276 Works:

```
At threshold 0.7276:
  ✓ Precision = 87%  (most alerts are correct)
  ✓ Recall = 91%     (catch most floods)
  ✓ F1 = 0.8906      (optimal balance)
  
  Practical impact:
    - Out of 100 alerts: 87 are true floods, 13 are false alarms
    - Out of 100 actual floods: 91 are caught, 9 are missed
    - Best overall decision boundary
```

### Saved in Checkpoint:

```python
checkpoint = {
    'model_state_dict': ...,
    'config': ...,
    'epoch': 7,
    'metrics': {...},
    'optimal_threshold': 0.7276  # ← Used at inference
}

# At inference time:
prob = model(window)  # e.g., 0.78
if prob >= 0.7276:    # Compare to optimal threshold
    alert = True
else:
    alert = False
```

---

## Model Comparison: Nowcast vs Forecast

### Side-by-Side Comparison:

| Aspect | Nowcast (best.pt) | Forecast (forecast_24h.pt) |
|--------|-------------------|---------------------------|
| **Purpose** | Current flood risk | 24-hour ahead risk |
| **Data Used** | Past 96 hours | Past 96h + Future 24h |
| **Loss Function** | Weighted BCE (pos_weight=200) | Focal Loss (γ=2, α=0.5) |
| **Training Samples** | 3.68M (all train data) | Subset with future labels |
| **Best Epoch** | 23/30 | 7/30 (early stopped) |
| **PR-AUC** | 0.9923 | 0.9597 |
| **ROC-AUC** | 0.9999 | 1.0000 |
| **F1-Score** | 0.9456 | 0.8906 |
| **Precision** | 0.9234 | 0.8686 |
| **Recall** | 0.9689 | 0.9138 |
| **Threshold** | 0.5123 | 0.7276 |
| **Use Case** | Real-time monitoring | Advance warning |

### Why Two Models?

```
NOWCAST (best.pt):
  ✓ Highest accuracy (PR-AUC=0.9923)
  ✓ Maximum recall (catch 97% of floods)
  ✓ Real-time: uses only past data
  ✓ For: Current situation assessment
  
  Use: "Is it flooding NOW?"

FORECAST (forecast_24h.pt):
  ✓ Forward-looking (24h ahead)
  ✓ Allows preparation time
  ✓ Uses NWP forecast data
  ✓ Slight lower accuracy (PR-AUC=0.9597)
  
  Use: "Will it flood in next 24 hours?"
        → Time for evacuation/sandbags/alerts
```

### Decision Tree:

```
Query arrives: lat=28.7, lon=77.1

    Should I predict NOW or FORECAST?
    
    If user asks: "Is it flooding right now?"
        → Use /predict endpoint (best.pt)
        → Nowcast model
        → Response: prob + current alert
    
    If user asks: "Will it flood tomorrow?"
        → Use /forecast endpoint (forecast_24h.pt)
        → Forecast model
        → Response: max prob in next 24h + peak time
```

---

## Inference Pipeline

### Complete Request-Response Flow:

```
REQUEST:
  GET /forecast?lat=28.7&lon=77.1

STEPS:
  1. FastAPI validates lat ∈ [-90,90], lon ∈ [-180,180]
  
  2. Load model (from cache or disk):
     - first request: Load from models/forecast_24h.pt (~50ms)
     - next requests: Use cached model (instant)
  
  3. Fetch weather data:
     - Archive API (past 96h): 96 rows
     - Forecast API (next 24h): 24 rows
     - Elevation API: 1 scalar
     Total: ~500-800ms (network latency)
  
  4. Feature engineering:
     6 raw variables → 13 engineered features
     Shape: (120, 13)
  
  5. Normalization:
     Apply saved StandardScaler (fitted on training data)
     μ=0, σ=1
  
  6. Sliding window loop (24 iterations):
     For i in 0..23:
       window_i = X_scaled[i-23:i+1]  # (24, 13)
       prob_i = model(window_i).item()  # scalar [0,1]
       Store (prob_i, timestamp_i)
  
  7. Peak detection:
     max_prob = max(all 24 probabilities)
     peak_time = timestamp at max_prob
  
  8. Threshold application:
     if max_prob >= 0.7276:
       alert_level = map_to_alert(max_prob)
     else:
       alert_level = "NONE"
  
  9. Build JSON response:
     {
       "latitude": 28.7,
       "longitude": 77.1,
       "flood_probability": max_prob,
       "alert_level": alert_level,
       "peak_time": peak_time,
       "confidence": confidence_score,
       ...
     }
  
  10. Return HTTP 200 OK

TOTAL LATENCY: ~500-1500ms
  - API calls: ~600ms
  - Feature engineering: ~50ms
  - LSTM inference: ~25ms
  - Other: ~50ms
```

---

## Key Terminology

### Quick Reference:

| Term | Definition | Example |
|------|-----------|---------|
| **LSTM** | Long Short-Term Memory RNN | Captures 24-hour weather patterns |
| **BPTT** | Backpropagation Through Time | Trains through 24 timesteps |
| **Sigmoid** | σ(x) = 1/(1+e^-x) | Converts logit to [0,1] probability |
| **Focal Loss** | FL = α(1-p)^γ·BCE | Focuses on hard examples in training |
| **PR-AUC** | Precision-Recall Area Under Curve | Best metric for imbalanced data |
| **F1-Score** | 2·(P·R)/(P+R) | Harmonic mean of precision & recall |
| **WeightedSampler** | Rebalances training batches | 50% floods, 50% non-floods per batch |
| **Threshold** | Decision boundary | p >= 0.7276 → Predict FLOOD |
| **Early Stopping** | Stop when metric plateaus | Avoid overfitting |
| **XGradient Clipping** | Limit gradient norm | Stabilize training |
| **Cosine Annealing** | Learning rate scheduler | Gradually reduce learning rate |
| **pos_weight** | Weight for positive class | Upweight floods by 200x |

### Common Acronyms:

- **LSTM** = Long Short-Term Memory
- **RNN** = Recurrent Neural Network
- **BPTT** = Backpropagation Through Time
- **BCE** = Binary Cross Entropy
- **AUROC** = Area Under Receiver Operating Characteristic
- **AUPRC** = Area Under Precision-Recall Curve
- **TP** = True Positive (correct flood detection)
- **FP** = False Positive (false alarm)
- **FN** = False Negative (missed flood)
- **TN** = True Negative (correct non-flood)

---

## Quick Reference Checklists

### System Components:

- [ ] **Data**: 5.8M rows, 45 cities, 16+ years
- [ ] **Features**: 6 raw → 13 engineered
- [ ] **Architecture**: 2-layer LSTM (128) + Linear + Sigmoid
- [ ] **Loss**: Weighted BCE (nowcast) / Focal Loss (forecast)
- [ ] **Training**: 30 epochs, batch_size=256, WeightedSampler
- [ ] **Threshold**: 0.7276 (F1-optimized)
- [ ] **Metrics**: PR-AUC, ROC-AUC, F1, Precision, Recall
- [ ] **Models**: best.pt (nowcast) + forecast_24h.pt (forecast)

### Key Numbers to Remember:

- **5.8M** rows of training data
- **13** engineered features
- **24** hours context window
- **128** hidden units per LSTM
- **2** LSTM layers
- **200** candidate thresholds in grid search
- **0.7276** optimal threshold
- **0.9597** PR-AUC (forecast model)
- **0.8906** F1-score
- **893** imbalance ratio (worst case)

### Before Inference, Always Check:

- [ ] Models loaded (best.pt + forecast_24h.pt)
- [ ] Scaler loaded (scaler.joblib)
- [ ] Coordinates validated (lat ∈ [-90,90], lon ∈ [-180,180])
- [ ] Weather APIs reachable
- [ ] Current threshold in checkpoint (0.7276)

---

## Revision Tips

1. **Understand the flow:** Data → Features → LSTM → Threshold → Alert
2. **Remember the imbalance:** 1 flood : 893 non-floods → Why Focal Loss + WeightedSampler
3. **Know the models:** Nowcast (current) vs Forecast (24h ahead)
4. **Metrics matter:** PR-AUC for imbalance, not Accuracy
5. **Threshold is key:** 0.7276 balances precision & recall
6. **LSTM handles time:** 24 hours context captures patterns
7. **Features encode physics:** Rain windows, soil lags, interactions
8. **Training is careful:** Early stopping, gradient clipping, balanced batches

---

## Additional Resources

- See `FORECAST_PIPELINE.md` for detailed inference pipeline
- See `SYSTEM_ARCHITECTURE.md` for full system design
- See `FEATURES.md` for feature descriptions
- See `IMPLEMENTATION.md` for code-level details

**Last Updated:** March 1, 2026
