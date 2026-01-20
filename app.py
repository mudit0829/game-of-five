from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    redirect,
    url_for,
    session,
)
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
from datetime import datetime, timedelta
import threading
import random
import time
import os
import hashlib
import secrets
from functools import wraps

# ---------------------------------------------------
# Flask / DB / Socket setup
# ---------------------------------------------------

app = Flask(__name__)
app.config["SECRET_KEY"] = "your-secret-key-here-change-this-in-production"
app.config["PROPAGATE_EXCEPTIONS"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

# DB config - uses sqlite in current directory
db_path = os.path.join(os.path.dirname(__file__), 'game.db')
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    ping_timeout=60,
    ping_interval=25,
)

# ---------------------------------------------------
# Game configurations
# ---------------------------------------------------
GAME_CONFIGS = {
    "silver": {
        "bet_amount": 10,
        "payout": 50,
        "name": "Silver Game",
        "type": "number",
        "title": "Frog Leap",
        "emoji": "🐸",
    },
    "gold": {
        "bet_amount": 50,
        "payout": 250,
        "name": "Gold Game",
        "type": "number",
        "title": "Football Goal",
        "emoji": "⚽",
    },
    "diamond": {
        "bet_amount": 100,
        "payout": 500,
        "name": "Diamond Game",
        "type": "number",
        "title": "Archer Hit",
        "emoji": "🏹",
    },
    "platinum": {
        "bet_amount": 200,
        "payout": 1000,
        "name": "Platinum Game",
        "type": "number",
        "title": "Parachute Drop",
        "emoji": "🪂",
    },
    "roulette": {
        "bet_amount": 200,
        "payout": 2000,
        "name": "Roulette Game",
        "type": "roulette",
        "title": "Roulette Spin",
        "emoji": "🎡",
    },
}

# ---------------------------------------------------
# SQLAlchemy Models
# ---------------------------------------------------


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    display_name = db.Column(db.String(120))
    email = db.Column(db.String(200))
    country = db.Column(db.String(100))
    phone = db.Column(db.String(50))
    
    # Admin fields
    is_admin = db.Column(db.Boolean, default=False)
    is_blocked = db.Column(db.Boolean, default=False)
    block_reason = db.Column(db.Text)

    wallet = db.relationship("Wallet", backref="user", uselist=False)
    tickets = db.relationship("Ticket", backref="user", lazy=True)

    def set_password(self, password: str):
        self.password_hash = hashlib.sha256(password.encode()).hexdigest()

    def check_password(self, password: str) -> bool:
        return self.password_hash == hashlib.sha256(password.encode()).hexdigest()


class Wallet(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    balance = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Ticket(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    subject = db.Column(db.String(200))
    message = db.Column(db.Text)
    status = db.Column(db.String(20), default="open")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    attachment_name = db.Column(db.String(255))


# ---------------------------------------------------
# In-memory structures
# ---------------------------------------------------

game_tables = {}
user_game_history = {}


# ---------------------------------------------------
# Helpers
# ---------------------------------------------------


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)

    return decorated


def admin_required(f):
    """Check if user is logged in AND is admin"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))
        
        user = User.query.get(session.get("user_id"))
        if not user or not user.is_admin:
            # For HTML page requests, redirect to login
            # For API requests (JSON), return 403
            if request.path.startswith('/api/'):
                return jsonify({"error": "Admin access required"}), 403
            else:
                return redirect(url_for("login_page"))
        
        return f(*args, **kwargs)
    
    return decorated


def ensure_wallet_for_user(user: User) -> Wallet:
    """Ensure the user has a wallet row with starting 10000 coins."""
    if not user.wallet:
        wallet = Wallet(user_id=user.id, balance=10000)
        db.session.add(wallet)
        db.session.commit()
        return wallet
    return user.wallet


def generate_bot_name():
    prefixes = [
        "Amit",
        "Sanjay",
        "Riya",
        "Kunal",
        "Anita",
        "Rohit",
        "Meera",
        "Neeraj",
    ]
    suffix = random.randint(100, 999)
    return f"{random.choice(prefixes)}{suffix}"


# ---------------------------------------------------
# GameTable class
# ---------------------------------------------------


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
        if self.game_type == "roulette":
            return list(range(37))
        return list(range(10))

    def add_bet(self, user_id, username, number, is_bot=False):
        try:
            number_int = int(number)
        except (TypeError, ValueError):
            return False, "Invalid number"
        number = number_int

        for bet in self.bets:
            if bet["number"] == number:
                return (
                    False,
                    "This number is already taken in this game. Please choose another.",
                )

        if not is_bot:
            try:
                user_id_norm = int(user_id)
            except (TypeError, ValueError):
                user_id_norm = user_id
        else:
            user_id_norm = user_id

        user_bets = [b for b in self.bets if b["user_id"] == user_id_norm]
        if len(user_bets) >= 4:
            return False, "Maximum 4 bets per user"

        if len(self.bets) >= self.max_players:
            return False, "All slots are full"

        bet_obj = {
            "user_id": user_id_norm,
            "username": username,
            "number": number,
            "is_bot": is_bot,
            "bet_amount": self.config["bet_amount"],
            "bet_time": datetime.now(),
        }
        self.bets.append(bet_obj)

        if not is_bot:
            if user_id_norm not in user_game_history:
                user_game_history[user_id_norm] = []
            user_game_history[user_id_norm].append(
                {
                    "game_type": self.game_type,
                    "round_code": self.round_code,
                    "bet_amount": self.config["bet_amount"],
                    "number": number,
                    "bet_time": datetime.now(),
                    "table_number": self.table_number,
                    "is_resolved": False,
                }
            )

        return True, "Bet placed successfully"

    def add_bot_bet(self):
        if len(self.bets) >= self.max_players:
            return False

        taken_numbers = {b["number"] for b in self.bets}
        all_numbers = self.get_number_range()
        available_numbers = [n for n in all_numbers if n not in taken_numbers]

        if not available_numbers:
            return False

        bot_name = generate_bot_name()
        bot_number = random.choice(available_numbers)

        success, _ = self.add_bet(
            user_id=f"bot_{bot_name}",
            username=bot_name,
            number=bot_number,
            is_bot=True,
        )
        return success

    def calculate_result(self):
        real_user_bets = [b for b in self.bets if not b["is_bot"]]
        if random.random() < 0.16 and real_user_bets:
            winning_bet = random.choice(real_user_bets)
            self.result = winning_bet["number"]
        else:
            all_numbers = self.get_number_range()
            self.result = random.choice(all_numbers)
        return self.result

    def get_winners(self):
        if self.result is None:
            return []
        winners = []
        for bet in self.bets:
            if bet["number"] == self.result and not bet["is_bot"]:
                winners.append(
                    {
                        "user_id": bet["user_id"],
                        "username": bet["username"],
                        "payout": self.config["payout"],
                    }
                )
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
            "table_number": self.table_number,
            "round_code": self.round_code,
            "game_type": self.game_type,
            "players": len(self.bets),
            "max_players": self.max_players,
            "slots_available": self.get_slots_available(),
            "time_remaining": self.get_time_remaining(),
            "is_betting_closed": self.is_betting_closed,
            "is_finished": self.is_finished,
            "is_started": self.is_started(),
            "bets": self.bets,
            "result": self.result,
        }


# ---------------------------------------------------
# Table initialization
# ---------------------------------------------------


def initialize_game_tables():
    for game_type in GAME_CONFIGS.keys():
        game_tables[game_type] = []
        for i in range(6):
            initial_delay = i * 60
            table = GameTable(game_type, i + 1, initial_delay)
            game_tables[game_type].append(table)
        print(f"Initialized 6 tables for {game_type}")


def manage_game_table(table: GameTable):
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

                if now >= table.betting_close_time and not table.is_betting_closed:
                    table.is_betting_closed = True
                    print(f"{table.game_type} Table {table.table_number}: Betting closed")

                if now >= table.end_time and not table.is_finished:
                    table.is_finished = True
                    result = table.calculate_result()
                    winners = table.get_winners()
                    print(
                        f"{table.game_type} Table {table.table_number}: Game ended. Winner: {result}"
                    )

                    for bet in table.bets:
                        if bet.get("is_bot"):
                            continue
                        uid = bet["user_id"]
                        for rec in user_game_history.get(uid, []):
                            if (
                                not rec.get("is_resolved")
                                and rec["game_type"] == table.game_type
                                and rec["round_code"] == table.round_code
                                and rec["number"] == bet["number"]
                            ):
                                rec["winning_number"] = result
                                rec["win"] = bet["number"] == result
                                rec["status"] = "win" if rec["win"] else "lose"
                                rec["amount"] = (
                                    table.config["payout"]
                                    if rec["win"]
                                    else -table.config["bet_amount"]
                                )
                                rec["is_resolved"] = True
                                rec["date_time"] = now.strftime("%Y-%m-%d %H:%M")

                    for winner in winners:
                        wallet = Wallet.query.filter_by(
                            user_id=winner["user_id"]
                        ).first()
                        if wallet:
                            wallet.balance += winner["payout"]
                    db.session.commit()

                    time.sleep(3)
                    table.bets = []
                    table.result = None
                    table.is_betting_closed = False
                    table.is_finished = False
                    table.start_time = datetime.now()
                    table.end_time = table.start_time + timedelta(minutes=5)
                    table.betting_close_time = table.end_time - timedelta(
                        seconds=15
                    )
                    table.round_code = table._make_round_code()
                    table.last_bot_added_at = None
                    print(
                        f"{table.game_type} Table {table.table_number}: New round started - {table.round_code}"
                    )

                time.sleep(1)
            except Exception as e:
                print(
                    f"Error managing table {table.game_type} #{table.table_number}: {e}"
                )
                time.sleep(1)


def start_all_game_tables():
    for game_type, tables in game_tables.items():
        for table in tables:
            threading.Thread(
                target=manage_game_table, args=(table,), daemon=True
            ).start()
    print("All game table threads started!")


# ---------------------------------------------------
# API: tables and history
# ---------------------------------------------------


@app.route("/api/tables/<game_type>")
def get_game_tables_api(game_type):
    if game_type not in GAME_CONFIGS:
        return jsonify({"error": "Invalid game type"}), 404
    tables = game_tables.get(game_type, [])
    return jsonify(
        {"game_type": game_type, "tables": [table.to_dict() for table in tables]}
    )


@app.route("/api/tables")
def get_all_tables():
    all_tables = {
        game_type: [table.to_dict() for table in tables]
        for game_type, tables in game_tables.items()
    }
    return jsonify(all_tables)


@app.route("/api/user-games")
def user_games_history_api():
    user_id = request.args.get("user_id", type=int)
    if not user_id:
        return jsonify({"current_games": [], "game_history": []})

    user_bets = user_game_history.get(user_id, [])

    grouped = {}
    for b in user_bets:
        key = (b["game_type"], b["round_code"])
        if key not in grouped:
            grouped[key] = {
                "game_type": b["game_type"],
                "round_code": b["round_code"],
                "bet_amount": GAME_CONFIGS[b["game_type"]]["bet_amount"],
                "user_bets": [],
                "winning_number": None,
                "date_time": "",
                "status": None,
                "amount": 0,
            }
        grouped[key]["user_bets"].append(b["number"])
        if b.get("winning_number") is not None:
            grouped[key]["winning_number"] = b["winning_number"]
            grouped[key]["status"] = b["status"]
            if b["status"] == "win":
                grouped[key]["amount"] += GAME_CONFIGS[b["game_type"]]["payout"]
            else:
                grouped[key]["amount"] -= GAME_CONFIGS[b["game_type"]]["bet_amount"]
        if b.get("date_time"):
            grouped[key]["date_time"] = b["date_time"]

    all_games = list(grouped.values())
    game_history = [g for g in all_games if g.get("status")]
    current_games = [g for g in all_games if not g.get("status")]

    return jsonify({"current_games": current_games, "game_history": game_history})


# ---------------------------------------------------
# Auth routes
# ---------------------------------------------------


@app.route("/")
def index():
    if "user_id" in session:
        user = User.query.get(session.get("user_id"))
        if user and user.is_admin:
            return redirect(url_for("admin_panel"))
        return redirect(url_for("home"))
    return redirect(url_for("login_page"))


@app.route("/login")
def login_page():
    if "user_id" in session:
        return redirect(url_for("home"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login_post():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    remember_me = data.get("remember_me", False)

    if not username or not password:
        return (
            jsonify(
                {"success": False, "message": "Username and password required"}
            ),
            400,
        )

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify(
            {"success": False, "message": "Invalid username or password"}
        ), 401

    if user.is_blocked:
        return jsonify(
            {"success": False, "message": f"Your account is blocked. Reason: {user.block_reason or 'No reason provided'}"}
        ), 403

    ensure_wallet_for_user(user)

    session["user_id"] = user.id
    session["username"] = user.username
    if remember_me:
        session.permanent = True

    token = secrets.token_urlsafe(32)

    redirect_url = url_for("admin_panel") if user.is_admin else url_for("home")

    return jsonify(
        {
            "success": True,
            "user_id": user.id,
            "username": user.username,
            "token": token,
            "redirect": redirect_url,
        }
    )


@app.route("/register", methods=["GET", "POST"])
def register_page():
    if request.method == "GET":
        if "user_id" in session:
            return redirect(url_for("home"))
        return render_template("register.html")

    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return (
            jsonify(
                {"success": False, "message": "Username and password required"}
            ),
            400,
        )
    if len(password) < 6:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Password must be at least 6 characters",
                }
            ),
            400,
        )

    existing = User.query.filter_by(username=username).first()
    if existing:
        return jsonify({"success": False, "message": "Username already exists"}), 400

    user = User(username=username, display_name=username)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    ensure_wallet_for_user(user)

    session["user_id"] = user.id
    session["username"] = user.username

    return jsonify(
        {
            "success": True,
            "user_id": user.id,
            "username": user.username,
            "redirect": url_for("home"),
        }
    )


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


# ---------------------------------------------------
# Game pages
# ---------------------------------------------------


@app.route("/home")
@login_required
def home():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if user:
        ensure_wallet_for_user(user)
    username = session.get("username", "Player")
    return render_template("home.html", games=GAME_CONFIGS, username=username)


@app.route("/game/<game_type>")
@login_required
def game_lobby(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template("game-lobby.html", game_type=game_type, game=game)


@app.route("/play/<game_type>")
@login_required
def play_game(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template(f"{game_type}-game.html", game_type=game_type, game=game)


@app.route("/history")
@login_required
def history_page():
    return render_template("history.html")


@app.route("/profile")
@login_required
def profile_page():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return redirect(url_for("logout"))

    wallet = ensure_wallet_for_user(user)
    joined_at = user.created_at.strftime("%d %b %Y") if user.created_at else "Just now"

    txns = []
    for rec in user_game_history.get(user_id, []):
        cfg = GAME_CONFIGS.get(rec["game_type"], {})
        game_title = cfg.get("name", rec["game_type"])
        bet_amt = rec.get("bet_amount", cfg.get("bet_amount", 0))
        dt = rec.get("bet_time", datetime.now())
        if isinstance(dt, datetime):
            dt_str = dt.strftime("%Y-%m-%d %H:%M")
        else:
            dt_str = str(dt)

        txns.append(
            {
                "kind": "bet",
                "amount": bet_amt,
                "datetime": dt_str,
                "label": "Bet",
                "game_title": game_title,
                "note": f"Number {rec['number']}",
            }
        )

        if rec.get("is_resolved") and rec.get("win"):
            dt2 = rec.get("date_time") or dt_str
            txns.append(
                {
                    "kind": "win",
                    "amount": cfg.get("payout", 0),
                    "datetime": dt2,
                    "label": "Win",
                    "game_title": game_title,
                    "note": f"Result {rec.get('winning_number')}",
                }
            )

    return render_template(
        "profile.html",
        username=user.username,
        display_name=user.display_name or user.username,
        joined_at=joined_at,
        wallet_balance=wallet.balance,
        email=user.email or "",
        country=user.country or "",
        phone=user.phone or "",
        transactions=txns,
    )


@app.route("/profile/update", methods=["POST"])
@login_required
def profile_update():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    user.display_name = data.get("displayName", user.display_name or user.username)
    user.email = data.get("email", user.email or "")
    user.country = data.get("country", user.country or "")
    user.phone = data.get("phone", user.phone or "")

    db.session.commit()
    return jsonify({"success": True, "message": "Profile updated"})


@app.route("/help")
@login_required
def help_page():
    return render_template("help.html")


@app.route("/api/help/tickets", methods=["GET", "POST"])
@login_required
def help_tickets_api():
    user_id = session.get("user_id")

    if request.method == "GET":
        tickets = (
            Ticket.query.filter_by(user_id=user_id)
            .order_by(Ticket.created_at.desc())
            .all()
        )
        out = []
        for t in tickets:
            out.append(
                {
                    "id": t.id,
                    "subject": t.subject,
                    "message": t.message[:200],
                    "status": t.status,
                    "created_at": t.created_at.strftime("%Y-%m-%d %H:%M"),
                    "updated_at": t.updated_at.strftime("%Y-%m-%d %H:%M"),
                }
            )
        return jsonify(out)

    subject = request.form.get("subject", "").strip() or "(no subject)"
    message = request.form.get("message", "").strip()
    file = request.files.get("attachment")

    attach_name = None
    if file and file.filename:
        upload_dir = os.path.join(os.path.dirname(__file__), "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        attach_name = f"{int(time.time())}_{file.filename}"
        file.save(os.path.join(upload_dir, attach_name))

    ticket = Ticket(
        user_id=user_id, subject=subject, message=message, attachment_name=attach_name
    )
    db.session.add(ticket)
    db.session.commit()

    return jsonify({"success": True, "ticket_id": ticket.id})


# ---------------------------------------------------
# Balance API
# ---------------------------------------------------


@app.route("/balance/<user_id>")
def get_balance(user_id):
    real_user_id = session.get("user_id")
    if not real_user_id:
        return jsonify({"balance": 0})

    user = User.query.get(real_user_id)
    if not user:
        return jsonify({"balance": 0})

    wallet = ensure_wallet_for_user(user)
    return jsonify({"balance": wallet.balance})


# ---------------------------------------------------
# ADMIN PANEL ROUTES
# ---------------------------------------------------


@app.route("/admin")
@admin_required
def admin_panel():
    """Main admin panel page"""
    return render_template("admin_panel.html")


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_get_users():
    """Get all users with wallet info"""
    users = User.query.all()
    user_list = []
    
    for user in users:
        wallet = ensure_wallet_for_user(user)
        user_list.append({
            "id": user.id,
            "username": user.username,
            "email": user.email or "",
            "password_hash": user.password_hash,
            "status": "blocked" if user.is_blocked else "active",
            "balance": wallet.balance,
            "created_at": user.created_at.strftime("%Y-%m-%d %H:%M"),
            "block_reason": user.block_reason or "",
        })
    
    return jsonify(user_list)


@app.route("/api/admin/users/<int:user_id>", methods=["PUT"])
@admin_required
def admin_update_user(user_id):
    """Update user information"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    data = request.get_json() or {}
    
    if "username" in data:
        user.username = data["username"]
    if "email" in data:
        user.email = data["email"]
    if "password" in data and data["password"]:
        user.set_password(data["password"])
    if "status" in data:
        user.is_blocked = (data["status"] == "blocked")
    if "balance" in data:
        wallet = ensure_wallet_for_user(user)
        wallet.balance = data["balance"]
    if "block_reason" in data:
        user.block_reason = data["block_reason"]
    
    db.session.commit()
    return jsonify({"success": True, "message": "User updated successfully"})


@app.route("/api/admin/users/<int:user_id>/block", methods=["POST"])
@admin_required
def admin_block_user(user_id):
    """Block a user"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    data = request.get_json() or {}
    user.is_blocked = True
    user.block_reason = data.get("reason", "Blocked by admin")
    
    db.session.commit()
    return jsonify({"success": True, "message": "User blocked successfully"})


@app.route("/api/admin/users/<int:user_id>/unblock", methods=["POST"])
@admin_required
def admin_unblock_user(user_id):
    """Unblock a user"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    user.is_blocked = False
    user.block_reason = None
    
    db.session.commit()
    return jsonify({"success": True, "message": "User unblocked successfully"})


@app.route("/api/admin/users/<int:user_id>/balance", methods=["POST"])
@admin_required
def admin_credit_debit(user_id):
    """Credit or debit user balance"""
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    data = request.get_json() or {}
    transaction_type = data.get("type", "add")
    amount = float(data.get("amount", 0))
    reason = data.get("reason", "Admin transaction")
    
    wallet = ensure_wallet_for_user(user)
    
    if transaction_type == "add":
        wallet.balance += amount
    else:
        wallet.balance -= amount
    
    db.session.commit()
    
    return jsonify({
        "success": True,
        "message": f"Transaction processed. New balance: ₹{wallet.balance}",
        "new_balance": wallet.balance
    })


@app.route("/api/admin/games", methods=["GET"])
@admin_required
def admin_get_games():
    """Get all active games"""
    all_games = []
    
    for game_type, tables in game_tables.items():
        for table in tables:
            all_games.append({
                "round_code": table.round_code,
                "game_type": game_type,
                "players": len(table.bets),
                "max_players": table.max_players,
                "status": "finished" if table.is_finished else "completed" if table.is_betting_closed else "active",
                "result": table.result,
                "total_bets": sum(b.get("bet_amount", 0) for b in table.bets),
                "started_at": table.start_time.strftime("%Y-%m-%d %H:%M"),
            })
    
    return jsonify(all_games)


@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_get_stats():
    """Get admin dashboard statistics"""
    total_users = User.query.count()
    blocked_users = User.query.filter_by(is_blocked=True).count()
    active_games = sum(1 for tables in game_tables.values() for t in tables if not t.is_finished)
    
    all_wallets = Wallet.query.all()
    total_revenue = sum(w.balance for w in all_wallets)
    
    return jsonify({
        "total_users": total_users,
        "active_games": active_games,
        "total_revenue": total_revenue,
        "blocked_users": blocked_users,
    })


# ---------------------------------------------------
# Socket.IO handlers
# ---------------------------------------------------


@socketio.on("connect")
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit("connection_response", {"data": "Connected"})


@socketio.on("disconnect")
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")


@socketio.on("join_game")
def handle_join_game(data):
    game_type = data.get("game_type")
    user_id = data.get("user_id")
    print(f"User {user_id} joined game {game_type}")
    join_room(game_type)


@socketio.on("place_bet")
def handle_place_bet(data):
    game_type = data.get("game_type")
    raw_user_id = data.get("user_id")
    username = data.get("username")
    number = data.get("number")
    round_code = data.get("round_code")

    if game_type not in GAME_CONFIGS:
        emit("bet_error", {"message": "Invalid game type"})
        return

    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        user_id = raw_user_id

    user = User.query.get(user_id)
    if not user:
        emit("bet_error", {"message": "User not found"})
        return

    if user.is_blocked:
        emit("bet_error", {"message": f"Your account is blocked. Reason: {user.block_reason or 'No reason provided'}"})
        return

    wallet = ensure_wallet_for_user(user)

    tables = game_tables.get(game_type)
    if not tables:
        emit("bet_error", {"message": "No tables for this game"})
        return

    table = None
    if round_code:
        for t in tables:
            if t.round_code == round_code:
                table = t
                break
        if not table:
            emit(
                "bet_error",
                {
                    "message": "This game round is no longer available. Please join a new game."
                },
            )
            return
    else:
        for t in tables:
            if not t.is_betting_closed and not t.is_finished and len(t.bets) < t.max_players:
                table = t
                break
        if not table:
            emit("bet_error", {"message": "No open game table"})
            return

    if table.is_finished or table.is_betting_closed:
        emit("bet_error", {"message": "Betting is closed for this game"})
        return

    if len(table.bets) >= table.max_players:
        emit("bet_error", {"message": "All slots are full"})
        return

    bet_amount = table.config["bet_amount"]

    if wallet.balance < bet_amount:
        emit("bet_error", {"message": "Insufficient balance"})
        return

    success, message = table.add_bet(user_id, username, number)
    if not success:
        emit("bet_error", {"message": message})
        return

    wallet.balance -= bet_amount
    db.session.commit()

    emit(
        "bet_success",
        {
            "message": message,
            "new_balance": wallet.balance,
            "round_code": table.round_code,
        },
    )


# ---------------------------------------------------
# Demo user seeding
# ---------------------------------------------------


def seed_demo_users():
    """Create demo, demo1..demo5 with 10k coins and admin user"""
    print("\n🔄 Checking/Creating users...")
    
    demo_usernames = ["demo"] + [f"demo{i}" for i in range(1, 6)]
    for uname in demo_usernames:
        user = User.query.filter_by(username=uname).first()
        if not user:
            user = User(username=uname, display_name=uname)
            user.set_password("demo123")
            db.session.add(user)
            db.session.commit()
            print(f"✅ Created user: {uname}")
        ensure_wallet_for_user(user)
    
    # Create or update admin user - ALWAYS ensure is_admin=True
    admin = User.query.filter_by(username="admin").first()
    if not admin:
        print("✅ Creating admin user...")
        admin = User(username="admin", display_name="Admin User", is_admin=True)
        admin.set_password("admin123")
        db.session.add(admin)
        db.session.commit()
        ensure_wallet_for_user(admin)
        print("✅ Admin user created: is_admin=True")
    else:
        # Ensure existing admin has is_admin=True
        if not admin.is_admin:
            print("⚠️  Fixing admin user: setting is_admin=True")
            admin.is_admin = True
            db.session.commit()
        ensure_wallet_for_user(admin)
        print("✅ Admin user verified: is_admin=True")
    
    print("✅ All users ready!\n")


# ---------------------------------------------------
# Main entry
# ---------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        print("🔧 Creating database tables...")
        db.create_all()
        print("✅ Database tables created")
        
        print("👥 Seeding demo users...")
        seed_demo_users()
        
        print("🎮 Initializing game tables...")
        initialize_game_tables()
        
        print("▶️  Starting game threads...")
        start_all_game_tables()
        
        print("\n" + "="*60)
        print("🎮 GAME OF FIVE - Admin Panel Ready")
        print("="*60)
        print("📍 Admin URL: http://localhost:10000/admin")
        print("👤 Admin Username: admin")
        print("🔐 Admin Password: admin123")
        print("="*60 + "\n")

    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 10000)),
        debug=False,
        allow_unsafe_werkzeug=True,
    )
