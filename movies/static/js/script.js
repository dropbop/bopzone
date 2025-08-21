document.addEventListener('DOMContentLoaded', () => {
    // State management
    let currentUser = 'Jack';
    let currentFilter = 'all';
    let comparisonQueue = [];
    let newMovie = null;
    let userPasswords = JSON.parse(sessionStorage.getItem('userPasswords') || '{}');
    
    // DOM elements
    const userButtons = document.getElementById('user-buttons');
    const movieTitleInput = document.getElementById('movie-title');
    const ratingButtons = document.querySelectorAll('.rating-btn');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const movieList = document.getElementById('movie-list');
    const messageArea = document.getElementById('message-area');
    const comparisonModal = document.getElementById('comparison-modal');
    const movieABtn = document.getElementById('movie-a');
    const movieBBtn = document.getElementById('movie-b');
    const equalBtn = document.getElementById('equal-btn');

    async function ensureLoggedIn(user) {
        if (userPasswords[user]) return true;
        const pwd = prompt(`Enter password for ${user}:`);
        if (!pwd) {
            showMessage('Password required', 'error');
            return false;
        }
        const resp = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_name: user, password: pwd })
        });
        if (!resp.ok) {
            showMessage('Login failed', 'error');
            return false;
        }
        userPasswords[user] = pwd;
        sessionStorage.setItem('userPasswords', JSON.stringify(userPasswords));
        return true;
    }

    function authHeaders(user) {
        const pwd = userPasswords[user];
        if (!pwd) return {};
        return { 'Authorization': 'Basic ' + btoa(`${user}:${pwd}`) };
    }

    async function populateUsers() {
        try {
            const resp = await fetch('/api/users');
            const users = await resp.json();
            userButtons.innerHTML = '';
            users.forEach((u, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'user-button';
                btn.dataset.user = u;
                btn.textContent = u;
                if ((currentUser === u) || (!currentUser && idx === 0)) {
                    btn.classList.add('active');
                    currentUser = u;
                }
                userButtons.appendChild(btn);
            });
            if (!users.includes(currentUser) && users.length > 0) {
                currentUser = users[0];
                userButtons.firstChild.classList.add('active');
            }
            loadUserMovies();
        } catch (err) {
            console.error('Failed to load users', err);
            if (!userButtons.querySelector('.user-button')) {
                ['Jack'].forEach((name, idx) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'user-button';
                    btn.dataset.user = name;
                    btn.textContent = name;
                    if (idx === 0) btn.classList.add('active');
                    userButtons.appendChild(btn);
                });
                currentUser = 'Jack';
                loadUserMovies();
            }
        }
    }
    
    // Fetch and display users on load
    populateUsers();
    
    // User selection
    userButtons.addEventListener('click', (e) => {
        if (e.target.classList.contains('user-button')) {
            userButtons.querySelectorAll('.user-button').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            currentUser = e.target.dataset.user;
            loadUserMovies();
        }
    });

    // Rating buttons
    ratingButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const title = movieTitleInput.value.trim();
            if (!title) {
                showMessage('Please enter a movie title', 'error');
                return;
            }
            
            const rating = btn.dataset.rating;
            await addMovie(title, rating);
        });
    });
    
    // Filter buttons
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            loadUserMovies();
        });
    });
    
    // Comparison modal buttons
    movieABtn.addEventListener('click', () => handleComparison('a'));
    movieBBtn.addEventListener('click', () => handleComparison('b'));
    equalBtn.addEventListener('click', () => handleComparison('equal'));
    
    // Add movie function
    async function addMovie(title, initialRating) {
        try {
            if (!await ensureLoggedIn(currentUser)) return;
            showMessage('Adding movie...', 'info');
            
            // First, create the movie with initial rating
            const response = await fetch('/api/movies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders(currentUser) },
                body: JSON.stringify({
                    user_name: currentUser,
                    movie_title: title,
                    initial_rating: initialRating
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.message || 'Failed to add movie');
            }
            
            newMovie = result.movie;
            
            // Get movies in the same category for comparison
            const categoryMovies = await getMoviesInCategory(initialRating);
            
            if (categoryMovies.length > 0) {
                // Start binary comparison
                startBinaryComparison(categoryMovies);
            } else {
                // No movies to compare, we're done
                showMessage('Movie added successfully!', 'success');
                movieTitleInput.value = '';
                loadUserMovies();
            }
            
        } catch (error) {
            showMessage(error.message, 'error');
        }
    }
    
    // Get movies in a specific category
    async function getMoviesInCategory(category) {
        const response = await fetch(`/api/movies?user=${currentUser}&category=${category}`);
        const movies = await response.json();
        return movies.filter(m => m.id !== newMovie.id);
    }
    
    // Binary comparison algorithm
    function startBinaryComparison(movies) {
        // Sort movies by current ELO
        movies.sort((a, b) => b.elo_rating - a.elo_rating);
        
        // Initialize binary search
        let low = 0;
        let high = movies.length - 1;
        let mid = Math.floor((low + high) / 2);
        
        comparisonQueue = [{
            movies: movies,
            low: low,
            high: high,
            mid: mid,
            compareTo: movies[mid]
        }];
        
        showNextComparison();
    }
    
    function showNextComparison() {
        if (comparisonQueue.length === 0) {
            // Comparisons complete
            finishRanking();
            return;
        }
        
        const current = comparisonQueue[0];
        movieABtn.textContent = newMovie.movie_title;
        movieBBtn.textContent = current.compareTo.movie_title;
        comparisonModal.classList.remove('hidden');
    }
    
    async function handleComparison(choice) {
        const current = comparisonQueue.shift();

        try {
            const response = await fetch('/api/compare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    movie_a_id: newMovie.id,
                    movie_b_id: current.compareTo.id,
                    result: choice
                })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Comparison failed');
            }

            // Update local ELOs with server response
            newMovie.elo_rating = data.movie_a_rating;
            current.compareTo.elo_rating = data.movie_b_rating;

        } catch (err) {
            showMessage(err.message, 'error');
        }

        if (choice === 'a') {
            current.low = current.mid + 1;
        } else if (choice === 'b') {
            current.high = current.mid - 1;
        } else {
            current.low = current.high + 1; // End search
        }

        if (current.low <= current.high) {
            // Continue binary search
            current.mid = Math.floor((current.low + current.high) / 2);
            current.compareTo = current.movies[current.mid];
            comparisonQueue.unshift(current);
        }

        showNextComparison();
    }

    async function finishRanking() {
        comparisonModal.classList.add('hidden');
        showMessage('Movie ranked successfully!', 'success');
        movieTitleInput.value = '';
        loadUserMovies();
    }
    
    // Load user movies
    async function loadUserMovies() {
        try {
            const response = await fetch(`/api/movies?user=${currentUser}`);
            const movies = await response.json();
            
            // Filter movies
            let filteredMovies = movies;
            if (currentFilter !== 'all') {
                filteredMovies = movies.filter(m => m.initial_rating === currentFilter);
            }
            
            // Sort by ELO descending
            filteredMovies.sort((a, b) => b.elo_rating - a.elo_rating);
            
            // Display movies
            displayMovies(filteredMovies);
            
        } catch (error) {
            showMessage('Failed to load movies', 'error');
        }
    }
    
    function displayMovies(movies) {
        movieList.innerHTML = '';
        
        movies.forEach((movie, index) => {
            const movieEl = document.createElement('div');
            movieEl.className = 'movie-item';
            movieEl.innerHTML = `
                <div class="movie-rank">#${index + 1}</div>
                <div class="movie-info">
                    <div class="movie-title">${movie.movie_title}</div>
                    <div class="movie-meta">
                        <span class="movie-stars">${getStarRating(movie.elo_rating)}</span>
                        <span class="movie-elo">ELO: ${movie.elo_rating}</span>
                        <span class="movie-category">${getCategoryLabel(movie.initial_rating)}</span>
                    </div>
                </div>
                <button class="delete-btn" data-id="${movie.id}">×</button>
            `;
            
            movieEl.querySelector('.delete-btn').addEventListener('click', () => deleteMovie(movie.id));
            movieList.appendChild(movieEl);
        });
        
        if (movies.length === 0) {
            movieList.innerHTML = '<div class="no-movies">No movies yet. Add your first movie above!</div>';
        }
    }
    
    function getStarRating(elo) {
        // Convert ELO to star rating by dividing by 1000 and
        // truncating to one decimal place (e.g. 1919 -> 1.9)
        const truncated = Math.floor((elo / 1000) * 10) / 10;
        return truncated.toFixed(1) + ' stars';
    }

    function getCategoryLabel(category) {
        const labels = {
            'thumbs_up': 'Liked It',
            'okay': 'Okay',
            'thumbs_down': "Didn't Like It"
        };
        return labels[category] || '';
    }
    
    async function deleteMovie(movieId) {
        if (!confirm('Delete this movie?')) return;

        try {
            if (!await ensureLoggedIn(currentUser)) return;
            const response = await fetch(`/api/movies/${movieId}`, {
                method: 'DELETE',
                headers: { ...authHeaders(currentUser) }
            });
            
            if (response.ok) {
                showMessage('Movie deleted', 'success');
                loadUserMovies();
            }
        } catch (error) {
            showMessage('Failed to delete movie', 'error');
        }
    }
    
    function showMessage(message, type = 'info') {
        messageArea.textContent = message;
        messageArea.className = `message-area ${type}`;
        
        if (type === 'success' || type === 'error') {
            setTimeout(() => {
                messageArea.textContent = '';
                messageArea.className = 'message-area';
            }, 3000);
        }
    }
});
