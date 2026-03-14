"""criticality.py -- OmniFlood Disaster Intelligence Fusion Engine."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

FORECAST_WEIGHT = 0.40
DETECTION_WEIGHT = 0.30
POPULATION_WEIGHT = 0.20
INFRASTRUCTURE_WEIGHT = 0.10


def _clamp(value: float, lower: float = 0.0, upper: float = 100.0) -> float:
    return max(lower, min(upper, value))


def _classify(score: int) -> str:
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MEDIUM"
    return "LOW"


def _title_case_level(level: str) -> str:
    return level.capitalize().title()


def _population_component(
    population: int,
    area_km2: float,
    land_cover: Dict[str, float],
    max_density: int = 15000,
) -> Dict[str, Any]:
    density = population / max(area_km2, 0.1)
    density_score = _clamp((math.log10(max(density, 1.0)) / math.log10(max_density)) * 100.0)
    urban_pct = float(land_cover.get("urban", 0.0)) * 100.0
    population_score = _clamp((density_score * 0.75) + (urban_pct * 0.25))

    reasons: List[str] = []
    if density >= 8000:
        reasons.append("Area has high population density")
    elif density >= 4000:
        reasons.append("Area has elevated population density")
    if urban_pct >= 35:
        reasons.append("Urbanized land cover increases exposure")

    return {
        "key": "population_impact",
        "label": "Population impact",
        "score": round(population_score, 2),
        "weight": POPULATION_WEIGHT,
        "value": {
            "population": population,
            "population_density": round(density, 2),
            "urban_pct": round(urban_pct, 2),
        },
        "reason": reasons[0] if reasons else "Population exposure remains limited",
        "reasons": reasons,
        "details": {
            "population": population,
            "population_density": round(density, 2),
            "urban_pct": round(urban_pct, 2),
            "area_km2": round(area_km2, 2),
        },
    }


def _forecast_component(
    forecast_signal: Optional[Dict[str, Any]],
    rainfall_mm: float,
    max_rain: float,
) -> Dict[str, Any]:
    if forecast_signal and forecast_signal.get("available", True):
        probability = float(forecast_signal.get("overall_max_prob", 0.0) or 0.0)
        forecast_score = _clamp(probability * 100.0)
        peak_day = int(forecast_signal.get("peak_day", 0) or 0)

        reasons: List[str] = []
        if probability >= 0.8:
            reasons.append("Rainfall forecast extremely high")
        elif probability >= 0.6:
            reasons.append("Forecast engine signals high flood probability")
        elif probability >= 0.4:
            reasons.append("Forecast engine signals elevated flood probability")
        if peak_day and peak_day <= 2:
            reasons.append("Peak flood risk arrives within 48 hours")

        return {
            "key": "forecast_probability",
            "label": "Forecast engine",
            "score": round(forecast_score, 2),
            "weight": FORECAST_WEIGHT,
            "value": {
                "forecast_probability": round(probability, 4),
                "rainfall_last_24h": forecast_signal.get("rainfall_last_24h"),
                "rainfall_next_48h": forecast_signal.get("rainfall_next_48h"),
            },
            "reason": reasons[0] if reasons else "Forecast signal remains limited",
            "reasons": reasons,
            "details": {
                "forecast_probability": round(probability, 4),
                "peak_day": peak_day,
                "peak_date": forecast_signal.get("peak_date"),
                "daily_forecasts": forecast_signal.get("daily_forecasts", [])[:5],
                "overall_alert_level": forecast_signal.get("overall_alert_level"),
            },
        }

    fallback_score = _clamp((rainfall_mm / max_rain) * 100.0)
    return {
        "key": "forecast_probability",
        "label": "Forecast engine",
        "score": round(fallback_score, 2),
        "weight": FORECAST_WEIGHT,
        "value": {
            "forecast_probability": round(fallback_score / 100.0, 4),
            "rainfall_last_24h": None,
            "rainfall_next_48h": None,
            "fallback": True,
        },
        "reason": "Forecast unavailable, using rainfall proxy",
        "reasons": ["Forecast unavailable, using rainfall proxy"] if rainfall_mm > 0 else ["Forecast signal unavailable"],
        "details": {
            "rainfall_proxy_mm": round(rainfall_mm, 2),
            "fallback": True,
        },
    }


def _detection_component(detection_signal: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not detection_signal or not detection_signal.get("available", False):
        return {
            "key": "detected_flood",
            "label": "Satellite flood detection",
            "score": 0.0,
            "weight": DETECTION_WEIGHT,
            "value": {
                "flood_detected": False,
                "flood_area_km2": 0.0,
            },
            "reason": "No active flooding detected from SAR",
            "reasons": [],
            "details": detection_signal or {},
        }

    flood_pct = float(detection_signal.get("flood_percentage", 0.0) or 0.0)
    flood_area_km2 = float(detection_signal.get("flood_area_km2", 0.0) or 0.0)
    confidence = float(detection_signal.get("confidence_avg", 0.0) or 0.0)
    flood_detected = flood_pct >= 0.5 or flood_area_km2 >= 0.1
    extent_score = _clamp((flood_pct * 4.0) + (flood_area_km2 * 10.0))
    detection_score = _clamp((35.0 if flood_detected else 0.0) + (extent_score * 0.45) + (confidence * 20.0))

    reasons: List[str] = []
    if flood_detected:
        reasons.append("Satellite detected active flooding")
    if flood_area_km2 >= 2.0:
        reasons.append("Flood extent is already significant")
    if confidence >= 0.75:
        reasons.append("Detection confidence is strong")

    return {
        "key": "detected_flood",
        "label": "Satellite flood detection",
        "score": round(detection_score, 2),
        "weight": DETECTION_WEIGHT,
        "value": {
            "flood_detected": flood_detected,
            "flood_area_km2": round(flood_area_km2, 2),
        },
        "reason": reasons[0] if reasons else "Satellite sees only limited flooding",
        "reasons": reasons,
        "details": {
            "flood_detected": flood_detected,
            "flood_area_km2": round(flood_area_km2, 2),
            "flood_percentage": round(flood_pct, 2),
            "confidence_avg": round(confidence, 3),
            "analysis_date": detection_signal.get("analysis_date"),
            "zones_count": int(detection_signal.get("zones_count", 0) or 0),
        },
    }


def _infrastructure_component(infrastructure_signal: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not infrastructure_signal:
        return {
            "key": "infrastructure_risk",
            "label": "Infrastructure risk",
            "score": 0.0,
            "weight": INFRASTRUCTURE_WEIGHT,
            "value": {
                "critical_infrastructure": [],
                "critical_assets_exposed": 0,
                "facilities_cut_off": 0,
            },
            "reason": "No critical infrastructure exposure reported",
            "reasons": [],
            "details": {},
        }

    critical_assets = int(infrastructure_signal.get("critical_assets_exposed", 0) or 0)
    facilities_cut_off = int(infrastructure_signal.get("facilities_cut_off", 0) or 0)
    disruption = float(infrastructure_signal.get("road_access_disruption_index", 0.0) or 0.0)
    infra_types = list(infrastructure_signal.get("critical_infrastructure", []) or [])

    if infrastructure_signal.get("score_override") is not None:
        infrastructure_score = _clamp(float(infrastructure_signal["score_override"]))
    else:
        infrastructure_score = _clamp(
            (len(infra_types) * 15.0) +
            (critical_assets * 10.0) +
            (facilities_cut_off * 15.0) +
            (disruption * 25.0)
        )

    reasons: List[str] = []
    if infra_types:
        reasons.append(f"Critical infrastructure exposed: {', '.join(infra_types[:2])}")
    elif critical_assets > 0:
        reasons.append("Critical infrastructure assets are exposed")
    if facilities_cut_off > 0:
        reasons.append("Some critical facilities may be cut off")

    return {
        "key": "infrastructure_risk",
        "label": "Infrastructure risk",
        "score": round(infrastructure_score, 2),
        "weight": INFRASTRUCTURE_WEIGHT,
        "value": {
            "critical_infrastructure": infra_types,
            "critical_assets_exposed": critical_assets,
            "facilities_cut_off": facilities_cut_off,
        },
        "reason": reasons[0] if reasons else "Infrastructure exposure remains limited",
        "reasons": reasons,
        "details": {
            "critical_infrastructure": infra_types,
            "critical_assets_exposed": critical_assets,
            "facilities_cut_off": facilities_cut_off,
            "road_access_disruption_index": disruption,
        },
    }


def _build_alerts(level: str, infrastructure_component: Dict[str, Any]) -> List[str]:
    infra_types = infrastructure_component.get("details", {}).get("critical_infrastructure", []) or []

    if level == "CRITICAL":
        alerts = [
            "Immediate evacuation recommended",
            "Deploy rescue boats",
            "Alert nearby hospitals",
        ]
    elif level == "HIGH":
        alerts = [
            "Prepare evacuation shelters",
            "Deploy emergency crews",
            "Alert critical facilities",
        ]
    elif level == "MEDIUM":
        alerts = [
            "Issue flood watch",
            "Monitor low-lying roads",
            "Notify ward response teams",
        ]
    else:
        alerts = ["Continue monitoring conditions"]

    if "hospital" in infra_types and "Alert nearby hospitals" not in alerts:
        alerts.append("Alert nearby hospitals")

    return alerts[:3]


def _build_explanation(components: List[Tuple[Dict[str, Any], float]]) -> List[str]:
    explanations: List[str] = []
    for component, _ in sorted(components, key=lambda item: item[1], reverse=True):
        for reason in component.get("reasons", []):
            if reason not in explanations:
                explanations.append(reason)
            if len(explanations) >= 3:
                return explanations
    return explanations or ["No major flood drivers are active"]


def calculate_criticality_index(
    population: int,
    rainfall_mm: float,
    land_cover: Dict[str, float],
    area_km2: float = 1.0,
    detection_signal: Optional[Dict[str, Any]] = None,
    forecast_signal: Optional[Dict[str, Any]] = None,
    infrastructure_signal: Optional[Dict[str, Any]] = None,
    max_rain: float = 300.0,
) -> Dict[str, Any]:
    forecast_component = _forecast_component(forecast_signal, rainfall_mm, max_rain=max_rain)
    detection_component = _detection_component(detection_signal)
    population_component = _population_component(population, area_km2, land_cover)
    infrastructure_component = _infrastructure_component(infrastructure_signal)

    weighted_forecast = forecast_component["score"] * FORECAST_WEIGHT
    weighted_detection = detection_component["score"] * DETECTION_WEIGHT
    weighted_population = population_component["score"] * POPULATION_WEIGHT
    weighted_infrastructure = infrastructure_component["score"] * INFRASTRUCTURE_WEIGHT

    score = _clamp(weighted_forecast + weighted_detection + weighted_population + weighted_infrastructure)
    score_int = int(round(score))
    classification = _classify(score_int)
    risk_level = _title_case_level(classification)

    components = [
        forecast_component,
        detection_component,
        population_component,
        infrastructure_component,
    ]
    explanation = _build_explanation([
        (forecast_component, weighted_forecast),
        (detection_component, weighted_detection),
        (population_component, weighted_population),
        (infrastructure_component, weighted_infrastructure),
    ])
    alerts = _build_alerts(classification, infrastructure_component)

    return {
        "score": score_int,
        "classification": classification,
        "risk_level": risk_level,
        "alerts": alerts,
        "reasons": explanation,
        "explanation": explanation,
        "factors": components,
        "component_scores": {
            "forecast": round(forecast_component["score"], 2),
            "detection": round(detection_component["score"], 2),
            "population": round(population_component["score"], 2),
            "infrastructure": round(infrastructure_component["score"], 2),
        },
        "weighted_contributions": {
            "forecast": round(weighted_forecast, 2),
            "detection": round(weighted_detection, 2),
            "population": round(weighted_population, 2),
            "infrastructure": round(weighted_infrastructure, 2),
        },
        "signals": {
            "forecast": forecast_component["details"],
            "detection": detection_component["details"],
            "population": population_component["details"],
            "infrastructure": infrastructure_component["details"],
        },
    }


def calculate_risk_score(
    population: int,
    rainfall_mm: float,
    land_cover: Dict[str, float],
    max_pop: int = 5_000_000,
    max_rain: float = 300.0,
) -> Tuple[int, str, List[str]]:
    del max_pop
    result = calculate_criticality_index(
        population=population,
        rainfall_mm=rainfall_mm,
        land_cover=land_cover,
        max_rain=max_rain,
    )
    return result["score"], result["classification"], result["reasons"]
