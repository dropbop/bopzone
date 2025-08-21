
def test_database_status_and_init(client):
    resp = client.get('/database-status')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['status'] in ['connected', 'ok', 'success', 'connected']

    resp = client.get('/init-movie-database')
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'success'
