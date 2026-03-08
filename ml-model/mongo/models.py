"""User model and database operations."""

import bcrypt
from datetime import datetime
from mongo.client import db

users_collection = db["users"]


class User:
    """User model for authentication."""

    @staticmethod
    def create_user(email, password=None, subscription_level="free", auth_provider="local"):
        """Create a new user document in MongoDB.

        Args:
            email: User email (unique)
            password: Plain text password (will be hashed)
            subscription_level: "free", "pro", or "enterprise"
            auth_provider: "local" or "google"

        Returns:
            Inserted user document with id
        """
        # Hash password if provided
        hashed_password = None
        if password:
            hashed_password = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

        user_doc = {
            "email": email,
            "password": hashed_password,
            "subscription_level": subscription_level,
            "auth_provider": auth_provider,
            "created_at": datetime.utcnow(),
        }

        result = users_collection.insert_one(user_doc)
        return users_collection.find_one({"_id": result.inserted_id})

    @staticmethod
    def find_by_email(email):
        """Find user by email.

        Args:
            email: User email

        Returns:
            User document or None
        """
        return users_collection.find_one({"email": email})

    @staticmethod
    def find_by_id(user_id):
        """Find user by MongoDB ObjectId.

        Args:
            user_id: User MongoDB ObjectId

        Returns:
            User document or None
        """
        from bson.objectid import ObjectId

        try:
            return users_collection.find_one({"_id": ObjectId(user_id)})
        except Exception:
            return None

    @staticmethod
    def verify_password(stored_hash, plain_password):
        """Verify a password against its bcrypt hash.

        Args:
            stored_hash: Bcrypt hash from database
            plain_password: Plain text password to verify

        Returns:
            True if password matches, False otherwise
        """
        return bcrypt.checkpw(plain_password.encode("utf-8"), stored_hash.encode("utf-8"))

    @staticmethod
    def user_to_dict(user_doc):
        """Convert MongoDB user document to JSON-serializable dict.

        Args:
            user_doc: User document from MongoDB

        Returns:
            Dictionary with user info (password excluded)
        """
        if not user_doc:
            return None

        return {
            "id": str(user_doc["_id"]),
            "email": user_doc["email"],
            "subscription_level": user_doc["subscription_level"],
            "auth_provider": user_doc["auth_provider"],
            "created_at": user_doc["created_at"].isoformat(),
        }
