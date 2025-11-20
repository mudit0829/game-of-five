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

# ---------------------------------------------------
# Flask / DB / Socket setup
# ---------------------------------------------------

app = Flask(__name__)
app.config["SECRET_KEY"] = "your-secret-key-here-change-this-in-production"
app.config["PROPAGATE_EXCEPTIONS"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

# DB config – you can replace with your Render DB URL
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL", "sqlite:///game.db"
)
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
        "bet_amount": 200,
        "payout": 1000,
        "name": "Silver Game",
        "type": "number",
        "title": "Frog Leap",
        "emoji": "🐸",
    },
    "gold": {
        "bet_amount": 250,
        "payout": 1250,
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
        "bet_amount": 1000,
        "payout": 5000,
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
    status = db.Column(db.String(20), default="open")  # open / in_progress / closed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    attachment_name = db.Column(db.String(255))


# ---------------------------------------------------
# In-memory structures (tables + history)
# ---------------------------------------------------

game_tables = {}  # {game_type: [GameTable, ...]}
user_game_history = {}  # {user_id: [bet_record, ...]}  (pending + completed)


# ---------------------------------------------------
# Helpers
# ---------------------------------------------------


def login_required(f):
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
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
# GameTable (per-table round logic, in memory)
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
        self.bets = []  # list of dicts
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
        # max 4 bets per user
        user_bets = [b for b in self.bets if b["user_id"] == user_id]
        if len(user_bets) >= 4:
            return False, "Maximum 4 bets per user"

        if len(self.bets) >= self.max_players:
            return False, "All slots are full"

        bet_obj = {
            "user_id": user_id,
            "username": username,
            "number": number,
            "is_bot": is_bot,
            "bet_amount": self.config["bet_amount"],
            "bet_time": datetime.now(),
        }
        self.bets.append(bet_obj)

        # log into user history (non-bots)
        if not is_bot:
            if user_id not in user_game_history:
                user_game_history[user_id] = []
            user_game_history[user_id].append(
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

        all_numbers = self.get_number_range()
        bot_name = generate_bot_name()
        bot_number = random.choice(all_numbers)
        self.bets.append(
            {
                "user_id": f"bot_{bot_name}",
                "username": bot_name,
                "number": bot_number,
                "is_bot": True,
                "bet_amount": self.config["bet_amount"],
                "bet_time": datetime.now(),
            }
        )
        return True

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
# Table initialization and threads
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
    # Each thread needs application context for DB operations
    with app.app_context():
        while True:
            try:
                now = datetime.now()

                # wait until start
                if now < table.start_time:
                    time.sleep(1)
                    continue

                # add bots during middle of round
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

                # close betting
                if now >= table.betting_close_time and not table.is_betting_closed:
                    table.is_betting_closed = True
                    print(f"{table.game_type} Table {table.table_number}: Betting closed")

                # finish game
                if now >= table.end_time and not table.is_finished:
                    table.is_finished = True
                    result = table.calculate_result()
                    winners = table.get_winners()
                    print(
                        f"{table.game_type} Table {table.table_number}: Game ended. Winner: {result}"
                    )

                    # finalize history
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

                    # award winners
                    for winner in winners:
                        wallet = Wallet.query.filter_by(
                            user_id=winner["user_id"]
                        ).first()
                        if wallet:
                            wallet.balance += winner["payout"]
                    db.session.commit()

                    # restart round
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
                    print(
                        f"{table.game_type} Table {table.table_number}: New round started - {table.round_code}"
                    )

                time.sleep(1)
            except Exception as e:
                print(f"Error managing table {table.game_type} #{table.table_number}: {e}")
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
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

    # ensure wallet
    ensure_wallet_for_user(user)

    session["user_id"] = user.id
    session["username"] = user.username
    if remember_me:
        session.permanent = True

    token = secrets.token_urlsafe(32)

    return jsonify(
        {
            "success": True,
            "user_id": user.id,
            "username": user.username,
            "token": token,
            "redirect": url_for("home"),
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
# Game pages / history / profile / help
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

    # build very simple coin transactions from history (bets + wins)
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

    # POST (new ticket)
    subject = request.form.get("subject", "").strip() or "(no subject)"
    message = request.form.get("message", "").strip()
    file = request.files.get("attachment")

    attach_name = None
    if file and file.filename:
        # NOTE: In production, use secure_filename and external storage
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
    """
    Balance API used by the game pages.
    We IGNORE the id in the URL and always use the logged-in user
    from the Flask session, so calls like /balance/undefined still work.
    """
    from flask import session

    real_user_id = session.get("user_id")
    if not real_user_id:
        return jsonify({"balance": 0})

    user = User.query.get(real_user_id)
    if not user:
        return jsonify({"balance": 0})

    wallet = ensure_wallet_for_user(user)
    return jsonify({"balance": wallet.balance})


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
    user_id = data.get("user_id")
    username = data.get("username")
    number = data.get("number")

    if game_type not in GAME_CONFIGS:
        emit("bet_error", {"message": "Invalid game type"})
        return

    user = User.query.get(user_id)
    if not user:
        emit("bet_error", {"message": "User not found"})
        return

    wallet = ensure_wallet_for_user(user)

    tables = game_tables.get(game_type)
    if not tables:
        emit("bet_error", {"message": "No tables for this game"})
        return

    # find open table
    table = None
    for t in tables:
        if not t.is_betting_closed and not t.is_finished and len(t.bets) < t.max_players:
            table = t
            break

    if not table:
        emit("bet_error", {"message": "No open game table"})
        return

    if wallet.balance < table.config["bet_amount"]:
        emit("bet_error", {"message": "Insufficient balance"})
        return

    success, message = table.add_bet(user_id, username, number)
    if not success:
        emit("bet_error", {"message": message})
        return

    wallet.balance -= table.config["bet_amount"]
    db.session.commit()

    emit(
        "bet_success",
        {"message": message, "new_balance": wallet.balance},
    )


# ---------------------------------------------------
# Demo user seeding
# ---------------------------------------------------


def seed_demo_users():
    """Create demo, demo1..demo5 with 10k coins if they don't exist."""
    demo_usernames = ["demo"] + [f"demo{i}" for i in range(1, 6)]
    for uname in demo_usernames:
        user = User.query.filter_by(username=uname).first()
        if not user:
            user = User(username=uname, display_name=uname)
            user.set_password("demo123")
            db.session.add(user)
            db.session.commit()
        ensure_wallet_for_user(user)
    print("Demo users ready: demo, demo1..demo5, password='demo123'")


# ---------------------------------------------------
# Main entry
# ---------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        seed_demo_users()
        initialize_game_tables()
        start_all_game_tables()

    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 10000)),
        debug=False,
        allow_unsafe_werkzeug=True,
    )
