"""JWT and OAuth authentication logic."""

import os
import jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Token blacklist for logout (in production, use Redis)
token_blacklist = set()


def create_jwt_token(user_id, email, subscription_level, auth_provider):
    """Create a JWT token for authenticated users.

    Args:
        user_id: User MongoDB ObjectId
        email: User email
        subscription_level: User subscription level
        auth_provider: Authentication provider ("local" or "google")

    Returns:
        JWT token string
    """
    payload = {
        "user_id": str(user_id),
        "email": email,
        "subscription_level": subscription_level,
        "auth_provider": auth_provider,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
    }

    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token


def verify_jwt_token(token):
    """Verify and decode a JWT token.

    Args:
        token: JWT token string

    Returns:
        Decoded payload if valid, None otherwise
    """
    if token in token_blacklist:
        return None

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def blacklist_token(token):
    """Add token to blacklist (for logout).

    Args:
        token: JWT token string
    """
    token_blacklist.add(token)


def get_google_oauth_config():
    """Get Google OAuth configuration from environment.

    Returns:
        Dictionary with client_id, client_secret, redirect_uri
    """
    return {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "redirect_uri": os.getenv("GOOGLE_REDIRECT_URI", "https://your-domain.vercel.app/api/auth/google/callback"),
    }
