"""image_export.py -- Generate SAR imagery and upload to Cloudinary CDN."""

import io
import os
import logging
from typing import Optional

import numpy as np
from PIL import Image
import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("insights.image")

# ---------------------------------------------------------------------------
# Cloudinary configuration
# ---------------------------------------------------------------------------

_cloudinary_configured = False


def _ensure_cloudinary():
    global _cloudinary_configured
    if _cloudinary_configured:
        return
    cloudinary.config(
        cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME", ""),
        api_key=os.getenv("CLOUDINARY_API_KEY", ""),
        api_secret=os.getenv("CLOUDINARY_API_SECRET", ""),
        secure=True,
    )
    _cloudinary_configured = True


# ---------------------------------------------------------------------------
# SAR change-detection image generation
# ---------------------------------------------------------------------------

def create_sar_change_image(
    sigma_pre: np.ndarray,
    sigma_post: np.ndarray,
    flood_mask: np.ndarray,
) -> bytes:
    """Create an RGB PNG image showing SAR change detection.

    Color scheme:
    - RED: flooded areas (where flood_mask is True)
    - GRAY: normal areas (pre-event backscatter)
    - BLUE: water bodies that were already present

    Returns PNG bytes.
    """
    h, w = sigma_pre.shape[:2]

    # Normalize backscatter values to 0-255
    def normalize(arr):
        arr = arr.astype(np.float32)
        vmin, vmax = np.percentile(arr[np.isfinite(arr)], [2, 98]) if np.any(np.isfinite(arr)) else (0, 1)
        if vmax == vmin:
            vmax = vmin + 1
        normalized = np.clip((arr - vmin) / (vmax - vmin), 0, 1)
        return (normalized * 255).astype(np.uint8)

    pre_norm = normalize(sigma_pre)
    post_norm = normalize(sigma_post)

    # Build RGB image
    r = np.copy(post_norm)
    g = np.copy(pre_norm)
    b = np.copy(pre_norm)

    # Highlight flood pixels in bright red
    flood = flood_mask.astype(bool)
    r[flood] = 255
    g[flood] = 50
    b[flood] = 50

    # Stack into RGB
    rgb = np.stack([r, g, b], axis=-1)

    # Convert to PIL Image
    img = Image.fromarray(rgb, "RGB")

    # Resize to reasonable dimensions (max 1200px wide)
    max_width = 1200
    if w > max_width:
        ratio = max_width / w
        new_h = int(h * ratio)
        img = img.resize((max_width, new_h), Image.LANCZOS)

    # Save to bytes
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# Upload to Cloudinary
# ---------------------------------------------------------------------------

def upload_to_cloudinary(
    image_bytes: bytes,
    public_id: str,
) -> Optional[str]:
    """Upload PNG bytes to Cloudinary and return the public URL.

    Parameters
    ----------
    image_bytes : Raw PNG bytes
    public_id : Unique identifier for the image (e.g., "sar_run_uuid")

    Returns
    -------
    HTTPS URL of the uploaded image, or None on failure
    """
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    api_key = os.getenv("CLOUDINARY_API_KEY", "")
    api_secret = os.getenv("CLOUDINARY_API_SECRET", "")

    if not cloud_name or not api_key or not api_secret:
        log.warning(
            "Cloudinary credentials not fully configured (CLOUDINARY_CLOUD_NAME=%s). "
            "Skipping image upload — will use GEE thumbnail fallback.",
            cloud_name or "<empty>",
        )
        return None

    _ensure_cloudinary()

    try:
        result = cloudinary.uploader.upload(
            image_bytes,
            public_id=f"ambrosia/sar/{public_id}",
            resource_type="image",
            overwrite=True,
        )
        url = result.get("secure_url", result.get("url"))
        log.info("Uploaded SAR image to Cloudinary: %s", url)
        return url
    except Exception as e:
        log.warning("Cloudinary upload failed: %s — will use GEE thumbnail fallback.", e)
        return None


# ---------------------------------------------------------------------------
# Combined: generate + upload
# ---------------------------------------------------------------------------

def generate_and_upload_sar_image(
    sigma_pre: np.ndarray,
    sigma_post: np.ndarray,
    flood_mask: np.ndarray,
    run_id: str,
) -> Optional[str]:
    """Create SAR change image and upload to Cloudinary.

    Returns the public URL or None.
    """
    try:
        png_bytes = create_sar_change_image(sigma_pre, sigma_post, flood_mask)
        url = upload_to_cloudinary(png_bytes, run_id)
        return url
    except Exception as e:
        log.error("SAR image generation/upload failed: %s", e)
        return None
