// static/js/auth.js
// Client-side form validation for signup

document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signupForm');
    
    if (signupForm) {
        signupForm.addEventListener('submit', function(e) {
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm_password').value;
            const username = document.getElementById('username').value;
            const email = document.getElementById('email').value;
            
            // Check if all fields are filled
            if (!username || !email || !password || !confirmPassword) {
                e.preventDefault();
                showError('All fields are required!');
                return false;
            }
            
            // Check username length
            if (username.length < 3) {
                e.preventDefault();
                showError('Username must be at least 3 characters long!');
                return false;
            }
            
            // Check email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                e.preventDefault();
                showError('Please enter a valid email address!');
                return false;
            }
            
            // Check password length
            if (password.length < 6) {
                e.preventDefault();
                showError('Password must be at least 6 characters long!');
                return false;
            }
            
            // Check if passwords match
            if (password !== confirmPassword) {
                e.preventDefault();
                showError('Passwords do not match!');
                return false;
            }
        });
    }
});

function showError(message) {
    // Remove existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Create new error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `
        <span class="error-icon">⚠️</span>
        <span>${message}</span>
    `;
    
    // Insert after form header
    const authHeader = document.querySelector('.auth-header');
    authHeader.insertAdjacentElement('afterend', errorDiv);
    
    // Scroll to error
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}