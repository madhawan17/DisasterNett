#!/usr/bin/env python
"""Standalone script to run the FastAPI backend."""

import os
import sys
import uvicorn
from pathlib import Path

# Load environment variables
from dotenv import load_dotenv

# Load .env from project root
project_root = Path(__file__).parent.parent
env_path = project_root / ".env"
load_dotenv(env_path)

if __name__ == "__main__":
    print("Starting HackX backend...")

    uvicorn.run(
        "mongo.app:app",
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
        port=int(os.getenv("FLASK_PORT", 5000)),
        reload=os.getenv("FLASK_ENV") == "development",
    )
