import os
import time
import random
import threading
import hashlib
import secrets
from datetime import datetime, timedelta

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
from functools import wraps


# ============================================================
# App / Config
# ============================================================

app = Flask(__name__)

# IMPORTANT for Render/GitHub deploy:
# - Set SECRET_KEY in Render env
# - Set DATABASE_URL (Postgres) if you want persistence; otherwise SQLite is used.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-this-secret-in-production")
app.config["PROPAGATE_EXCEPTIONS"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

database_url = os.environ.get("DATABASE_URL")
if database_url:
    # Render often provides postgres://, SQLAlchemy expects postgresql://
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
else:
    db_path = os.path.join(os.path.dirname(__file__), "game.db")
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


# ============================================================
# Game configs
# ============================================================

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


# ============================================================
# Models
# ============================================================

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(128), nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    display_name = db.Column(db.String(120))
    email = db.Column(db.String(200))
    country = db.Column(db.String(100))
    phone = db.Column(db.String(50))

    is_admin = db.Column(db.Boolean, default=False)
    is_blocked = db.Column(db.Boolean, default=False)
    block_reason = db.Column(db.Text)

    wallet = db.relationship("Wallet", backref="user", uselist=False)

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
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)

    subject = db.Column(db.String(200))
    message = db.Column(db.Text)
    status = db.Column(db.String(20), default="open")

    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    attachment_name = db.Column(db.String(255))


class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    kind = db.Column(db.String(50), nullable=False)  # bet, win, added, redeem

    amount = db.Column(db.Integer, nullable=False)
    balance_after = db.Column(db.Integer, nullable=False)

    label = db.Column(db.String(100))
    game_title = db.Column(db.String(100))
    note = db.Column(db.Text)

    game_type = db.Column(db.String(30), index=True)
    round_code = db.Column(db.String(80), index=True)
    table_number = db.Column(db.Integer)

    datetime = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class GameRound(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    round_code = db.Column(db.String(80), unique=True, nullable=False, index=True)
    game_type = db.Column(db.String(30), nullable=False, index=True)
    table_number = db.Column(db.Integer, nullable=False, index=True)

    started_at = db.Column(db.DateTime, nullable=False, index=True)
    ended_at = db.Column(db.DateTime, nullable=False, index=True)

    status = db.Column(db.String(20), default="finished", index=True)  # finished
    winning_number = db.Column(db.Integer)

    total_players = db.Column(db.Integer, default=0)
    total_bets = db.Column(db.Integer, default=0)
    total_payout = db.Column(db.Integer, default=0)


class GameBet(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)

    round_code = db.Column(db.String(80), nullable=False, index=True)
    game_type = db.Column(db.String(30), nullable=False, index=True)
    table_number = db.Column(db.Integer, nullable=False, index=True)

    number = db.Column(db.Integer, nullable=False)
    bet_amount = db.Column(db.Integer, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    resolved = db.Column(db.Boolean, default=False, index=True)
    winning_number = db.Column(db.Integer)
    status = db.Column(db.String(20))  # win / lose
    amount = db.Column(db.Integer, default=0)  # +payout or -bet_amount per bet
    resolved_at = db.Column(db.DateTime)


class LeaderLock(db.Model):
    """Prevent multiple Gunicorn workers from starting duplicate game threads."""
    id = db.Column(db.Integer, primary_key=True)  # always 1
    leader_id = db.Column(db.String(120), nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, index=True)


# ============================================================
# In-memory tables (live game state)
# ============================================================

game_tables = {}  # {game_type: [GameTable,...]}


# ============================================================
# Auth helpers
# ============================================================

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))

        user = User.query.get(session.get("user_id"))
        if not user:
            session.clear()
            return redirect(url_for("login_page"))

        if not user.is_admin:
            if request.path.startswith("/api/admin/"):
                return jsonify({"error": "Admin access required"}), 403
            session.clear()
            return redirect(url_for("login_page"))

        return f(*args, **kwargs)
    return decorated


def ensure_wallet_for_user(user: User) -> Wallet:
    """Only non-admin users have wallets."""
    if user.is_admin:
        return None
    if not user.wallet:
        w = Wallet(user_id=user.id, balance=10000)
        db.session.add(w)
        db.session.commit()
        return w
    return user.wallet


def generate_bot_name():
    prefixes = ["Amit", "Sanjay", "Riya", "Kunal", "Anita", "Rohit", "Meera", "Neeraj"]
    return f"{random.choice(prefixes)}{random.randint(100, 999)}"


# ============================================================
# GameTable
# ============================================================

class GameTable:
    def __init__(self, game_type: str, table_number: int, initial_delay: int = 0):
        self.game_type = game_type
        self.table_number = table_number
        self.config = GAME_CONFIGS[game_type]

        self.round_code = self._make_round_code()
        self.start_time = datetime.utcnow() + timedelta(seconds=initial_delay)
        self.end_time = self.start_time + timedelta(minutes=5)
        self.betting_close_time = self.end_time - timedelta(seconds=15)

        self.bets = []  # list of dicts: {user_id, username, number, is_bot, bet_amount, bet_time}
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False

        self.max_players = 6
        self.last_bot_added_at = None

    def _make_round_code(self):
        ts = int(time.time())
        return f"{self.game_type[0].upper()}{ts}{self.table_number}"

    def get_number_range(self):
        if self.game_type == "roulette":
            return list(range(37))
        return list(range(10))

    def get_time_remaining(self):
        now = datetime.utcnow()
        if now < self.start_time:
            return int((self.end_time - self.start_time).total_seconds())
        if now >= self.end_time:
            return 0
        return int((self.end_time - now).total_seconds())

    def get_slots_available(self):
        return self.max_players - len(self.bets)

    def is_started(self):
        return datetime.utcnow() >= self.start_time

    def add_bet_live(self, user_id, username, number, is_bot=False):
        """Only updates in-memory state. DB is handled outside."""
        try:
            number_int = int(number)
        except (TypeError, ValueError):
            return False, "Invalid number"

        # block duplicate number in the table
        for b in self.bets:
            if b["number"] == number_int:
                return False, "This number is already taken in this game. Please choose another."

        # max 4 bets per user per table/round
        if not is_bot:
            try:
                uid = int(user_id)
            except (TypeError, ValueError):
                uid = user_id
        else:
            uid = user_id

        user_bets = [b for b in self.bets if b["user_id"] == uid]
        if len(user_bets) >= 4:
            return False, "Maximum 4 bets per user"

        if len(self.bets) >= self.max_players:
            return False, "All slots are full"

        self.bets.append({
            "user_id": uid,
            "username": username,
            "number": number_int,
            "is_bot": is_bot,
            "bet_amount": int(self.config["bet_amount"]),
            "bet_time": datetime.utcnow(),
        })
        return True, "Bet placed successfully"

    def add_bot_bet(self):
        if len(self.bets) >= self.max_players:
            return False

        taken = {b["number"] for b in self.bets}
        available = [n for n in self.get_number_range() if n not in taken]
        if not available:
            return False

        bot_name = generate_bot_name()
        bot_number = random.choice(available)
        success, _ = self.add_bet_live(
            user_id=f"bot_{bot_name}",
            username=bot_name,
            number=bot_number,
            is_bot=True,
        )
        return success

    def calculate_result(self):
        """16% chance pick a real user bet; else random."""
        real_user_bets = [b for b in self.bets if not b["is_bot"]]
        if random.random() < 0.16 and real_user_bets:
            self.result = random.choice(real_user_bets)["number"]
        else:
            self.result = random.choice(self.get_number_range())
        return self.result

    def to_api_dict(self):
        bets_list = []
        for b in self.bets:
            bets_list.append({
                "user_id": str(b.get("user_id", "")),
                "username": b.get("username", "Unknown"),
                "number": b.get("number", 0),
            })

        return {
            "table_number": self.table_number,
            "game_type": self.game_type,
            "round_code": self.round_code,
            "players": len(bets_list),
            "bets": bets_list,
            "result": self.result,
            "max_players": self.max_players,
            "slots_available": self.get_slots_available(),
            "time_remaining": self.get_time_remaining(),
            "is_betting_closed": self.is_betting_closed,
            "is_finished": self.is_finished,
            "is_started": self.is_started(),
            "min_bet": int(self.config.get("bet_amount", 0)),
            "max_bet": int(self.config.get("payout", 0)),
            "status": "betting_closed" if self.is_betting_closed else "active",
        }


# ============================================================
# Leader lock (avoid duplicate threads on multi-worker)
# ============================================================

def _leader_id():
    return f"{os.environ.get('RENDER_SERVICE_NAME','service')}|pid={os.getpid()}|{secrets.token_hex(4)}"


def try_become_leader(stale_seconds: int = 25) -> bool:
    """Returns True if this process should run game threads."""
    now = datetime.utcnow()
    me = _leader_id()
    lock = LeaderLock.query.get(1)

    if not lock:
        lock = LeaderLock(id=1, leader_id=me, updated_at=now)
        db.session.add(lock)
        db.session.commit()
        return True

    # if existing leader heartbeat is recent, do not start threads
    if (now - lock.updated_at).total_seconds() < stale_seconds:
        return False

    # take over (stale leader)
    lock.leader_id = me
    lock.updated_at = now
    db.session.commit()
    return True


def start_leader_heartbeat(stop_event: threading.Event, interval: int = 5):
    def _hb():
        while not stop_event.is_set():
            try:
                with app.app_context():
                    lock = LeaderLock.query.get(1)
                    if lock:
                        lock.updated_at = datetime.utcnow()
                        db.session.commit()
            except Exception:
                pass
            stop_event.wait(interval)

    t = threading.Thread(target=_hb, daemon=True)
    t.start()


# ============================================================
# Game lifecycle threads
# ============================================================

def initialize_game_tables():
    for game_type in GAME_CONFIGS.keys():
        game_tables[game_type] = []
        for i in range(6):
            initial_delay = i * 60
            game_tables[game_type].append(GameTable(game_type, i + 1, initial_delay))


def _resolve_round_in_db(game_type: str, table: GameTable, ended_at: datetime):
    """Persist finished round + resolve bets + payout wallets + create transactions."""
    round_code = table.round_code
    winning = table.result

    # Store round history (so finished games remain visible)
    total_bets = sum(int(b.get("bet_amount", 0)) for b in table.bets)
    total_players = len(table.bets)

    # Resolve each real user bet from DB (one row per number bet)
    bets = GameBet.query.filter_by(round_code=round_code, game_type=game_type, table_number=table.table_number).all()

    winners_user_ids = []
    total_payout = 0

    for bet in bets:
        bet.resolved = True
        bet.winning_number = int(winning) if winning is not None else None
        bet.resolved_at = ended_at

        if winning is not None and bet.number == int(winning):
            bet.status = "win"
            bet.amount = int(GAME_CONFIGS[game_type]["payout"])
            winners_user_ids.append(bet.user_id)
            total_payout += int(GAME_CONFIGS[game_type]["payout"])
        else:
            bet.status = "lose"
            bet.amount = -int(bet.bet_amount)

    # Credit wallets for winners (one win tx per winning bet row)
    for bet in bets:
        if bet.status != "win":
            continue
        wallet = Wallet.query.filter_by(user_id=bet.user_id).first()
        if wallet:
            wallet.balance += int(GAME_CONFIGS[game_type]["payout"])
            win_tx = Transaction(
                user_id=bet.user_id,
                kind="win",
                amount=int(GAME_CONFIGS[game_type]["payout"]),
                balance_after=wallet.balance,
                label="Game Won",
                game_title=GAME_CONFIGS[game_type]["name"],
                note=f"Hit number {winning}",
                game_type=game_type,
                round_code=round_code,
                table_number=table.table_number,
            )
            db.session.add(win_tx)

    # Persist round snapshot
    existing = GameRound.query.filter_by(round_code=round_code).first()
    if not existing:
        db.session.add(GameRound(
            round_code=round_code,
            game_type=game_type,
            table_number=table.table_number,
            started_at=table.start_time,
            ended_at=ended_at,
            status="finished",
            winning_number=int(winning) if winning is not None else None,
            total_players=int(total_players),
            total_bets=int(total_bets),
            total_payout=int(total_payout),
        ))

    db.session.commit()


def manage_game_table(table: GameTable):
    with app.app_context():
        while True:
            try:
                now = datetime.utcnow()

                if now < table.start_time:
                    time.sleep(1)
                    continue

                # Add bots while open
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

                # Finish round
                if now >= table.end_time and not table.is_finished:
                    table.is_finished = True
                    table.calculate_result()

                    _resolve_round_in_db(table.game_type, table, ended_at=now)

                    # Small pause then reset to new round
                    time.sleep(2)

                    table.bets = []
                    table.result = None
                    table.is_betting_closed = False
                    table.is_finished = False
                    table.start_time = datetime.utcnow()
                    table.end_time = table.start_time + timedelta(minutes=5)
                    table.betting_close_time = table.end_time - timedelta(seconds=15)
                    table.round_code = table._make_round_code()
                    table.last_bot_added_at = None

                time.sleep(1)

            except Exception:
                time.sleep(1)


def start_all_game_threads():
    for _, tables in game_tables.items():
        for table in tables:
            threading.Thread(target=manage_game_table, args=(table,), daemon=True).start()


# ============================================================
# Public APIs (tables + user history)
# ============================================================

@app.route("/api/tables/<game_type>")
def api_tables_for_game(game_type):
    gt = (game_type or "").lower().strip()
    if gt not in GAME_CONFIGS:
        return jsonify({"error": "Invalid game type", "tables": []}), 404

    tables = game_tables.get(gt, [])
    out = [t.to_api_dict() for t in tables]
    return jsonify({"game_type": gt, "tables": out, "total_tables": len(out)}), 200


@app.route("/api/tables")
def api_tables_all():
    out = {}
    for gt, tables in game_tables.items():
        out[gt] = [t.to_api_dict() for t in tables]
    return jsonify(out), 200


@app.route("/api/user-games")
def api_user_games():
    """
    Returns:
    {
      current_games: [...],
      game_history: [...]
    }
    """
    user_id = request.args.get("user_id", type=int)
    if not user_id:
        return jsonify({"current_games": [], "game_history": []}), 200

    # Group bets by (game_type, round_code)
    bets = GameBet.query.filter_by(user_id=user_id).order_by(GameBet.created_at.desc()).limit(500).all()
    grouped = {}

    for b in bets:
        key = (b.game_type, b.round_code)
        if key not in grouped:
            grouped[key] = {
                "game_type": b.game_type,
                "round_code": b.round_code,
                "bet_amount": int(GAME_CONFIGS.get(b.game_type, {}).get("bet_amount", b.bet_amount)),
                "user_bets": [],
                "winning_number": None,
                "date_time": "",
                "status": None,
                "amount": 0,
                "time_remaining": None,
                "table_number": b.table_number,
            }

        grouped[key]["user_bets"].append(int(b.number))

        if b.resolved:
            # aggregate resolution
            grouped[key]["winning_number"] = b.winning_number
            grouped[key]["amount"] += int(b.amount or 0)

            # if any bet in this round wins => show win; else lose
            if grouped[key]["status"] != "win":
                grouped[key]["status"] = "win" if b.status == "win" else "lose"

            if b.resolved_at:
                grouped[key]["date_time"] = b.resolved_at.strftime("%Y-%m-%d %H:%M")

    all_games = list(grouped.values())

    # time_remaining only for unresolved current games (find live table by round_code)
    for g in all_games:
        if not g.get("status"):
            tables = game_tables.get(g["game_type"], [])
            for t in tables:
                if t.round_code == g["round_code"]:
                    g["time_remaining"] = t.get_time_remaining()
                    break

    game_history = [g for g in all_games if g.get("status")]
    current_games = [g for g in all_games if not g.get("status")]

    return jsonify({"current_games": current_games, "game_history": game_history}), 200


# ============================================================
# Pages (auth + main)
# ============================================================

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
        user = User.query.get(session.get("user_id"))
        if user and user.is_admin:
            return redirect(url_for("admin_panel"))
        return redirect(url_for("home"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login_post():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    remember_me = bool(data.get("remember_me", False))

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

    if user.is_blocked:
        return jsonify({"success": False, "message": f"Your account is blocked. Reason: {user.block_reason or 'No reason provided'}"}), 403

    if not user.is_admin:
        ensure_wallet_for_user(user)

    session["user_id"] = user.id
    session["username"] = user.username
    if remember_me:
        session.permanent = True

    token = secrets.token_urlsafe(32)
    redirect_url = url_for("admin_panel") if user.is_admin else url_for("home")

    return jsonify({"success": True, "user_id": user.id, "username": user.username, "token": token, "redirect": redirect_url}), 200


@app.route("/register", methods=["GET", "POST"])
def register_page():
    if request.method == "GET":
        if "user_id" in session:
            return redirect(url_for("home"))
        return render_template("register.html")

    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"}), 400
    if len(password) < 6:
        return jsonify({"success": False, "message": "Password must be at least 6 characters"}), 400

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

    return jsonify({"success": True, "user_id": user.id, "username": user.username, "redirect": url_for("home")}), 200


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


@app.route("/home")
@login_required
def home():
    user = User.query.get(session.get("user_id"))
    if user:
        ensure_wallet_for_user(user)
    return render_template("home.html", games=GAME_CONFIGS, username=session.get("username", "Player"))


@app.route("/game/<game_type>")
@login_required
def game_lobby(game_type):
    gt = (game_type or "").lower().strip()
    if gt not in GAME_CONFIGS:
        return "Game not found", 404
    return render_template("game-lobby.html", game_type=gt, game=GAME_CONFIGS[gt])


@app.route("/play/<game_type>")
@login_required
def play_game(game_type):
    gt = (game_type or "").lower().strip()
    if gt not in GAME_CONFIGS:
        return "Game not found", 404
    return render_template(f"{gt}-game.html", game_type=gt, game=GAME_CONFIGS[gt])


@app.route("/history")
@login_required
def history_page():
    return render_template("history.html")


@app.route("/profile")
@login_required
def profile_page():
    user = User.query.get(session.get("user_id"))
    if not user:
        return redirect(url_for("logout"))

    wallet = ensure_wallet_for_user(user)
    wallet_balance = wallet.balance if wallet else 0
    joined_at = user.created_at.strftime("%d %b %Y") if user.created_at else "Just now"

    txs = Transaction.query.filter_by(user_id=user.id).order_by(Transaction.datetime.desc()).limit(50).all()
    txns = []
    for t in txs:
        txns.append({
            "kind": t.kind,
            "amount": t.amount,
            "datetime": t.datetime.isoformat(),
            "label": t.label or t.kind.title(),
            "game_title": t.game_title or "",
            "note": t.note or "",
            "balance_after": t.balance_after,
        })

    return render_template(
        "profile.html",
        username=user.username,
        display_name=user.display_name or user.username,
        joined_at=joined_at,
        wallet_balance=wallet_balance,
        email=user.email or "",
        country=user.country or "",
        phone=user.phone or "",
        transactions=txns,
    )


@app.route("/profile/update", methods=["POST"])
@login_required
def profile_update():
    user = User.query.get(session.get("user_id"))
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    user.display_name = data.get("displayName", user.display_name or user.username)
    user.email = data.get("email", user.email or "")
    user.country = data.get("country", user.country or "")
    user.phone = data.get("phone", user.phone or "")
    db.session.commit()

    return jsonify({"success": True, "message": "Profile updated"}), 200


@app.route("/help")
@login_required
def help_page():
    return render_template("help.html")


@app.route("/coins", methods=["GET"])
@login_required
def coins_page():
    user = User.query.get(session.get("user_id"))
    if not user:
        return redirect(url_for("logout"))
    wallet = ensure_wallet_for_user(user)
    return render_template("coins.html", balance=(wallet.balance if wallet else 0))


@app.route("/api/balance", methods=["GET"])
@login_required
def api_balance():
    user = User.query.get(session.get("user_id"))
    if not user:
        return jsonify({"balance": 0}), 401
    wallet = ensure_wallet_for_user(user)
    return jsonify({"balance": wallet.balance if wallet else 0}), 200


@app.route("/api/coins/redeem", methods=["POST"])
@login_required
def redeem_coins():
    user = User.query.get(session.get("user_id"))
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 401

    data = request.get_json() or {}
    try:
        amount = int(data.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid amount"}), 400

    if amount <= 0:
        return jsonify({"success": False, "message": "Amount must be greater than 0"}), 400

    wallet = ensure_wallet_for_user(user)
    if not wallet or wallet.balance < amount:
        return jsonify({"success": False, "message": "Insufficient balance"}), 400

    wallet.balance -= amount

    tx = Transaction(
        user_id=user.id,
        kind="redeem",
        amount=amount,
        balance_after=wallet.balance,
        label="Redeem",
        game_title="",
        note="User redeemed coins",
    )
    db.session.add(tx)
    db.session.commit()

    return jsonify({"success": True, "message": f"Successfully redeemed {amount} coins!", "new_balance": wallet.balance}), 200


# ============================================================
# Admin Panel + Admin APIs (MATCHES your current admin_panel.html JS)
# ============================================================

@app.route("/admin")
@admin_required
def admin_panel():
    return render_template("admin_panel.html")


@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def api_admin_stats():
    # Keys returned to match your JS (totalusers, activegames, etc.)
    total_users = User.query.filter(User.is_admin == False).count()
    blocked_users = User.query.filter(User.is_admin == False, User.is_blocked == True).count()

    # Active games = live tables that are not finished
    active_games = sum(
        1 for tables in game_tables.values() for t in tables
        if (not t.is_finished)
    )

    # "Revenue" here = sum of all wallet balances (same as your old logic)
    total_balance = db.session.query(db.func.sum(Wallet.balance)).scalar() or 0

    # Deposits/withdrawals from Transaction table
    total_deposits = db.session.query(db.func.sum(Transaction.amount)).filter(Transaction.kind == "added").scalar() or 0
    total_withdrawals = db.session.query(db.func.sum(Transaction.amount)).filter(Transaction.kind == "redeem").scalar() or 0

    payload = {
        # match current admin_panel.html JS keys
        "totalusers": int(total_users),
        "totalagents": 0,
        "activegames": int(active_games),
        "totalrevenue": int(total_balance),
        "totaldeposits": int(total_deposits),
        "totalwithdrawals": int(total_withdrawals),

        # also provide snake_case (optional future use)
        "total_users": int(total_users),
        "blocked_users": int(blocked_users),
        "active_games": int(active_games),
        "total_revenue": int(total_balance),
        "total_deposit": int(total_deposits),
        "total_withdrawal": int(total_withdrawals),
    }
    return jsonify(payload), 200


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def api_admin_users():
    users = User.query.filter(User.is_admin == False).all()
    out = []

    for u in users:
        wallet = ensure_wallet_for_user(u)
        balance = wallet.balance if wallet else 0

        # gamesplayed = distinct rounds played
        games_played = (
            db.session.query(db.func.count(db.func.distinct(GameBet.round_code)))
            .filter(GameBet.user_id == u.id)
            .scalar()
            or 0
        )

        out.append({
            "id": u.id,
            "username": u.username,
            "email": u.email or "",
            "agentname": "-",  # placeholder to satisfy UI
            "passwordhash": u.password_hash,  # UI expects it (not recommended for real apps)
            "status": "blocked" if u.is_blocked else "active",
            "balance": int(balance),
            "gamesplayed": int(games_played),
            "createdat": u.created_at.strftime("%Y-%m-%d %H:%M") if u.created_at else "",
            "blockreason": u.block_reason or "",
        })

    return jsonify(out), 200


@app.route("/api/admin/users/<int:user_id>", methods=["PUT"])
@admin_required
def api_admin_update_user(user_id):
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
    if "blockreason" in data:
        user.block_reason = data["blockreason"]

    if "balance" in data:
        wallet = ensure_wallet_for_user(user)
        if wallet:
            try:
                wallet.balance = int(data["balance"])
            except (TypeError, ValueError):
                pass

    db.session.commit()
    return jsonify({"success": True, "message": "User updated successfully"}), 200


@app.route("/api/admin/users/<int:user_id>/block", methods=["POST"])
@admin_required
def api_admin_block_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    data = request.get_json() or {}
    user.is_blocked = True
    user.block_reason = data.get("reason", "Blocked by admin")
    db.session.commit()
    return jsonify({"success": True, "message": "User blocked successfully"}), 200


@app.route("/api/admin/users/<int:user_id>/unblock", methods=["POST"])
@admin_required
def api_admin_unblock_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    user.is_blocked = False
    user.block_reason = None
    db.session.commit()
    return jsonify({"success": True, "message": "User unblocked successfully"}), 200


@app.route("/api/admin/users/<int:user_id>/games", methods=["GET"])
@admin_required
def api_admin_user_games(user_id):
    # Group by round (so multiple number bets in same round show as ONE game card)
    bets = GameBet.query.filter_by(user_id=user_id).order_by(GameBet.created_at.desc()).limit(800).all()

    grouped = {}
    for b in bets:
        key = (b.game_type, b.round_code)
        if key not in grouped:
            grouped[key] = {
                "gametype": b.game_type,
                "roundcode": b.round_code,
                "numbers": [],
                "betamount": 0,
                "payout": 0,
                "status": None,
                "winningnumber": None,
                "gamedate": "",
            }

        grouped[key]["numbers"].append(int(b.number))
        grouped[key]["betamount"] += int(b.bet_amount)

        if b.resolved:
            grouped[key]["payout"] += int(b.amount or 0)
            if grouped[key]["status"] != "win":
                grouped[key]["status"] = "win" if b.status == "win" else "lose"
            grouped[key]["winningnumber"] = b.winning_number
            if b.resolved_at:
                grouped[key]["gamedate"] = b.resolved_at.strftime("%Y-%m-%d %H:%M")

    # If still active/unresolved, show bet time as date and keep payout undefined-like values away
    out = list(grouped.values())
    for g in out:
        if not g["gamedate"]:
            # attempt from round table start_time
            gr = GameRound.query.filter_by(round_code=g["roundcode"]).first()
            if gr:
                g["gamedate"] = gr.started_at.strftime("%Y-%m-%d %H:%M")
            else:
                # fallback
                g["gamedate"] = ""

        if g["status"] is None:
            g["payout"] = 0

    return jsonify(out), 200


@app.route("/api/admin/games", methods=["GET"])
@admin_required
def api_admin_games():
    """
    Return BOTH live active games and finished games (DB),
    using the field names your admin_panel.html expects.
    """
    out = []

    # Live tables
    game_type_order = list(GAME_CONFIGS.keys())
    for gt, tables in game_tables.items():
        for t in tables:
            # stable negative id for live entries
            try:
                gt_index = game_type_order.index(gt) + 1
            except ValueError:
                gt_index = 9
            live_id = -int(gt_index * 100 + t.table_number)

            started = t.start_time
            gamedate = started.strftime("%Y-%m-%d")
            gametime = started.strftime("%H:%M")

            out.append({
                "id": live_id,
                "roundcode": t.round_code,
                "gametype": gt,
                "players": len(t.bets),
                "maxplayers": t.max_players,
                "winningnumber": t.result if t.result is not None else None,
                "totalbets": sum(int(b.get("bet_amount", 0)) for b in t.bets),
                "payout": None,
                "gamedate": gamedate,
                "gametime": gametime,
                "status": "active" if (not t.is_finished and not t.is_betting_closed) else ("completed" if t.is_betting_closed else "finished"),
            })

    # Finished games from DB (latest 200)
    rounds = GameRound.query.order_by(GameRound.ended_at.desc()).limit(200).all()
    for r in rounds:
        out.append({
            "id": int(r.id),
            "roundcode": r.round_code,
            "gametype": r.game_type,
            "players": int(r.total_players),
            "maxplayers": 6,
            "winningnumber": r.winning_number,
            "totalbets": int(r.total_bets),
            "payout": int(r.total_payout),
            "gamedate": r.ended_at.strftime("%Y-%m-%d"),
            "gametime": r.ended_at.strftime("%H:%M"),
            "status": "finished",
        })

    return jsonify(out), 200


@app.route("/api/admin/transactions", methods=["GET"])
@admin_required
def api_admin_transactions():
    txs = Transaction.query.order_by(Transaction.datetime.desc()).limit(500).all()
    out = []

    # map to admin_panel.html expected keys: txnid, username, type, amount, status, txndate, reference
    for t in txs:
        u = User.query.get(t.user_id)
        out.append({
            "txnid": int(t.id),
            "username": (u.username if u else f"user_{t.user_id}"),
            "type": (t.kind or "").upper(),
            "amount": int(t.amount),
            "status": "DONE" if t.kind in ("bet", "win", "added", "redeem") else "PENDING",
            "txndate": t.datetime.strftime("%Y-%m-%d %H:%M"),
            "reference": (t.game_title or t.round_code or "-"),
        })

    return jsonify(out), 200


@app.route("/api/admin/wallet", methods=["GET"])
@admin_required
def api_admin_wallet():
    # Return list of users (UI expects an array)
    users = User.query.filter(User.is_admin == False).all()
    out = []
    for u in users:
        wallet = ensure_wallet_for_user(u)
        balance = wallet.balance if wallet else 0

        deposits = db.session.query(db.func.sum(Transaction.amount)).filter(
            Transaction.user_id == u.id, Transaction.kind == "added"
        ).scalar() or 0

        withdrawals = db.session.query(db.func.sum(Transaction.amount)).filter(
            Transaction.user_id == u.id, Transaction.kind == "redeem"
        ).scalar() or 0

        out.append({
            "username": u.username,
            "balance": int(balance),
            "totaldeposits": int(deposits),
            "totalwithdrawals": int(withdrawals),
        })

    return jsonify(out), 200


@app.route("/api/admin/wallet/add", methods=["POST"])
@admin_required
def api_admin_wallet_add():
    data = request.get_json() or {}
    username = (data.get("user") or "").strip()
    reason = data.get("reason", "Admin add funds")
    try:
        amount = int(float(data.get("amount", 0)))
    except (TypeError, ValueError):
        amount = 0

    if not username or amount <= 0:
        return jsonify({"success": False, "message": "Invalid user or amount"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or user.is_admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    wallet = ensure_wallet_for_user(user)
    wallet.balance += amount

    tx = Transaction(
        user_id=user.id,
        kind="added",
        amount=amount,
        balance_after=wallet.balance,
        label="Admin Added",
        game_title="Wallet",
        note=reason,
    )
    db.session.add(tx)
    db.session.commit()

    return jsonify({"success": True, "message": "Funds added", "newbalance": wallet.balance}), 200


@app.route("/api/admin/wallet/deduct", methods=["POST"])
@admin_required
def api_admin_wallet_deduct():
    data = request.get_json() or {}
    username = (data.get("user") or "").strip()
    reason = data.get("reason", "Admin deduct funds")
    try:
        amount = int(float(data.get("amount", 0)))
    except (TypeError, ValueError):
        amount = 0

    if not username or amount <= 0:
        return jsonify({"success": False, "message": "Invalid user or amount"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or user.is_admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    wallet = ensure_wallet_for_user(user)
    if wallet.balance < amount:
        return jsonify({"success": False, "message": "Insufficient balance"}), 400

    wallet.balance -= amount

    tx = Transaction(
        user_id=user.id,
        kind="redeem",
        amount=amount,
        balance_after=wallet.balance,
        label="Admin Deducted",
        game_title="Wallet",
        note=reason,
    )
    db.session.add(tx)
    db.session.commit()

    return jsonify({"success": True, "message": "Funds deducted", "newbalance": wallet.balance}), 200


# Placeholders (keep UI happy)
@app.route("/api/admin/agents", methods=["GET", "POST"])
@admin_required
def api_admin_agents():
    if request.method == "GET":
        return jsonify([]), 200
    return jsonify({"success": True, "message": "Agent saved (placeholder)"}), 200


@app.route("/api/admin/referrals", methods=["GET"])
@admin_required
def api_admin_referrals():
    return jsonify([]), 200


@app.route("/api/admin/promos", methods=["GET", "POST"])
@admin_required
def api_admin_promos():
    if request.method == "GET":
        return jsonify([]), 200
    return jsonify({"success": True, "message": "Promo saved (placeholder)"}), 200


@app.route("/api/admin/announcements", methods=["GET", "POST"])
@admin_required
def api_admin_announcements():
    if request.method == "GET":
        return jsonify([]), 200
    return jsonify({"success": True, "message": "Announcement saved (placeholder)"}), 200


@app.route("/api/admin/reports", methods=["GET"])
@admin_required
def api_admin_reports():
    return jsonify({
        "newusers30d": 0,
        "revenue30d": 0,
        "gamesplayed30d": 0,
        "avgwinrate": 0,
    }), 200


# ============================================================
# Socket.IO: live betting
# ============================================================

@socketio.on("connect")
def on_connect():
    emit("connection_response", {"data": "Connected"})


@socketio.on("disconnect")
def on_disconnect():
    return


@socketio.on("join_game")
def on_join_game(data):
    game_type = (data.get("game_type") or "").lower().strip()
    join_room(game_type)


@socketio.on("place_bet")
def on_place_bet(data):
    game_type = (data.get("game_type") or "").lower().strip()
    raw_user_id = data.get("user_id")
    username = data.get("username") or "Player"
    number = data.get("number")
    round_code = data.get("round_code")

    if game_type not in GAME_CONFIGS:
        emit("bet_error", {"message": "Invalid game type"})
        return

    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        emit("bet_error", {"message": "Invalid user"})
        return

    user = User.query.get(user_id)
    if not user:
        emit("bet_error", {"message": "User not found"})
        return

    if user.is_blocked:
        emit("bet_error", {"message": f"Your account is blocked. Reason: {user.block_reason or 'No reason provided'}"})
        return

    wallet = ensure_wallet_for_user(user)
    if not wallet:
        emit("bet_error", {"message": "Admin cannot place bets"})
        return

    tables = game_tables.get(game_type, [])
    if not tables:
        emit("bet_error", {"message": "No tables for this game"})
        return

    # choose table
    table = None
    if round_code:
        for t in tables:
            if t.round_code == round_code:
                table = t
                break
        if not table:
            emit("bet_error", {"message": "This game round is no longer available. Please join a new game."})
            return
    else:
        for t in tables:
            if (not t.is_betting_closed) and (not t.is_finished) and (len(t.bets) < t.max_players):
                table = t
                break
        if not table:
            emit("bet_error", {"message": "No open game table"})
            return

    if table.is_finished or table.is_betting_closed:
        emit("bet_error", {"message": "Betting is closed for this game"})
        return

    bet_amount = int(table.config["bet_amount"])
    if wallet.balance < bet_amount:
        emit("bet_error", {"message": "Insufficient balance"})
        return

    # add to live table (validations: duplicate number, max bets/user, slots)
    success, message = table.add_bet_live(user_id=user_id, username=username, number=number, is_bot=False)
    if not success:
        emit("bet_error", {"message": message})
        return

    # deduct + persist bet in DB
    wallet.balance -= bet_amount

    # store bet row (one per number)
    bet_row = GameBet(
        user_id=user_id,
        round_code=table.round_code,
        game_type=game_type,
        table_number=table.table_number,
        number=int(number),
        bet_amount=bet_amount,
        resolved=False,
    )
    db.session.add(bet_row)

    bet_tx = Transaction(
        user_id=user_id,
        kind="bet",
        amount=bet_amount,
        balance_after=wallet.balance,
        label="Bet Placed",
        game_title=table.config["name"],
        note=f"Number {number}",
        game_type=game_type,
        round_code=table.round_code,
        table_number=table.table_number,
    )
    db.session.add(bet_tx)

    db.session.commit()

    # Build players data to broadcast (same structure your front-end expects)
    players_data = []
    for b in table.bets:
        players_data.append({
            "user_id": str(b["user_id"]),
            "username": b["username"],
            "number": b["number"],
        })

    emit("bet_success", {
        "message": message,
        "new_balance": wallet.balance,
        "round_code": table.round_code,
        "table_number": table.table_number,
        "players": players_data,
        "slots_available": table.get_slots_available(),
    })

    emit("update_table", {
        "game_type": game_type,
        "table_number": table.table_number,
        "round_code": table.round_code,
        "players": players_data,
        "slots_available": table.get_slots_available(),
        "time_remaining": table.get_time_remaining(),
        "is_betting_closed": table.is_betting_closed,
    }, broadcast=True, include_self=True)


# ============================================================
# Seed users
# ============================================================

def seed_demo_users():
    demo_usernames = ["demo"] + [f"demo{i}" for i in range(1, 6)]
    for uname in demo_usernames:
        u = User.query.filter_by(username=uname).first()
        if not u:
            u = User(username=uname, display_name=uname)
            u.set_password("demo123")
            db.session.add(u)
            db.session.commit()
        ensure_wallet_for_user(u)

    admin = User.query.filter_by(username="admin").first()
    if not admin:
        admin = User(username="admin", display_name="Admin User", is_admin=True)
        admin.set_password("admin123")
        db.session.add(admin)
        db.session.commit()
    else:
        if not admin.is_admin:
            admin.is_admin = True
            db.session.commit()


# ============================================================
# Startup (works with Gunicorn/Render)
# ============================================================

_leader_stop_event = threading.Event()

with app.app_context():
    db.create_all()
    seed_demo_users()
    initialize_game_tables()

    if try_become_leader():
        start_leader_heartbeat(_leader_stop_event, interval=5)
        start_all_game_threads()


# Local development only
if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False,
        allow_unsafe_werkzeug=True,
    )
