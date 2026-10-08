import psycopg2
from pathlib import Path
import socket

schema_sql = Path("supabase/schema.sql").read_text(encoding="utf-8")

# Try to resolve db.kavuwirlqyrtupemcqnu.supabase.co
project_ref = "kavuwirlqyrtupemcqnu"
db_host = f"db.{project_ref}.supabase.co"

hosts_to_try = [
    {"host": db_host, "port": 5432, "user": "postgres"},
    {"host": "aws-0-ap-south-1.pooler.supabase.com", "port": 6543, "user": f"postgres.{project_ref}"},
    {"host": "aws-0-ap-south-1.pooler.supabase.com", "port": 5432, "user": f"postgres.{project_ref}"},
    {"host": "aws-0-us-east-1.pooler.supabase.com", "port": 6543, "user": f"postgres.{project_ref}"},
    {"host": "aws-0-us-east-2.pooler.supabase.com", "port": 6543, "user": f"postgres.{project_ref}"},
    {"host": "aws-0-eu-central-1.pooler.supabase.com", "port": 6543, "user": f"postgres.{project_ref}"},
]

connected = False
for h in hosts_to_try:
    host = h["host"]
    port = h["port"]
    user = h["user"]
    print(f"Connecting to {host}:{port} as {user}...")
    try:
        password = os.getenv("DB_PASSWORD", "")
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            dbname="postgres",
            connect_timeout=8,
            sslmode="require",
        )
        conn.autocommit = True
        print(f"Connected to {host}!")
        with conn.cursor() as cur:
            cur.execute(schema_sql)
            print("Successfully applied supabase/schema.sql!")
        conn.close()
        connected = True
        break
    except Exception as exc:
        print(f"Failed {host}:{port} -> {exc}")

if not connected:
    print("Could not connect to Supabase database directly.")
