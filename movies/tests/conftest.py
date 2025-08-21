import os
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
import base64
import pytest

from api.index import app
from api.db import init_movie_tables

@pytest.fixture(scope="function")
def client(postgresql):
    os.environ['DATABASE_URL'] = postgresql.dsn()
    init_movie_tables()
    app.testing = True
    with app.test_client() as client:
        yield client


def auth_headers(user, password):
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}
