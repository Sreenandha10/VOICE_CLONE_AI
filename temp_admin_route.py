
@app.route('/admin')
def admin_panel():
    if 'user' not in session:
        return redirect(url_for('login'))
    
    # Check if admin
    check_admin = "SELECT role FROM users WHERE id=%s"
    user_role = db.fetchone(check_admin, (session['user'],))
    if not user_role or user_role['role'] != 'admin':
        return "Access Denied", 403
        
    return render_template('admin.html')
