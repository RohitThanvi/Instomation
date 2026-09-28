import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("CLERK_JWKS_URL", "https://clerk.test/.well-known/jwks.json")
os.environ.setdefault("CLERK_ISSUER", "https://clerk.test")
