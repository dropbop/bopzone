// script.js
document.addEventListener('DOMContentLoaded', function() {
    // ================= CAROUSEL CODE =================
    const carousel = document.querySelector('.carousel');
    const imageGroups = document.querySelectorAll('.image-trio');
    let currentIndex = 0;
    const isMobile = window.innerWidth <= 768;
    let autoScrollInterval;
    let interactionTimeout;
    const autoScrollDelay = 5000;
    const resumeAutoScrollDelay = 10000;
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    // SOLUTION 4: Targeted preloading strategy
    function preloadVisibleAndAdjacentImages() {
        if (!carousel) return;
        
        // Get all image trios after the carousel is initialized
        const allTrios = carousel.querySelectorAll('.image-trio');
        if (!allTrios.length) return;
        
        // Calculate which trios to preload (current, next, and previous)
        // Add 1 because we prepend a clone to the carousel, so indices are shifted
        const visibleIndex = currentIndex;
        const nextIndex = (visibleIndex + 1) % allTrios.length;
        const prevIndex = (visibleIndex - 1 + allTrios.length) % allTrios.length;
        
        // Only target specific images to preload
        const priorityImages = [
            ...allTrios[visibleIndex].querySelectorAll('img'),
            ...allTrios[nextIndex].querySelectorAll('img'),
            ...allTrios[prevIndex].querySelectorAll('img')
        ];
        
        console.log(`Prioritizing preload for trio indices: ${visibleIndex}, ${nextIndex}, ${prevIndex}`);
        
        // Preload these priority images first
        priorityImages.forEach(img => {
            if (!img.dataset.preloaded) {
                const tempImage = new Image();
                tempImage.src = img.src;
                tempImage.loading = 'eager';
                
                tempImage.onload = () => {
                    img.dataset.preloaded = 'true';
                    console.log(`Priority preloaded: ${img.src}`);
                };
            }
        });
        
        // Then queue up the rest with lower priority
        setTimeout(() => {
            const remainingImages = [...carousel.querySelectorAll('img')].filter(
                img => !img.dataset.preloaded
            );
            
            remainingImages.forEach(img => {
                const tempImage = new Image();
                tempImage.src = img.src;
                tempImage.loading = 'lazy';
                
                tempImage.onload = () => {
                    img.dataset.preloaded = 'true';
                };
            });
        }, 1000); // Delay loading of non-priority images
    }

    function initCarousel() {
        if (!carousel || !imageGroups.length) return;
        
        carousel.innerHTML = ''; // Clear existing carousel
        currentIndex = 0;

        // Re-append image groups
        for (let group of imageGroups) {
            carousel.appendChild(group.cloneNode(true));
        }
        // Re-select image groups after clearing and cloning
        const currentImageGroups = document.querySelectorAll('.image-trio');

        // Clone first and last groups for smooth infinite scroll (do this AFTER re-appending)
        carousel.appendChild(currentImageGroups[0].cloneNode(true));
        carousel.insertBefore(currentImageGroups[currentImageGroups.length - 1].cloneNode(true), carousel.firstChild);

        // Add hardware acceleration hints
        carousel.style.willChange = 'transform';
        carousel.style.backfaceVisibility = 'hidden';
        carousel.style.webkitBackfaceVisibility = 'hidden';
        
        if (isMobile) {
            // Get carousel images and add hardware acceleration properties
            const carouselImages = carousel.querySelectorAll('.image-wrapper img');
            carouselImages.forEach(img => {
                img.setAttribute('loading', 'eager');
                img.style.backfaceVisibility = 'hidden';
                img.style.webkitBackfaceVisibility = 'hidden';
            });
        }
        
        // Adjust initial position
        currentIndex = 1;
        updateCarousel(false);
        
        // Preload visible and adjacent images after carousel is initialized
        preloadVisibleAndAdjacentImages();

        startAutoScroll(); // Start auto-scroll on initialization
    }

    // SOLUTION 3: Optimized carousel transition with translate3d
    function updateCarousel(animate = true) {
        if (!carousel) return;
        
        // Use translate3d instead of translateX for hardware acceleration
        const offset = currentIndex * -100;
        
        if (!animate) {
            carousel.style.transition = 'none';
        } else {
            // Simpler timing function for better performance
            carousel.style.transition = 'transform 0.5s ease-out';
        }
        
        // Force GPU acceleration with translate3d
        carousel.style.transform = `translate3d(${offset}%, 0, 0)`;
        
        if (!animate) {
            carousel.offsetHeight; // Force reflow
            carousel.style.transition = 'transform 0.5s ease-out';
        }
        
        // Preload images for the new position
        preloadVisibleAndAdjacentImages();
    }

    function nextTrio() {
        currentIndex++;
        updateCarousel();

        // If we're at the cloned last group, jump to real first group
        if (currentIndex === imageGroups.length + 1) {
            setTimeout(() => {
                currentIndex = 1;
                updateCarousel(false);
            }, 500); // Match the transition duration
        }
    }

    function prevTrio() {
        currentIndex--;
        updateCarousel();

        // If we're at the cloned first group, jump to real last group
        if (currentIndex === 0) {
            setTimeout(() => {
                currentIndex = imageGroups.length;
                updateCarousel(false);
            }, 500); // Match the transition duration
        }
    }

    function startAutoScroll() {
        if (!autoScrollInterval) {
            autoScrollInterval = setInterval(nextTrio, autoScrollDelay);
        }
    }

    function stopAutoScroll() {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }

    function resetAutoScrollTimer() {
        stopAutoScroll();
        clearTimeout(interactionTimeout);
        interactionTimeout = setTimeout(startAutoScroll, resumeAutoScrollDelay);
    }

    if (carousel) {
        // Initialize carousel if it exists
        if (prevButton && nextButton) {
            prevButton.addEventListener('click', () => {
                prevTrio();
                resetAutoScrollTimer();
            });

            nextButton.addEventListener('click', () => {
                nextTrio();
                resetAutoScrollTimer();
            });
        }

        // Improved touch handling with better performance
        let touchStartX = 0;
        let touchStartTime = 0;
        let isSwiping = false;
        
        carousel.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartTime = Date.now();
            isSwiping = true;
            
            // Pause animations during touch
            carousel.style.transition = 'none';
            
            // Signal we're handling this touch
            resetAutoScrollTimer();
        }, { passive: true });
        
        carousel.addEventListener('touchmove', e => {
            if (!isSwiping) return;
            
            // Calculate how far we've moved
            const touchCurrentX = e.changedTouches[0].screenX;
            const diff = touchCurrentX - touchStartX;
            
            // If significant drag, prevent default to avoid page scrolling
            if (Math.abs(diff) > 10) {
                e.preventDefault();
            }
            
            // Calculate percentage to move based on drag distance
            // Constrain movement to avoid overscrolling
            const percentMove = Math.max(Math.min(diff / window.innerWidth * 100, 50), -50);
            const offset = (currentIndex * -100) + percentMove;
            
            // Apply the transform directly
            carousel.style.transform = `translate3d(${offset}%, 0, 0)`;
        }, { passive: false });

        carousel.addEventListener('touchend', e => {
            if (!isSwiping) return;
            isSwiping = false;
            
            // Restore transitions
            carousel.style.transition = 'transform 0.5s ease-out';
            
            const touchEndX = e.changedTouches[0].screenX;
            const touchEndTime = Date.now();
            
            const diff = touchEndX - touchStartX;
            const timeDiff = touchEndTime - touchStartTime;
            
            // Detect swipe based on distance and speed
            // Fast short swipes count too
            const isSwipe = Math.abs(diff) > 50 || (Math.abs(diff) > 20 && timeDiff < 300);
            
            if (isSwipe) {
                if (diff < 0) nextTrio();
                else prevTrio();
            } else {
                // Snap back to current position if not a swipe
                updateCarousel();
            }
            
            resetAutoScrollTimer();
        }, { passive: true });

        // Make sure links in carousel work properly
        const imageLinks = document.querySelectorAll('.image-wrapper a');
        imageLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                // Only treat as a click if we're not in a swipe
                if (isSwiping) {
                    e.preventDefault();
                }
                // Don't intercept link clicks for navigation
                e.stopPropagation();
            });
        });

        // Initialize the carousel
        initCarousel();
        
        // Debounce the resize handler for better performance
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                initCarousel();
            }, 250);
        });
    }

    // ================= CONTACT FORM CODE =================
    const contactForm = document.getElementById('contactForm');
    const formResult = document.getElementById('formResult');
    
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault(); // Prevent the form from submitting normally
            
            // Show pending message
            if (formResult) {
                formResult.textContent = "Sending your message...";
                formResult.className = "form-result pending";
                formResult.style.display = "block";
            }
            
            // Get form data
            const formData = new FormData(contactForm);
            const object = Object.fromEntries(formData);
            
            // Check if access key is present and not empty
            const accessKey = object.access_key;
            if (!accessKey) {
                console.error("Web3Forms access key is missing or empty");
                if (formResult) {
                    formResult.textContent = "Configuration error: Missing API key. Please contact the site administrator.";
                    formResult.className = "form-result error";
                }
                return;
            }
            
            // Debug log
            console.log('Submitting form with payload:', object);
            const json = JSON.stringify(object);
            
            // Submit to Web3Forms API
            fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: json
            })
            .then(async (response) => {
                let json;
                try {
                    json = await response.json();
                    console.log('Web3Forms API response:', json);
                } catch (e) {
                    console.error('Failed to parse API response', e);
                    json = { message: "Failed to parse response" };
                }
                
                if (formResult) {
                    if (response.status == 200) {
                        formResult.textContent = "Message sent successfully!";
                        formResult.className = "form-result success";
                        contactForm.reset();
                    } else {
                        console.error('Error response:', response.status, json);
                        formResult.textContent = json.message || "Something went wrong!";
                        formResult.className = "form-result error";
                    }
                }
            })
            .catch(error => {
                console.error('Fetch error:', error);
                if (formResult) {
                    formResult.textContent = "Network error. Please try again.";
                    formResult.className = "form-result error";
                }
            })
            .finally(function() {
                if (formResult) {
                    // Hide the message after 5 seconds
                    setTimeout(() => {
                        formResult.style.display = "none";
                    }, 5000);
                }
            });
        });
    }
});