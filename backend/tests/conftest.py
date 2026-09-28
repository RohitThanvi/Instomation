import os

from cryptography.fernet import Fernet

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("CLERK_JWKS_URL", "https://clerk.test/.well-known/jwks.json")
os.environ.setdefault("CLERK_ISSUER", "https://clerk.test")
os.environ.setdefault("FRONTEND_BASE_URL", "http://localhost:5173")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("META_APP_ID", "test-app-id")
os.environ.setdefault("META_APP_SECRET", "test-app-secret")
os.environ.setdefault("META_REDIRECT_URI", "http://localhost:8000/api/v1/instagram/oauth/callback")
