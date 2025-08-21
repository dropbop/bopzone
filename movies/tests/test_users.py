import json

from tests.conftest import auth_headers


def test_register_login_and_list_users(client):
    # Register two users
    resp = client.post('/register', json={'user_name': 'alice', 'password': 'pwd'})
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'success'

    resp = client.post('/register', json={'user_name': 'bob', 'password': 'pwd'})
    assert resp.status_code == 200

    # Login with alice
    resp = client.post('/login', json={'user_name': 'alice', 'password': 'pwd'})
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'success'

    # List users should contain both
    resp = client.get('/api/users')
    assert resp.status_code == 200
    users = resp.get_json()
    assert 'alice' in users and 'bob' in users
