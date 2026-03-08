"""criticality.py -- Calculates the AMBROSIA Criticality Index rating."""

import math
from typing import Dict, List, Tuple

def calculate_risk_score(
    population: int,
    rainfall_mm: float,
    land_cover: Dict[str, float],
    # For normalization (assuming typical max values for a district)
    max_pop: int = 5_000_000,
    max_rain: float = 1000.0,
) -> Tuple[int, str, List[str]]:
    """
    Calculate a 0-100 risk score and classification based on multiple factors.
    
    Formula:
    Score = 0.45 * PopRisk + 0.30 * RainRisk + 0.25 * UrbanRisk
    """
    factors = []
    
    # 1. Population Risk (0-100)
    # Log scale is better for population to not have mega-cities completely drown out others
    pop_risk = min(100.0, (math.log10(max(population, 1)) / math.log10(max_pop)) * 100)
    if pop_risk > 70:
        factors.append("High population density")
    
    # 2. Rainfall Risk (0-100)
    rain_risk = min(100.0, (rainfall_mm / max_rain) * 100)
    if rainfall_mm > 300:
        factors.append("Heavy recent rainfall")
        
    # 3. Urban/Land Cover Risk (0-100)
    # Highly urbanized areas have more impervious surfaces, increasing rapid flash flood risk
    urban_pct = land_cover.get("urban", 0) * 100
    water_pct = land_cover.get("water", 0) * 100
    
    urban_risk = min(100.0, urban_pct * 1.5)  # 66% urban = max risk
    if urban_pct > 30:
        factors.append("High urban density (impervious surfaces)")
    if water_pct > 20:
        factors.append("Proximity to major water bodies")
        
    # Weighted sum
    score = (0.45 * pop_risk) + (0.30 * rain_risk) + (0.25 * urban_risk)
    score_int = int(round(score))
    
    # Ensure min factors
    if not factors:
        factors.append("Standard baseline risk")
        
    # Classification
    if score_int >= 75:
        classification = "CRITICAL"
    elif score_int >= 50:
        classification = "HIGH"
    elif score_int >= 25:
        classification = "MODERATE"
    else:
        classification = "LOW"
        
    return score_int, classification, factors
