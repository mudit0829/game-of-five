
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename

import random
import time
from datetime import datetime, timedelta
import threading
import os
import hashlib
import secrets
import json

# -------------------------------------------------
# FLASK + DB SETUP
# -------------------------------------------------
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here-change-this-in-production'
app.config['PROPAGATE_EXCEPTIONS'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# SQLite database file
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///game.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Uploads for help attachments
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

db = SQLAlchemy(app)

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='threading',
    ping_timeout=60,
    ping_interval=25
)

# -------------------------------------------------
# GAME CONFIGURATIONS
# -------------------------------------------------
GAME_CONFIGS = {
    'silver': {
        'bet_amount': 200,
        'payout': 1000,
        'name': 'Silver Game',
        'type': 'number',
        'title': 'Frog Leap',
        'emoji': '🐸'
    },
    'gold': {
        'bet_amount': 250,
        'payout': 1250,
        'name': 'Gold Game',
        'type': 'number',
        'title': 'Football Goal',
        'emoji': '⚽'
    },
    'diamond': {
        'bet_amount': 100,
        'payout': 500,
        'name': 'Diamond Game',
        'type': 'number',
        'title': 'Archer Hit',
        'emoji': '🏹'
    },
    'platinum': {
        'bet_amount': 1000,
        'payout': 5000,
        'name': 'Platinum Game',
        'type': 'number',
        'title': 'Parachute Drop',
        'emoji': '🪂'
    },
    'roulette': {
        'bet_amount': 200,
        'payout': 2000,
        'name': 'Roulette Game',
        'type': 'roulette',
        'title': 'Roulette Spin',
        'emoji': '🎡'
    }
}

# -------------------------------------------------
# DATABASE MODELS
# -------------------------------------------------
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(64), unique=True, index=True)  # external id used in game
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    display_name = db.Column(db.String(120))
    email = db.Column(db.String(120))
    country = db.Column(db.String(80))
    phone = db.Column(db.String(40))

    balance = db.Column(db.Integer, default=0)  # wallet balance in coins

    def __repr__(self):
        return f"<User {self.username} ({self.user_id})>"


class BetHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(64), index=True)   # matches User.user_id
    game_type = db.Column(db.String(20))
    round_code = db.Column(db.String(40))
    table_number = db.Column(db.Integer)
    bet_amount = db.Column(db.Integer)
    number = db.Column(db.Integer)
    bet_time = db.Column(db.DateTime, default=datetime.utcnow)

    is_resolved = db.Column(db.Boolean, default=False)
    winning_number = db.Column(db.Integer)
    win = db.Column(db.Boolean)
    status = db.Column(db.String(10))        # "win" / "lose"
    amount = db.Column(db.Integer)           # net +/- amount
    date_time = db.Column(db.DateTime)       # when result applied


class Complaint(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    complaint_id = db.Column(db.String(40), unique=True, index=True)
    user_id = db.Column(db.String(64), index=True)

    subject = db.Column(db.String(200))
    message = db.Column(db.Text)
    category = db.Column(db.String(50))
    status = db.Column(db.String(20), default='Open')

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_update = db.Column(db.DateTime, default=datetime.utcnow)

    attachment_name = db.Column(db.String(200))
    original_filename = db.Column(db.String(200))
    updates_json = db.Column(db.Text)  # JSON list of {time, text}


# -------------------------------------------------
# IN-MEMORY STRUCTURES (still used by game threads)
# -------------------------------------------------
game_tables = {}
user_wallets = {}        # {user_id: balance} – kept in sync with DB
users_db = {}            # {username: {...}}  – quick cache for login/profile
user_game_history = {}   # {user_id: [bet_dict, ...]} – used by existing APIs
user_complaints = {}     # {user_id: [complaint_dict, ...]} – for help page

# -------------------------------------------------
# AUTH HELPERS
# -------------------------------------------------
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(stored_hash, provided_password):
    return stored_hash == hash_password(provided_password)


def create_user(username, password, initial_balance=10000):
    """
    Create user in DB + in-memory dicts.
    Returns (success, user_id_or_message).
    """
    existing = User.query.filter_by(username=username).first()
    if existing:
        return False, "Username already exists"

    user_id = f"user_{secrets.token_hex(8)}"

    user = User(
        user_id=user_id,
        username=username,
        password_hash=hash_password(password),
        created_at=datetime.utcnow(),
        display_name=username,
        email='',
        country='',
        phone='',
        balance=initial_balance
    )
    db.session.add(user)
    db.session.commit()

    # mirror into in-memory structures
    users_db[username] = {
        'user_id': user.user_id,
        'username': user.username,
        'password_hash': user.password_hash,
        'created_at': user.created_at.isoformat(),
        'display_name': user.display_name,
        'email': user.email,
        'country': user.country,
        'phone': user.phone
    }
    user_wallets[user.user_id] = user.balance
    user_game_history[user.user_id] = []
    user_complaints[user.user_id] = []

    return True, user.user_id


def authenticate_user(username, password):
    """
    Use DB for auth but keep cache in users_db.
    """
    user = User.query.filter_by(username=username).first()
    if not user:
        return False, None
    if not verify_password(user.password_hash, password):
        return False, None
    # ensure cache is filled
    users_db[username] = {
        'user_id': user.user_id,
        'username': user.username,
        'password_hash': user.password_hash,
        'created_at': user.created_at.isoformat(),
        'display_name': user.display_name or user.username,
        'email': user.email or '',
        'country': user.country or '',
        'phone': user.phone or ''
    }
    user_wallets[user.user_id] = user.balance
    if user.user_id not in user_game_history:
        user_game_history[user.user_id] = []
    if user.user_id not in user_complaints:
        user_complaints[user.user_id] = []
    return True, user.user_id


def login_required(f):
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)

    return decorated_function


def find_user_by_id(user_id):
    """Look up user in DB, used by profile."""
    if not user_id:
        return None
    return User.query.filter_by(user_id=user_id).first()


# -------------------------------------------------
# GAME HELPERS & TABLE CLASS
# -------------------------------------------------
def generate_bot_name():
    prefixes = ['Amit', 'Sanjay', 'Riya', 'Kunal', 'Anita', 'Rohit', 'Meera', 'Neeraj']
    suffix = random.randint(100, 999)
    return f"{random.choice(prefixes)}{suffix}"


class GameTable:
    def __init__(self, game_type, table_number, initial_delay=0):
        self.game_type = game_type
        self.table_number = table_number
        self.round_code = self._make_round_code()
        self.config = GAME_CONFIGS[game_type]
        self.start_time = datetime.now() + timedelta(seconds=initial_delay)
        self.end_time = self.start_time + timedelta(minutes=5)
        self.betting_close_time = self.end_time - timedelta(seconds=15)
        self.bets = []
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False
        self.max_players = 6
        self.last_bot_added_at = None

    def _make_round_code(self):
        timestamp = int(time.time())
        return f"{self.game_type[0].upper()}{timestamp}{self.table_number}"

    def get_number_range(self):
        if self.game_type == 'roulette':
            return list(range(37))
        return list(range(10))

    def add_bet(self, user_id, username, number, is_bot=False):
        user_bets = [b for b in self.bets if b['user_id'] == user_id]
        if len(user_bets) >= 4:
            return False, "Maximum 4 bets per user"
        if len(self.bets) >= self.max_players:
            return False, "All slots are full"

        bet_obj = {
            'user_id': user_id,
            'username': username,
            'number': number,
            'is_bot': is_bot,
            'bet_amount': self.config['bet_amount'],
            'bet_time': datetime.now().isoformat()
        }
        self.bets.append(bet_obj)

        # ---------- LOG INTO USER HISTORY + DB (real users only) ----------
        if not is_bot:
            if user_id not in user_game_history:
                user_game_history[user_id] = []
            user_game_history[user_id].append({
                'game_type': self.game_type,
                'round_code': self.round_code,
                'bet_amount': self.config['bet_amount'],
                'number': number,
                'bet_time': datetime.now(),
                'table_number': self.table_number,
                'is_resolved': False  # pending
            })
            # DB history
            bh = BetHistory(
                user_id=user_id,
                game_type=self.game_type,
                round_code=self.round_code,
                table_number=self.table_number,
                bet_amount=self.config['bet_amount'],
                number=number,
                bet_time=datetime.utcnow(),
                is_resolved=False
            )
            db.session.add(bh)
            db.session.commit()

        return True, "Bet placed successfully"

    def add_bot_bet(self):
        if len(self.bets) >= self.max_players:
            return False
        all_numbers = self.get_number_range()
        bot_name = generate_bot_name()
        bot_number = random.choice(all_numbers)
        self.bets.append({
            'user_id': f'bot_{bot_name}',
            'username': bot_name,
            'number': bot_number,
            'is_bot': True,
            'bet_amount': self.config['bet_amount'],
            'bet_time': datetime.now().isoformat()
        })
        return True

    def calculate_result(self):
        real_user_bets = [b for b in self.bets if not b['is_bot']]
        if random.random() < 0.16 and real_user_bets:
            winning_bet = random.choice(real_user_bets)
            self.result = winning_bet['number']
        else:
            all_numbers = self.get_number_range()
            self.result = random.choice(all_numbers)
        return self.result

    def get_winners(self):
        if self.result is None:
            return []
        winners = []
        for bet in self.bets:
            if bet['number'] == self.result and not bet['is_bot']:
                winners.append({
                    'user_id': bet['user_id'],
                    'username': bet['username'],
                    'payout': self.config['payout']
                })
        return winners

    def get_time_remaining(self):
        now = datetime.now()
        if now < self.start_time:
            return int((self.end_time - self.start_time).total_seconds())
        if now >= self.end_time:
            return 0
        return int((self.end_time - now).total_seconds())

    def get_slots_available(self):
        return self.max_players - len(self.bets)

    def is_started(self):
        return datetime.now() >= self.start_time

    def to_dict(self):
        return {
            'table_number': self.table_number,
            'round_code': self.round_code,
            'game_type': self.game_type,
            'players': len(self.bets),
            'max_players': self.max_players,
            'slots_available': self.get_slots_available(),
            'time_remaining': self.get_time_remaining(),
            'is_betting_closed': self.is_betting_closed,
            'is_finished': self.is_finished,
            'is_started': self.is_started(),
            'bets': self.bets,
            'result': self.result
        }

# -------------------------------------------------
# TABLE SETUP & THREADING
# -------------------------------------------------
def initialize_game_tables():
    for game_type in GAME_CONFIGS.keys():
        game_tables[game_type] = []
        for i in range(6):
            initial_delay = i * 60
            table = GameTable(game_type, i + 1, initial_delay)
            game_tables[game_type].append(table)
        print(f"Initialized 6 tables for {game_type}")


def manage_game_table(table):
    # need app context to use db in this thread
    with app.app_context():
        while True:
            try:
                now = datetime.now()
                if now < table.start_time:
                    time.sleep(1)
                    continue

                if (
                    not table.is_betting_closed
                    and len(table.bets) < table.max_players
                    and table.get_time_remaining() > 30
                ):
                    if (
                        table.last_bot_added_at is None
                        or (now - table.last_bot_added_at).total_seconds() >= 15
                    ):
                        if table.add_bot_bet():
                            table.last_bot_added_at = now

                # Close betting
                if now >= table.betting_close_time and not table.is_betting_closed:
                    table.is_betting_closed = True
                    print(f"{table.game_type} Table {table.table_number}: Betting closed")

                # Finish game
                if now >= table.end_time and not table.is_finished:
                    table.is_finished = True
                    result = table.calculate_result()
                    winners = table.get_winners()
                    print(f"{table.game_type} Table {table.table_number}: Game ended. Winner: {result}")

                    # finalize history (in-memory + DB)
                    for bet in table.bets:
                        if bet.get('is_bot'):
                            continue
                        # in-memory history
                        for rec in user_game_history.get(bet['user_id'], []):
                            if (not rec.get('is_resolved') and
                                rec['game_type'] == table.game_type and
                                rec['round_code'] == table.round_code and
                                rec['number'] == bet['number']):
                                rec['winning_number'] = result
                                rec['win'] = (bet['number'] == result)
                                rec['status'] = "win" if bet['number'] == result else "lose"
                                rec['amount'] = table.config['payout'] if rec['win'] else -table.config['bet_amount']
                                rec['is_resolved'] = True
                                rec['date_time'] = now.strftime("%Y-%m-%d %H:%M")

                        # DB history
                        bh = BetHistory.query.filter_by(
                            user_id=bet['user_id'],
                            game_type=table.game_type,
                            round_code=table.round_code,
                            number=bet['number'],
                            is_resolved=False
                        ).first()
                        if bh:
                            bh.winning_number = result
                            bh.win = (bet['number'] == result)
                            bh.status = "win" if bh.win else "lose"
                            bh.amount = table.config['payout'] if bh.win else -table.config['bet_amount']
                            bh.is_resolved = True
                            bh.date_time = datetime.utcnow()
                            db.session.add(bh)

                    db.session.commit()

                    # pay winners in DB + memory
                    for winner in winners:
                        u = User.query.filter_by(user_id=winner['user_id']).first()
                        if u:
                            u.balance += winner['payout']
                            db.session.add(u)
                            user_wallets[winner['user_id']] = u.balance
                    db.session.commit()

                    # Restart round
                    time.sleep(3)
                    table.bets = []
                    table.result = None
                    table.is_betting_closed = False
                    table.is_finished = False
                    table.start_time = datetime.now()
                    table.end_time = table.start_time + timedelta(minutes=5)
                    table.betting_close_time = table.end_time - timedelta(seconds=15)
                    table.round_code = table._make_round_code()
                    table.last_bot_added_at = None
                    print(f"{table.game_type} Table {table.table_number}: New round started - {table.round_code}")

                time.sleep(1)
            except Exception as e:
                print(f"Error managing table {table.game_type} #{table.table_number}: {e}")
                time.sleep(1)


def start_all_game_tables():
    for game_type, tables in game_tables.items():
        for table in tables:
            threading.Thread(
                target=manage_game_table,
                args=(table,),
                daemon=True
            ).start()
    print("All game table threads started!")

# -------------------------------------------------
# API FOR TABLES
# -------------------------------------------------
@app.route('/api/tables/<game_type>')
def get_game_tables_api(game_type):
    if game_type not in GAME_CONFIGS:
        return jsonify({'error': 'Invalid game type'}), 404
    tables = game_tables.get(game_type, [])
    tables_data = [table.to_dict() for table in tables]
    return jsonify({
        'game_type': game_type,
        'tables': tables_data
    })


@app.route('/api/tables')
def get_all_tables():
    all_tables = {}
    for game_type, tables in game_tables.items():
        all_tables[game_type] = [table.to_dict() for table in tables]
    return jsonify(all_tables)

# -------------------------------------------------
# GAME HISTORY API (still using in-memory dict)
# -------------------------------------------------
@app.route('/api/user-games')
def user_games_history_api():
    user_id = request.args.get("user_id")
    user_bets = user_game_history.get(user_id, [])

    grouped = {}
    for b in user_bets:
        key = (b['game_type'], b['round_code'])
        if key not in grouped:
            grouped[key] = {
                'game_type': b['game_type'],
                'round_code': b['round_code'],
                'bet_amount': GAME_CONFIGS[b['game_type']]['bet_amount'],
                'user_bets': [],
                'winning_number': None,
                'date_time': "",
                'status': None,
                'amount': 0
            }
        grouped[key]['user_bets'].append(b['number'])
        if b.get("winning_number") is not None:
            grouped[key]['winning_number'] = b['winning_number']
            grouped[key]['status'] = b['status']
            if b['status'] == "win":
                grouped[key]['amount'] += GAME_CONFIGS[b['game_type']]['payout']
            else:
                grouped[key]['amount'] -= GAME_CONFIGS[b['game_type']]['bet_amount']
        if b.get("date_time"):
            grouped[key]['date_time'] = b.get("date_time", "")

    all_games = list(grouped.values())
    game_history = [g for g in all_games if g.get('status')]
    current_games = [g for g in all_games if not g.get('status')]
    return jsonify({"current_games": current_games, "game_history": game_history})

# -------------------------------------------------
# AUTH ROUTES
# -------------------------------------------------
@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('home'))
    return redirect(url_for('login_page'))


@app.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect(url_for('home'))
    return render_template('login.html')


@app.route('/login', methods=['POST'])
def login_post():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    remember_me = data.get('remember_me', False)

    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required'}), 400

    success, user_id = authenticate_user(username, password)
    if not success:
        return jsonify({'success': False, 'message': 'Invalid username or password'}), 401

    session['user_id'] = user_id
    session['username'] = username
    if remember_me:
        session.permanent = True

    token = secrets.token_urlsafe(32)
    return jsonify({
        'success': True,
        'user_id': user_id,
        'username': username,
        'token': token,
        'redirect': url_for('home')
    })


@app.route('/register', methods=['GET', 'POST'])
def register_page():
    """
    GET  -> show registration page (for real user accounts)
    POST -> two behaviours:
            - if 'user_id' present and no 'password' -> game JS wallet registration
            - else -> normal user registration (username + password)
    """
    if request.method == 'GET':
        if 'user_id' in session:
            return redirect(url_for('home'))
        return render_template('register.html')

    # POST
    data = request.get_json() or {}

    # Wallet register (from game JS)
    if data.get('user_id') and not data.get('password'):
        user_id = data.get("user_id")
        username = data.get("username", "Player")
        # ensure wallet + history structures exist; DB user is optional here
        if user_id not in user_wallets:
            user_wallets[user_id] = 10000
            user_game_history[user_id] = []
            user_complaints[user_id] = []
        return jsonify({'success': True, 'balance': user_wallets[user_id]})

    # Full user registration (from UI)
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required'}), 400
    if len(password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters'}), 400

    success, result = create_user(username, password)
    if not success:
        return jsonify({'success': False, 'message': result}), 400

    user_id = result
    session['user_id'] = user_id
    session['username'] = username

    return jsonify({
        'success': True,
        'user_id': user_id,
        'username': username,
        'redirect': url_for('home')
    })


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login_page'))

# -------------------------------------------------
# GAME PAGE ROUTES
# -------------------------------------------------
@app.route('/home')
@login_required
def home():
    username = session.get('username', 'Player')
    user_id = session.get('user_id')

    # sync wallet from DB
    u = find_user_by_id(user_id)
    if u:
        user_wallets[user_id] = u.balance
        if user_id not in user_game_history:
            user_game_history[user_id] = []
        if user_id not in user_complaints:
            user_complaints[user_id] = []

    return render_template('home.html', games=GAME_CONFIGS, username=username)


@app.route('/game/<game_type>')
@login_required
def game_lobby(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template('game-lobby.html', game_type=game_type, game=game)


@app.route('/play/<game_type>')
@login_required
def play_game(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template(f'{game_type}-game.html', game_type=game_type, game=game)


@app.route('/history')
@login_required
def game_history_page():
    return render_template('history.html')


@app.route('/balance/<user_id>')
def get_balance(user_id):
    # get from DB if possible
    u = find_user_by_id(user_id)
    if u:
        user_wallets[user_id] = u.balance
    balance = user_wallets.get(user_id, 0)
    return jsonify({'balance': balance})

# -------------------------------------------------
# PROFILE ROUTES
# -------------------------------------------------
@app.route('/profile')
@login_required
def profile_page():
    """Profile + coin transactions page."""
    user_id = session.get('user_id')
    username = session.get('username')

    user_obj = find_user_by_id(user_id)
    if user_obj:
        joined_at = user_obj.created_at
        joined_at_str = joined_at.strftime("%d %b %Y")
        wallet_balance = user_obj.balance
        email = user_obj.email or ''
        country = user_obj.country or ''
        phone = user_obj.phone or ''
    else:
        joined_at_str = "Just now"
        wallet_balance = user_wallets.get(user_id, 0)
        email = ''
        country = ''
        phone = ''

    # Build simple coin transactions from user_game_history
    txns = []
    for rec in user_game_history.get(user_id, []):
        cfg = GAME_CONFIGS.get(rec['game_type'], {})
        game_title = cfg.get('name', rec['game_type'])
        bet_amt = rec.get('bet_amount', cfg.get('bet_amount', 0))
        dt_val = rec.get('bet_time', datetime.now())
        if isinstance(dt_val, datetime):
            dt_str = dt_val.isoformat()
        else:
            dt_str = str(dt_val)

        # Bet transaction
        txns.append({
            'kind': 'bet',
            'amount': bet_amt,
            'datetime': dt_str,
            'label': 'Bet',
            'game_title': game_title,
            'note': f"Number {rec['number']}",
            'balance_after': wallet_balance  # approximate
        })

        if rec.get('is_resolved') and rec.get('win'):
            dt2 = rec.get('date_time') or dt_str
            txns.append({
                'kind': 'win',
                'amount': cfg.get('payout', 0),
                'datetime': dt2,
                'label': 'Win',
                'game_title': game_title,
                'note': f"Result {rec.get('winning_number')}",
                'balance_after': wallet_balance
            })

    return render_template(
        'profile.html',
        username=username,
        joined_at=joined_at_str,
        wallet_balance=wallet_balance,
        email=email,
        country=country,
        phone=phone,
        transactions=txns
    )


@app.route('/profile/update', methods=['POST'])
@login_required
def profile_update():
    """Save basic profile fields to DB."""
    user_id = session.get('user_id')
    user_obj = find_user_by_id(user_id)

    if not user_obj:
        return jsonify({'success': False, 'message': 'User not found'}), 404

    data = request.get_json() or {}
    user_obj.display_name = data.get('displayName', user_obj.display_name or user_obj.username)
    user_obj.email = data.get('email', user_obj.email or '')
    user_obj.country = data.get('country', user_obj.country or '')
    user_obj.phone = data.get('phone', user_obj.phone or '')

    db.session.add(user_obj)
    db.session.commit()

    return jsonify({'success': True, 'message': 'Profile updated'})

# -------------------------------------------------
# HELP / SUPPORT ROUTES (complaints still in memory + DB)
# -------------------------------------------------
@app.route('/help')
@login_required
def help_page():
    """Help & support page."""
    user_id = session.get('user_id')
    username = session.get('username')
    complaints_list = user_complaints.get(user_id, [])

    # also load from DB (in case app restarted)
    db_complaints = Complaint.query.filter_by(user_id=user_id).order_by(Complaint.created_at.desc()).all()
    for c in db_complaints:
        # convert DB row to dict like we used in template before
        if not c.updates_json:
            updates = []
        else:
            try:
                updates = json.loads(c.updates_json)
            except Exception:
                updates = []
        complaints_list.append({
            'id': c.complaint_id,
            'subject': c.subject,
            'message': c.message,
            'category': c.category,
            'status': c.status,
            'created_at': c.created_at.strftime("%Y-%m-%d %H:%M"),
            'last_update': c.last_update.strftime("%Y-%m-%d %H:%M"),
            'attachment_name': c.attachment_name,
            'original_filename': c.original_filename,
            'updates': updates
        })

    user_complaints[user_id] = complaints_list

    return render_template('help.html', username=username, complaints=complaints_list)


@app.route('/help/submit', methods=['POST'])
@login_required
def help_submit():
    """Receive complaint with optional attachment."""
    user_id = session.get('user_id')

    if user_id not in user_complaints:
        user_complaints[user_id] = []

    subject = request.form.get('subject', '').strip()
    message = request.form.get('message', '').strip()
    category = request.form.get('category', 'General')

    if not subject:
        return jsonify({'success': False, 'message': 'Please enter a subject'}), 400
    if not message:
        return jsonify({'success': False, 'message': 'Please enter a message'}), 400

    file = request.files.get('attachment')
    saved_name = None
    original_name = None

    if file and file.filename:
        filename = secure_filename(file.filename)
        timestamp = int(time.time())
        saved_name = f"{user_id}_{timestamp}_{filename}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], saved_name))
        original_name = file.filename

    complaint_id = f"C{datetime.now().strftime('%Y%m%d%H%M%S')}{random.randint(100,999)}"
    now_dt = datetime.utcnow()
    now_str = now_dt.strftime("%Y-%m-%d %H:%M")

    updates = [{'time': now_str, 'text': 'Complaint created and sent to support.'}]

    # store in DB
    comp_row = Complaint(
        complaint_id=complaint_id,
        user_id=user_id,
        subject=subject,
        message=message,
        category=category,
        status='Open',
        created_at=now_dt,
        last_update=now_dt,
        attachment_name=saved_name,
        original_filename=original_name,
        updates_json=json.dumps(updates)
    )
    db.session.add(comp_row)
    db.session.commit()

    complaint = {
        'id': complaint_id,
        'subject': subject,
        'message': message,
        'category': category,
        'status': 'Open',
        'created_at': now_str,
        'last_update': now_str,
        'attachment_name': saved_name,
        'original_filename': original_name,
        'updates': updates
    }

    user_complaints[user_id].append(complaint)

    return jsonify({'success': True, 'complaint': complaint})

# -------------------------------------------------
# SOCKET.IO HANDLERS
# -------------------------------------------------
@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connection_response', {'data': 'Connected'})


@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')


@socketio.on('join_game')
def handle_join_game(data):
    game_type = data.get('game_type')
    user_id = data.get('user_id')
    print(f"User {user_id} joined game {game_type}")
    join_room(game_type)


@socketio.on('place_bet')
def handle_place_bet(data):
    game_type = data.get('game_type')
    user_id = data.get('user_id')
    username = data.get('username')
    number = data.get('number')

    tables = game_tables.get(game_type)
    if not tables:
        emit('bet_error', {'message': 'Invalid game type'})
        return

    table = None
    for t in tables:
        if not t.is_betting_closed and not t.is_finished and len(t.bets) < t.max_players:
            table = t
            break

    if not table:
        emit('bet_error', {'message': 'No open game table'})
        return

    # check wallet from memory (kept in sync with DB)
    if user_wallets.get(user_id, 0) < table.config['bet_amount']:
        emit('bet_error', {'message': 'Insufficient balance'})
        return

    success, message = table.add_bet(user_id, username, number)
    if not success:
        emit('bet_error', {'message': message})
    else:
        # deduct from DB + memory
        u = User.query.filter_by(user_id=user_id).first()
        if u:
            u.balance -= table.config['bet_amount']
            db.session.add(u)
            db.session.commit()
            user_wallets[user_id] = u.balance
        else:
            user_wallets[user_id] -= table.config['bet_amount']

        emit('bet_success', {'message': message, 'new_balance': user_wallets[user_id]})


# -------------------------------------------------
# DB INITIALISATION & DEMO USERS
# -------------------------------------------------
def load_users_from_db_into_memory():
    """On startup, sync users & balances from DB to in-memory dicts."""
    for u in User.query.all():
        users_db[u.username] = {
            'user_id': u.user_id,
            'username': u.username,
            'password_hash': u.password_hash,
            'created_at': u.created_at.isoformat(),
            'display_name': u.display_name or u.username,
            'email': u.email or '',
            'country': u.country or '',
            'phone': u.phone or ''
        }
        user_wallets[u.user_id] = u.balance
        if u.user_id not in user_game_history:
            user_game_history[u.user_id] = []
        if u.user_id not in user_complaints:
            user_complaints[u.user_id] = []


def seed_demo_users():
    """
    Create 6 demo users with 10,000 coins each if they don't exist yet.
    usernames: demo1...demo6, password: demo123
    """
    for i in range(1, 7):
        username = f"demo{i}"
        password = "demo123"
        existing = User.query.filter_by(username=username).first()
        if existing:
            # make sure they have at least 10k
            if existing.balance < 10000:
                existing.balance = 10000
                db.session.add(existing)
            continue
        create_user(username, password, initial_balance=10000)
    db.session.commit()
    print("Seeded demo users demo1..demo6 (password demo123, 10,000 coins each).")


# -------------------------------------------------
# MAIN ENTRY
# -------------------------------------------------
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        load_users_from_db_into_memory()
        seed_demo_users()
        initialize_game_tables()
        start_all_game_tables()

    socketio.run(
        app,
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 10000)),
        debug=False,
        allow_unsafe_werkzeug=True
    )
