document.addEventListener('DOMContentLoaded', () => {
    const usersDiv = document.getElementById('users');
    const moviesDiv = document.getElementById('movies');
    const addUserBtn = document.getElementById('admin-add-user');
    const rescaleBtn = document.getElementById('rescale-elo-btn');
    let authHeader = null;
    let currentUser = null;

    async function ensureAdmin() {
        if (authHeader) return true;
        const user = prompt('Admin username:');
        const pass = prompt('Admin password:');
        if (!user || !pass) return false;
        authHeader = { 'Authorization': 'Basic ' + btoa(`${user}:${pass}`) };
        const resp = await fetch('/admin/api/users', { headers: authHeader });
        if (!resp.ok) {
            alert('Invalid admin credentials');
            authHeader = null;
            return false;
        }
        return true;
    }

    async function loadUsers() {
        if (!await ensureAdmin()) return;
        const resp = await fetch('/admin/api/users', { headers: authHeader });
        const users = await resp.json();
        usersDiv.innerHTML = '';
        moviesDiv.innerHTML = '';
        users.forEach(u => {
            const row = document.createElement('div');
            row.textContent = u;
            row.className = 'admin-user';
            row.addEventListener('click', () => { currentUser = u; loadMovies(); });

            const del = document.createElement('button');
            del.textContent = 'Delete';
            del.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Delete user and all movies?')) return;
                const r = await fetch('/admin/api/users/' + encodeURIComponent(u), {
                    method: 'DELETE',
                    headers: authHeader
                });
                if (r.ok) loadUsers();
            });
            const pwd = document.createElement('button');
            pwd.textContent = 'Change Password';
            pwd.addEventListener('click', async (e) => {
                e.stopPropagation();
                const np = prompt('New password for ' + u + ':');
                if (!np) return;
                await fetch('/admin/api/users/' + encodeURIComponent(u), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...authHeader },
                    body: JSON.stringify({ password: np })
                });
            });
            row.appendChild(del);
            row.appendChild(pwd);
            usersDiv.appendChild(row);
        });
    }

    async function loadMovies() {
        if (!currentUser) return;
        const resp = await fetch(`/api/movies?user=${encodeURIComponent(currentUser)}`);
        const movies = await resp.json();
        moviesDiv.innerHTML = `<h3>Movies for ${currentUser}</h3>`;
        movies.forEach(m => {
            const row = document.createElement('div');
            row.className = 'admin-movie';
            const title = document.createElement('input');
            title.value = m.movie_title;
            const select = document.createElement('select');
            ['thumbs_down','okay','thumbs_up'].forEach(opt => {
                const o = document.createElement('option');
                o.value = opt; o.textContent = opt; if (m.initial_rating === opt) o.selected = true;
                select.appendChild(o);
            });
            const save = document.createElement('button');
            save.textContent = 'Save';
            save.addEventListener('click', async () => {
                await fetch('/admin/api/movies/' + m.id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...authHeader },
                    body: JSON.stringify({ movie_title: title.value, initial_rating: select.value })
                });
                loadMovies();
            });
            row.appendChild(title);
            row.appendChild(select);
            row.appendChild(save);
            moviesDiv.appendChild(row);
        });
    }

    if (addUserBtn) {
        addUserBtn.addEventListener('click', async () => {
            if (!await ensureAdmin()) return;
            const name = prompt('Enter new user name:');
            if (!name || !name.trim()) return;
            const pwd = prompt('Enter password:');
            if (!pwd) return;
            const resp = await fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_name: name.trim(), password: pwd })
            });
            if (!resp.ok) {
                const data = await resp.json();
                alert(data.error || 'Failed to register user');
                return;
            }
            loadUsers();
        });
    }

    if (rescaleBtn) {
        rescaleBtn.addEventListener('click', async () => {
            if (!await ensureAdmin()) return;
            if (!confirm('Rescale all Elo ratings?')) return;
            const resp = await fetch('/admin/api/rescale_elos', {
                method: 'POST',
                headers: authHeader
            });
            if (resp.ok) {
                alert('Elo ratings recalculated');
                loadMovies();
            } else {
                const data = await resp.json().catch(() => ({}));
                alert(data.error || 'Failed to rescale elos');
            }
        });
    }

    loadUsers();
});
