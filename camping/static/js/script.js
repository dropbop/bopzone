document.addEventListener('DOMContentLoaded', () => {
    // Prefix-aware API helper (works at /camping/* and locally)
    const APP_PREFIX = '/' + window.location.pathname.split('/')[1];
    const api = (p) => `${APP_PREFIX}/${p.replace(/^\/+/, '')}`;

    const userButtonsContainer = document.getElementById('user-buttons');
    const preferenceButtonsContainer = document.getElementById('preference-buttons');
    const calendarContainer = document.getElementById('calendar-container');
    const messageArea = document.getElementById('message-area');

    let selectedUser = '';
    let selectedPreference = '';

    if (userButtonsContainer) {
        userButtonsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('user-button')) {
                const clickedButton = event.target;
                const userName = clickedButton.dataset.user;
                if (clickedButton.classList.contains('active')) return;
                userButtonsContainer.querySelectorAll('.user-button').forEach(button => {
                    button.classList.remove('active');
                });
                clickedButton.classList.add('active');
                selectedUser = userName;
                clearMessage();
            }
        });
    }

    if (preferenceButtonsContainer) {
        preferenceButtonsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('pref-button')) {
                const clickedButton = event.target;
                const preferenceValue = clickedButton.dataset.preference;
                if (clickedButton.classList.contains('active')) return;
                preferenceButtonsContainer.querySelectorAll('.pref-button').forEach(button => {
                    button.classList.remove('active');
                });
                clickedButton.classList.add('active');
                selectedPreference = preferenceValue;
                clearMessage();
            }
        });
    }

    calendarContainer.addEventListener('click', async (event) => {
        const dayElement = event.target.closest('.day:not(.empty)');
        if (dayElement) {
            const eventDate = dayElement.dataset.date;
            if (!selectedUser) {
                showMessage('Please select your name first.', 'error');
                return;
            }
            if (!selectedPreference) {
                showMessage('Please select a preference (Prefer Not, No, or Clear).', 'error');
                return;
            }

            showMessage('Updating...', 'info');

            const dataToSend = {
                user_name: selectedUser,
                event_date: eventDate,
                preference_type: selectedPreference
            };

            try {
                const response = await fetch(api('api/preferences'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dataToSend),
                });

                const result = await response.json();

                if (response.ok && result.status === 'success') {
                    showMessage(result.message || `Preference set for ${eventDate}`, 'success');
                    updateDayVisualState(dayElement, selectedUser, selectedPreference);
                } else {
                    let errorMsg = result?.message || `Error: ${response.status} - ${response.statusText}`;
                    showMessage(errorMsg, 'error');
                }
            } catch (error) {
                console.error('Error updating preference:', error);
                showMessage('A network or server error occurred. Please try again.', 'error');
            }
        }
    });

    function updateDayVisualState(dayElement, userName, preferenceType) {
        const userKey = userName.toLowerCase();
        const indicatorContainer = dayElement.querySelector('.indicators');
        if (!indicatorContainer) {
            console.error("Could not find indicator container for day:", dayElement.dataset.date);
            return;
        }
        const existingIndicator = indicatorContainer.querySelector(`.indicator.${userKey}`);
        if (existingIndicator) {
            existingIndicator.remove();
        }
        if (preferenceType === 'clear') {
            delete dayElement.dataset[userKey];
        } else {
            dayElement.dataset[userKey] = preferenceType;
            const newIndicator = document.createElement('span');
            newIndicator.classList.add('indicator', userKey, preferenceType);
            newIndicator.textContent = userName[0];
            indicatorContainer.appendChild(newIndicator);
        }
    }

    function showMessage(message, type = 'info') {
        messageArea.textContent = message;
        messageArea.className = `message-area ${type}`;
        if (type === 'success' || type === 'error') {
            setTimeout(clearMessage, 4000);
        }
    }

    function clearMessage() {
        messageArea.textContent = '';
        messageArea.className = 'message-area';
    }
});
