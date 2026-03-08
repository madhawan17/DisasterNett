import pytest
import numpy as np
from cca_segmentation import run_cca, classify_severity, _db_drop_to_depth

def test_severity_classification():
    assert classify_severity(12.0, 1.0) == "critical"
    assert classify_severity(2.0, 2.5) == "critical"
    assert classify_severity(6.0, 0.5) == "high"
    assert classify_severity(2.0, 0.5) == "medium"
    assert classify_severity(0.5, 0.1) == "low"

def test_db_drop_to_depth():
    assert _db_drop_to_depth(-10.0) == 3.0
    assert _db_drop_to_depth(10.0) == 3.0

def test_run_cca_basic():
    # 10x10 synthetic raster
    flood_mask = np.zeros((10, 10), dtype=bool)
    flood_mask[2:5, 2:5] = True  # A 3x3 square
    
    log_ratio = np.full((10, 10), -1.0)
    log_ratio[2:5, 2:5] = -5.0
    
    # 1km pixels => 9km2 total area
    transform = {
        "west": 0.0,
        "north": 10.0,
        "pixel_size_x": 0.01,
        "pixel_size_y": 0.01,
        "width": 10,
        "height": 10
    }
    
    patches = run_cca(flood_mask, log_ratio, transform, resolution=1000)
    
    assert len(patches) == 1
    patch = patches[0]
    assert patch["area_km2"] == 9.0
    assert patch["avg_depth_m"] == 1.5
    assert patch["severity"] == "high"
