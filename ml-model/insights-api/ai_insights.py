"""ai_insights.py -- Generate AI-powered flood event narratives via Groq LLM."""

import os
import logging
from typing import Any, Dict, Optional

from groq import Groq
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("insights.ai")

_client: Optional[Groq] = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.getenv("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set")
        _client = Groq(api_key=api_key)
    return _client


def generate_flood_insight(
    location: str,
    analysis_date: str,
    flood_area_km2: float,
    flood_percentage: float,
    population_exposed: int,
    zones_count: int,
    mean_db_drop: float,
    patches_summary: str,
) -> str:
    """Generate an AI narrative about the flood event.

    Parameters
    ----------
    location : Region name (e.g., "Kerala, India")
    analysis_date : ISO date string
    flood_area_km2 : Total flooded area
    flood_percentage : % of AOI flooded
    population_exposed : Estimated people in flood zones
    zones_count : Number of distinct flood patches
    mean_db_drop : Average SAR backscatter change (dB)
    patches_summary : Brief text summary of top patches

    Returns
    -------
    Formatted narrative text for the frontend AI Insight Panel
    """
    prompt = f"""You are an expert disaster analysis AI for the AMBROSIA flood intelligence platform.
Analyze the following satellite-derived flood detection results and write a concise, actionable narrative.

FLOOD DETECTION RESULTS:
- Location: {location}
- Analysis Date: {analysis_date}
- Total Flood Area: {flood_area_km2:.2f} km²
- Flood Coverage: {flood_percentage:.1f}% of analyzed region
- Population Exposed: {population_exposed:,}
- Distinct Flood Zones: {zones_count}
- Mean SAR Signal Drop: {mean_db_drop:.1f} dB
- Top Patches: {patches_summary}

Write your analysis in this format:

**Situation Overview**
[2-3 sentences about the overall flood situation, severity, and scale]

**Key Findings**
[3-4 bullet points highlighting the most critical observations]

**Risk Assessment**
[2-3 sentences assessing the risk to population and infrastructure]

**Recommended Actions**
[3-4 bullet points with specific actionable recommendations]

Keep the tone professional and urgent where appropriate. Use specific numbers from the data.
Do NOT hallucinate data — only reference values provided above."""

    try:
        client = _get_client()
        response = client.chat.completions.create(
            model="llama-3.1-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a disaster intelligence analyst. Provide concise, data-driven flood analysis narratives.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=800,
        )
        insight = response.choices[0].message.content
        log.info("Generated AI insight (%d chars)", len(insight))
        return insight

    except Exception as e:
        log.error("Groq AI insight generation failed: %s", e)
        # Return a fallback structured insight
        return _fallback_insight(
            location, analysis_date, flood_area_km2,
            flood_percentage, population_exposed, zones_count,
        )


def _fallback_insight(
    location: str,
    analysis_date: str,
    flood_area_km2: float,
    flood_percentage: float,
    population_exposed: int,
    zones_count: int,
) -> str:
    """Generate a basic insight without LLM when Groq is unavailable."""
    severity = "severe" if flood_area_km2 > 50 else "moderate" if flood_area_km2 > 10 else "minor"

    return f"""**Situation Overview**
SAR change detection analysis for {location} on {analysis_date} has identified {severity} flooding. \
A total of {flood_area_km2:.2f} km² ({flood_percentage:.1f}% of the analyzed region) shows flood indicators \
across {zones_count} distinct flood zones.

**Key Findings**
- Total flooded area: {flood_area_km2:.2f} km²
- Estimated population exposed: {population_exposed:,}
- Number of distinct flood zones: {zones_count}
- Flood coverage: {flood_percentage:.1f}% of the analyzed area

**Risk Assessment**
An estimated {population_exposed:,} people are within detected flood zones. \
{"Immediate evacuation support and emergency response is recommended." if flood_area_km2 > 50 else "Monitoring and preparedness measures are advised."}

**Recommended Actions**
- Monitor water levels in affected areas
- Coordinate with local emergency services for {"evacuation" if flood_area_km2 > 50 else "preparedness"}
- Assess infrastructure damage in high-severity zones
- Plan relief distribution to affected population centers"""
