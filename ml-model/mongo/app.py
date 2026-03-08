"""Main FastAPI application for HackX backend."""

import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mongo.routes import router as auth_router
from mongo.client import db, ensure_indexes

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="HackX Backend",
    description="MongoDB + OAuth authentication service",
    version="1.0.0",
)

# Configure CORS
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/auth", tags=["auth"])


@app.on_event("startup")
def startup():
    """Run MongoDB index creation after app is loaded (non-blocking)."""
    ensure_indexes()


@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "message": "HackX backend is running"}


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "HackX API", "docs": "/docs"}
