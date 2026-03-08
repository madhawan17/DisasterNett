from __future__ import annotations

import numpy as np


def slope_from_dem_numpy(dem: np.ndarray, pixel_size_m: float = 10.0) -> np.ndarray:
    """Approximate terrain slope (degrees) from DEM using finite differences."""

    dz_dy, dz_dx = np.gradient(dem, pixel_size_m, pixel_size_m)
    slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    return np.degrees(slope_rad).astype(np.float32)

