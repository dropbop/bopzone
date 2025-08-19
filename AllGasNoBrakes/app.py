from flask import Flask, render_template, send_from_directory, request, abort, redirect, url_for
import os

# Define environment detection
IS_DEVELOPMENT = os.environ.get('FLASK_ENV') == 'development'

app = Flask(__name__)

@app.after_request
def add_security_headers(response):
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response

# 404 error handler - redirect to home page
@app.errorhandler(404)
def page_not_found(e):
    # Log the error in development mode
    if IS_DEVELOPMENT:
        app.logger.error(f"404 error: {request.path}")
    
    # Redirect to the index page
    return redirect(url_for('index'))

@app.route('/')
def index():
    photo_dir = os.path.join(app.static_folder, 'photos')
    photos = [f for f in os.listdir(photo_dir) if f.endswith(('.jpg', '.jpeg', '.png', '.webp'))]
    photos.sort()
    
    # Get Web3Forms key from environment variable
    web3forms_key = os.environ.get('WEB3FORMS_KEY', '')
    
    return render_template('index.html', photos=photos, web3forms_key=web3forms_key)

@app.route('/view/<filename>')
def view_image(filename):
    return render_template('view_image.html', filename=filename)

@app.route('/photos/<filename>')
def get_photo(filename):
    return send_from_directory(os.path.join(app.static_folder, 'photos'), filename)

# Debug route to check environment variables - only available in development
@app.route('/debug')
def debug():
    # Return 404 in production to hide this route
    if not IS_DEVELOPMENT:
        abort(404)
    
    # Get Web3Forms key from environment variable
    web3forms_key = os.environ.get('WEB3FORMS_KEY', '')
    
    # Only show the first 5 characters in development for security
    if web3forms_key:
        masked_key = web3forms_key[:5] + '***' if len(web3forms_key) > 5 else '***'
    else:
        masked_key = ''
    
    # Check if a form on the page has the access_key filled in
    access_key_in_form = request.args.get('access_key', '')
    
    # Get all environment variables (for debugging only)
    env_vars = {}
    for key, value in os.environ.items():
        # Skip sensitive environment variables 
        if not key.lower().startswith(('secret_', 'api_', 'password', 'token', 'key')):
            env_vars[key] = value
        # For sensitive keys, only show the first few characters
        elif key.lower() == 'web3forms_key' and value:
            env_vars[key] = value[:5] + '***' if len(value) > 5 else '***'
    
    return render_template('debug.html', 
                          web3forms_key=masked_key,
                          access_key_in_form=access_key_in_form,
                          env_vars=env_vars)

# This is needed for Vercel
app.config['STATIC_FOLDER'] = 'static'

# For local development only
if __name__ == "__main__":
    app.run(debug=IS_DEVELOPMENT)