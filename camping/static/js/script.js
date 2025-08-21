document.addEventListener('DOMContentLoaded', () => {
    // --- Removed userSelect element reference ---
    // const userSelect = document.getElementById('user-select');
    const userButtonsContainer = document.getElementById('user-buttons'); // Get user button group
    const preferenceButtonsContainer = document.getElementById('preference-buttons');
    const calendarContainer = document.getElementById('calendar-container');
    const messageArea = document.getElementById('message-area');

    let selectedUser = ''; // Initialize user
    let selectedPreference = ''; // Initialize preference

    // --- Removed userSelect event listener ---
    // userSelect.addEventListener('change', (event) => { ... });

    // --- New Event Listener for User Button Group ---
    if (userButtonsContainer) {
        userButtonsContainer.addEventListener('click', (event) => {
            // Check if a user button was clicked
            if (event.target.classList.contains('user-button')) {
                const clickedButton = event.target;
                const userName = clickedButton.dataset.user;

                // If already active, do nothing (or allow deselect)
                if (clickedButton.classList.contains('active')) {
                    return; // Currently prevents deselecting user
                }

                // Remove 'active' class from all user buttons
                userButtonsContainer.querySelectorAll('.user-button').forEach(button => {
                    button.classList.remove('active');
                });

                // Add 'active' class to the clicked button
                clickedButton.classList.add('active');

                // Update the selected user state
                selectedUser = userName;
                clearMessage(); // Clear message on user change
                console.log("Selected User:", selectedUser); // For debugging
            }
        });
    }
    // --- End New User Button Listener ---


    // --- Event Listener for Preference Button Group (Unchanged) ---
    if (preferenceButtonsContainer) {
        preferenceButtonsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('pref-button')) {
                const clickedButton = event.target;
                const preferenceValue = clickedButton.dataset.preference;

                if (clickedButton.classList.contains('active')) {
                    // Optional: Allow deselecting preference
                    // clickedButton.classList.remove('active');
                    // selectedPreference = '';
                    // clearMessage();
                    return; // Currently prevents deselecting
                }

                preferenceButtonsContainer.querySelectorAll('.pref-button').forEach(button => {
                    button.classList.remove('active');
                });
                clickedButton.classList.add('active');
                selectedPreference = preferenceValue;
                clearMessage();
                console.log("Selected Preference:", selectedPreference); // For debugging
            }
        });
    }
    // --- End Preference Button Listener ---


    // --- Calendar Click Listener (Validation part uses variables directly) ---
    calendarContainer.addEventListener('click', async (event) => {
        const dayElement = event.target.closest('.day:not(.empty)');

        if (dayElement) {
            const eventDate = dayElement.dataset.date;

            // Validate selection using state variables
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
                const response = await fetch('/api/preferences', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(dataToSend),
                });

                const result = await response.json();

                if (response.ok && result.status === 'success') {
                    showMessage(result.message || `Preference set for ${eventDate}`, 'success');
                    updateDayVisualState(dayElement, selectedUser, selectedPreference);
                } else {
                     let errorMsg = 'Failed to update preference.';
                     if (result && result.message) {
                         errorMsg = result.message;
                     } else if (!response.ok) {
                         errorMsg = `Error: ${response.status} - ${response.statusText}`;
                     }
                     showMessage(errorMsg, 'error');
                }

            } catch (error) {
                console.error('Error updating preference:', error);
                showMessage('A network or server error occurred. Please try again.', 'error');
            }
        }
    });
    // --- End Calendar Click Listener ---


    // --- Helper Functions (Unchanged, but check updateDayVisualState logic below) ---
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

            // CSS should handle Nick's text color now based on classes
            // .indicator.nick.prefer_not, .indicator.nick.no { color: #333; }
            // So, no specific JS style manipulation needed here ideally.
        }
        // Ensure indicators are ordered consistently if needed (more complex)
        // Example: sortIndicators(indicatorContainer);
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
         messageArea.className = 'message-area'; // Reset class to base
     }
     // --- End Helper Functions ---

});