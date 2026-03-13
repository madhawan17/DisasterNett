"""criticality.py -- OmniFlood fused operational criticality scoring."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple


def _clamp(value: float, lower: float = 0.0, upper: float = 100.0) -> float:
    return max(lower, min(upper, value))


def _classify(score: int) -> str:
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MODERATE"
    return "LOW"


def _weighted_average(values: List[Tuple[Optional[float], float]]) -> float:
    usable = [(value, weight) for value, weight in values if value is not None and weight > 0]
    if not usable:
        return 0.0
    total_weight = sum(weight for _, weight in usable)
    return sum(value * weight for value, weight in usable) / total_weight


def _population_component(population: int, max_pop: int) -> Dict[str, Any]:
    pop_score = _clamp((math.log10(max(population, 1)) / math.log10(max_pop)) * 100)
    reasons: List[str] = []
    if pop_score >= 80:
        reasons.append("Very large exposed population")
    elif pop_score >= 60:
        reasons.append("Large exposed population")

    return {
        "key": "population_exposure",
        "label": "Population exposure",
        "score": round(pop_score, 2),
        "weight": 0.55,
        "value": population,
        "available": True,
        "reason": reasons[0] if reasons else "Population baseline within expected range",
        "details": {
            "population": population,
            "normalization_cap": max_pop,
        },
        "reasons": reasons,
    }


def _land_cover_component(land_cover: Dict[str, float]) -> Dict[str, Any]:
    urban_pct = float(land_cover.get("urban", 0.0)) * 100
    water_pct = float(land_cover.get("water", 0.0)) * 100
    crop_pct = float(land_cover.get("crop", 0.0)) * 100

    urban_risk = urban_pct * 1.35
    surface_water_risk = water_pct * 1.15
    cropland_risk = crop_pct * 0.35
    land_score = _clamp(urban_risk + surface_water_risk + cropland_risk)

    reasons: List[str] = []
    if urban_pct >= 35:
        reasons.append("High urban cover increases runoff")
    if water_pct >= 15:
        reasons.append("Nearby water or wetlands increase flood sensitivity")
    if crop_pct >= 40:
        reasons.append("Extensive cropland may increase standing-water exposure")

    return {
        "key": "land_cover_urbanization",
        "label": "Land cover and urbanization",
        "score": round(land_score, 2),
        "weight": 0.30,
        "value": {
            "urban_pct": round(urban_pct, 2),
            "water_pct": round(water_pct, 2),
            "crop_pct": round(crop_pct, 2),
        },
        "available": True,
        "reason": reasons[0] if reasons else "Land cover baseline risk is limited",
        "details": {
            "urban_pct": round(urban_pct, 2),
            "water_pct": round(water_pct, 2),
            "crop_pct": round(crop_pct, 2),
        },
        "reasons": reasons,
    }


def _forecast_component(
    forecast_signal: Optional[Dict[str, Any]],
    rainfall_mm: float,
    max_rain: float,
) -> Dict[str, Any]:
    if forecast_signal and forecast_signal.get("available", True):
        overall_max_prob = float(forecast_signal.get("overall_max_prob", 0.0))
        daily_forecasts = forecast_signal.get("daily_forecasts", []) or []
        peak_day = int(forecast_signal.get("peak_day", 0) or 0)
        imminence_bonus = 100.0 if peak_day and peak_day <= 2 else 70.0 if peak_day and peak_day <= 5 else 40.0
        avg_prob = 0.0
        if daily_forecasts:
            avg_prob = sum(float(day.get("max_prob", 0.0)) for day in daily_forecasts[:5]) / min(len(daily_forecasts), 5)
        forecast_score = _clamp((overall_max_prob * 75.0) + (avg_prob * 15.0) + (imminence_bonus * 0.10))

        reasons: List[str] = []
        if overall_max_prob >= 0.75:
            reasons.append("Forecast model indicates high multi-day flood probability")
        elif overall_max_prob >= 0.5:
            reasons.append("Forecast model indicates elevated multi-day flood probability")
        if peak_day and peak_day <= 2:
            reasons.append("Forecast peak arrives within 48 hours")

        return {
            "key": "forecast_probability",
            "label": "Multi-day forecast",
            "score": round(forecast_score, 2),
            "weight": 0.45,
            "value": {
                "overall_max_prob": round(overall_max_prob, 4),
                "peak_day": peak_day,
                "peak_date": forecast_signal.get("peak_date"),
                "overall_alert_level": forecast_signal.get("overall_alert_level"),
            },
            "available": True,
            "reason": reasons[0] if reasons else "Forecast signal remains limited",
            "details": {
                "overall_max_prob": round(overall_max_prob, 4),
                "peak_day": peak_day,
                "peak_date": forecast_signal.get("peak_date"),
                "daily_forecasts": daily_forecasts[:5],
            },
            "reasons": reasons,
        }

    rainfall_score = _clamp((rainfall_mm / max_rain) * 100)
    reasons = ["Using recent rainfall as fallback forecast proxy"] if rainfall_mm > 0 else ["Forecast signal unavailable"]
    return {
        "key": "forecast_probability",
        "label": "Multi-day forecast",
        "score": round(rainfall_score * 0.6, 2),
        "weight": 0.25,
        "value": {
            "rainfall_mm_30d": round(rainfall_mm, 2),
            "fallback": True,
        },
        "available": False,
        "reason": reasons[0],
        "details": {
            "rainfall_mm_30d": round(rainfall_mm, 2),
            "fallback": True,
        },
        "reasons": reasons,
    }


def _detection_component(detection_signal: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not detection_signal or not detection_signal.get("available", False):
        return {
            "key": "current_flood_detection",
            "label": "Current SAR flood detection",
            "score": 0.0,
            "weight": 0.30,
            "value": None,
            "available": False,
            "reason": "No recent SAR detection available for this area",
            "details": detection_signal or {},
            "reasons": [],
        }

    flood_pct = float(detection_signal.get("flood_percentage", 0.0) or 0.0)
    confidence = float(detection_signal.get("confidence_avg", 0.0) or 0.0)
    overlap = float(detection_signal.get("bbox_overlap_ratio", 1.0) or 0.0)
    db_drop = abs(float(detection_signal.get("mean_db_drop", 0.0) or 0.0))
    detection_score = _clamp((flood_pct * 1.4) + (confidence * 28.0) + (db_drop * 8.0) + (overlap * 12.0))

    reasons: List[str] = []
    if flood_pct >= 15:
        reasons.append("SAR detection shows active inundation in the area")
    elif flood_pct >= 5:
        reasons.append("SAR detection indicates localized inundation")
    if confidence >= 0.7:
        reasons.append("Detection confidence is strong")

    return {
        "key": "current_flood_detection",
        "label": "Current SAR flood detection",
        "score": round(detection_score, 2),
        "weight": 0.30,
        "value": {
            "flood_percentage": round(flood_pct, 2),
            "confidence_avg": round(confidence, 3),
            "zones_count": int(detection_signal.get("zones_count", 0) or 0),
            "analysis_date": detection_signal.get("analysis_date"),
        },
        "available": True,
        "reason": reasons[0] if reasons else "SAR detection indicates limited active flooding",
        "details": {
            "flood_percentage": round(flood_pct, 2),
            "confidence_avg": round(confidence, 3),
            "zones_count": int(detection_signal.get("zones_count", 0) or 0),
            "population_exposed": int(detection_signal.get("population_exposed", 0) or 0),
            "bbox_overlap_ratio": round(overlap, 3),
            "analysis_date": detection_signal.get("analysis_date"),
        },
        "reasons": reasons,
    }


def _infrastructure_component(infrastructure_signal: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not infrastructure_signal:
        return {
            "key": "infrastructure_exposure",
            "label": "Infrastructure exposure",
            "score": None,
            "weight": 0.15,
            "value": None,
            "available": False,
            "reason": "No infrastructure exposure data supplied",
            "details": {},
            "reasons": [],
        }

    if infrastructure_signal.get("score_override") is not None:
        score = _clamp(float(infrastructure_signal["score_override"]))
    else:
        critical_assets = int(infrastructure_signal.get("critical_assets_exposed", 0) or 0)
        facilities_cut_off = int(infrastructure_signal.get("facilities_cut_off", 0) or 0)
        disruption = float(infrastructure_signal.get("road_access_disruption_index", 0.0) or 0.0)
        score = _clamp((critical_assets * 10.0) + (facilities_cut_off * 15.0) + (disruption * 40.0))

    reasons: List[str] = []
    if int(infrastructure_signal.get("critical_assets_exposed", 0) or 0) > 0:
        reasons.append("Critical infrastructure lies inside the exposed area")
    if int(infrastructure_signal.get("facilities_cut_off", 0) or 0) > 0:
        reasons.append("Some facilities may be cut off during flooding")

    return {
        "key": "infrastructure_exposure",
        "label": "Infrastructure exposure",
        "score": round(score, 2),
        "weight": 0.15,
        "value": {
            "critical_assets_exposed": int(infrastructure_signal.get("critical_assets_exposed", 0) or 0),
            "facilities_cut_off": int(infrastructure_signal.get("facilities_cut_off", 0) or 0),
            "road_access_disruption_index": infrastructure_signal.get("road_access_disruption_index"),
        },
        "available": True,
        "reason": reasons[0] if reasons else "Infrastructure exposure remains limited",
        "details": {
            "critical_assets_exposed": int(infrastructure_signal.get("critical_assets_exposed", 0) or 0),
            "facilities_cut_off": int(infrastructure_signal.get("facilities_cut_off", 0) or 0),
            "road_access_disruption_index": infrastructure_signal.get("road_access_disruption_index"),
            "score_override": infrastructure_signal.get("score_override"),
        },
        "reasons": reasons,
    }


def calculate_criticality_index(
    population: int,
    rainfall_mm: float,
    land_cover: Dict[str, float],
    detection_signal: Optional[Dict[str, Any]] = None,
    forecast_signal: Optional[Dict[str, Any]] = None,
    infrastructure_signal: Optional[Dict[str, Any]] = None,
    max_pop: int = 5_000_000,
    max_rain: float = 1000.0,
) -> Dict[str, Any]:
    """
    Build a first-pass OmniFlood Criticality Index.

    The output is intentionally structured so it can later support smaller
    administrative units without changing the factor schema.
    """
    population_component = _population_component(population, max_pop=max_pop)
    land_component = _land_cover_component(land_cover)
    forecast_component = _forecast_component(forecast_signal, rainfall_mm, max_rain=max_rain)
    detection_component = _detection_component(detection_signal)
    infrastructure_component = _infrastructure_component(infrastructure_signal)

    hazard_score = _weighted_average([
        (detection_component["score"], detection_component["weight"] if detection_component["available"] else 0.0),
        (forecast_component["score"], forecast_component["weight"]),
    ])
    exposure_score = _weighted_average([
        (population_component["score"], population_component["weight"]),
        (land_component["score"], land_component["weight"]),
        (infrastructure_component["score"], infrastructure_component["weight"] if infrastructure_component["available"] else 0.0),
    ])

    compounding_bonus = ((hazard_score / 100.0) * (exposure_score / 100.0)) * 15.0
    score = _clamp((hazard_score * 0.58) + (exposure_score * 0.42) + compounding_bonus)
    score_int = int(round(score))
    classification = _classify(score_int)

    components = [
        detection_component,
        forecast_component,
        population_component,
        land_component,
    ]
    if infrastructure_component["score"] is not None:
        components.append(infrastructure_component)

    reasons: List[str] = []
    for component in sorted(components, key=lambda item: item["score"] or 0.0, reverse=True):
        for reason in component.get("reasons", []):
            if reason not in reasons:
                reasons.append(reason)
        if len(reasons) >= 4:
            break
    if not reasons:
        reasons.append("Baseline operational flood risk remains limited")

    return {
        "score": score_int,
        "classification": classification,
        "reasons": reasons,
        "factors": components,
        "component_scores": {
            "hazard": round(hazard_score, 2),
            "exposure": round(exposure_score, 2),
            "detection": round(float(detection_component["score"] or 0.0), 2),
            "forecast": round(float(forecast_component["score"] or 0.0), 2),
            "population": round(float(population_component["score"] or 0.0), 2),
            "land_cover": round(float(land_component["score"] or 0.0), 2),
            "infrastructure": round(float(infrastructure_component["score"] or 0.0), 2)
            if infrastructure_component["score"] is not None else None,
        },
        "signals": {
            "forecast": forecast_component["details"],
            "detection": detection_component["details"],
            "infrastructure": infrastructure_component["details"],
            "rainfall_mm_30d": round(rainfall_mm, 2),
        },
    }


def calculate_risk_score(
    population: int,
    rainfall_mm: float,
    land_cover: Dict[str, float],
    max_pop: int = 5_000_000,
    max_rain: float = 1000.0,
) -> Tuple[int, str, List[str]]:
    """
    Backwards-compatible wrapper for callers that still expect the legacy tuple.
    """
    result = calculate_criticality_index(
        population=population,
        rainfall_mm=rainfall_mm,
        land_cover=land_cover,
        max_pop=max_pop,
        max_rain=max_rain,
    )
    return result["score"], result["classification"], result["reasons"]
