"""Seed test users into MongoDB."""

import os
import sys
from dotenv import load_dotenv

# Load .env variables
load_dotenv()

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from mongo.models import User
from mongo.client import users_collection

# Test users to seed
TEST_USERS = [
    {
        "email": "free@test.com",
        "password": "password123",
        "subscription_level": "free",
    },
    {
        "email": "pro@test.com",
        "password": "password123",
        "subscription_level": "pro",
    },
    {
        "email": "enterprise@test.com",
        "password": "password123",
        "subscription_level": "enterprise",
    },
]


def seed_users():
    """Seed test users into MongoDB."""

    # Clear existing test users
    for user_data in TEST_USERS:
        users_collection.delete_one({"email": user_data["email"]})

    print("🌱 Seeding test users...")

    for user_data in TEST_USERS:
        user = User.create_user(
            email=user_data["email"],
            password=user_data["password"],
            subscription_level=user_data["subscription_level"],
            auth_provider="local",
        )
        print(f"✓ Created user: {user['email']} ({user['subscription_level']})")

    print("\n✓ Seeding complete!")
    print("\nTest credentials:")
    for user_data in TEST_USERS:
        print(f"  - {user_data['email']} / {user_data['password']}")


if __name__ == "__main__":
    seed_users()
