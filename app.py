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
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo
from functools import wraps
from sqlalchemy import func
from werkzeug.utils import secure_filename
import threading
import random
import time
import os
import hashlib
import secrets
import re

# ---------------------------------------------------
# Flask / DB / Socket setup
# ---------------------------------------------------

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "your-secret-key-here-change-this-in-production")
app.config["PROPAGATE_EXCEPTIONS"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

# DB config - uses sqlite in current directory
database_url = os.environ.get("DATABASE_URL", "").strip()

if database_url:
    if database_url.startswith("mysql://"):
        database_url = database_url.replace("mysql://", "mysql+pymysql://", 1)
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

@app.after_request
def no_cache(resp):
    # Allow static files to be cached normally
    if request.path.startswith("/static"):
        return resp

    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


# ---------------------------------------------------
# Super Admin credentials (CHANGE THESE!)
# ---------------------------------------------------

SUPERADMIN_USERNAME = "superadmin"  # âœ… Change this
SUPERADMIN_PASSWORD = "SuperPass@2026"  # âœ… Change this
APP_TIMEZONE = "Asia/Kolkata"
IST = ZoneInfo("Asia/Kolkata")

STORE_API_SECRET = os.environ.get("STORE_API_SECRET", "change-this-store-secret-now")

def as_utc(dt: datetime) -> datetime:
    # Treat naive datetimes as UTC (your code uses datetime.utcnow() everywhere)
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def as_ist(dt: datetime) -> datetime:
    if dt is None:
        return None
    return as_utc(dt).astimezone(IST)

def fmt_ist(dt: datetime, fmt: str = "%Y-%m-%d %H:%M") -> str:
    d = as_ist(dt)
    return d.strftime(fmt) if d else ""


# forced_winners: (game_type, round_code) -> int forced_number
forced_winners = {}

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
        "emoji": "ðŸ¸",
    },
    "gold": {
        "bet_amount": 50,
        "payout": 250,
        "name": "Gold Game",
        "type": "number",
        "title": "Football Goal",
        "emoji": "âš½",
    },
    "diamond": {
        "bet_amount": 100,
        "payout": 500,
        "name": "Diamond Game",
        "type": "number",
        "title": "Archer Hit",
        "emoji": "ðŸ¹",
    },
    "platinum": {
        "bet_amount": 200,
        "payout": 1000,
        "name": "Platinum Game",
        "type": "number",
        "title": "Parachute Drop",
        "emoji": "ðŸª‚",
    },
    "roulette": {
    "bet_amount": 250,
    "payout": 5000,
    "name": "Roulette Game",
    "type": "roulette",
    "title": "Roulette Spin",
    "emoji": "🎡",
    },
}
ALLOWED_CARD_VALUES = {10, 50, 100, 200, 250}
ALLOWEDCARDVALUES = ALLOWED_CARD_VALUES
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

    agentid = db.Column(db.Integer, db.ForeignKey('agent.id'), nullable=True, index=True)
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
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)

    subject = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(100), default="General")
    message = db.Column(db.Text, nullable=False)

    status = db.Column(db.String(20), default="OPEN", index=True)   # OPEN / IN_PROGRESS / WAITING_USER / RESOLVED / CLOSED
    priority = db.Column(db.String(20), default="NORMAL")

    attachment_name = db.Column(db.String(255))
    attachment_path = db.Column(db.String(500))

    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    last_reply_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    closed_at = db.Column(db.DateTime)
    closed_by_role = db.Column(db.String(20))
    closed_by_name = db.Column(db.String(120))

    updates = db.relationship(
        "TicketUpdate",
        backref="ticket",
        lazy=True,
        cascade="all, delete-orphan",
        order_by="TicketUpdate.created_at.asc()"
    )


class TicketUpdate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("ticket.id"), nullable=False, index=True)

    actor_role = db.Column(db.String(20), nullable=False)   # USER / ADMIN / SUBADMIN / SYSTEM
    actor_name = db.Column(db.String(120))

    update_type = db.Column(db.String(20), nullable=False)  # CREATED / REPLY / STATUS / NOTE / CLOSED / REOPENED
    old_status = db.Column(db.String(20))
    new_status = db.Column(db.String(20))

    message = db.Column(db.Text)
    is_internal = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)



class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    kind = db.Column(db.String(50), nullable=False)  # 'bet', 'win', 'added', 'redeem'
    amount = db.Column(db.Integer, nullable=False)
    balance_after = db.Column(db.Integer, nullable=False)
    label = db.Column(db.String(100))
    game_title = db.Column(db.String(100))
    note = db.Column(db.Text)
    datetime = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class GameRoundHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    roundcode = db.Column(db.String(120), unique=True, nullable=False, index=True)
    gametype = db.Column(db.String(50), nullable=False, index=True)
    tablenumber = db.Column(db.Integer, nullable=False)
    startedat = db.Column(db.DateTime, nullable=False, index=True)
    endedat = db.Column(db.DateTime, nullable=False, index=True)
    result = db.Column(db.Integer)  # winning number
    status = db.Column(db.String(20), default="finished")
    players = db.Column(db.Integer, default=0)
    maxplayers = db.Column(db.Integer, default=0)
    totalbets = db.Column(db.Integer, default=0)
    createdat = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class GameRoundBet(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    roundcode = db.Column(db.String(120), nullable=False, index=True)
    gametype = db.Column(db.String(50), nullable=False, index=True)
    tablenumber = db.Column(db.Integer, nullable=False)
    userid = db.Column(db.String(80))  # keep string because bots are "botXYZ"
    username = db.Column(db.String(120), nullable=False, index=True)
    number = db.Column(db.Integer, nullable=False)
    betamount = db.Column(db.Integer, default=0)
    isbot = db.Column(db.Boolean, default=False)
    bettime = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class SubAdmin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    phone = db.Column(db.String(20))  # NEW
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password: str):
        self.password_hash = hashlib.sha256(password.encode()).hexdigest()

    def check_password(self, password: str) -> bool:
        return self.password_hash == hashlib.sha256(password.encode()).hexdigest()




class ForcedWinnerHistory(db.Model):
    """History of all forced winner bets set by Super Admin"""
    id = db.Column(db.Integer, primary_key=True)
    round_code = db.Column(db.String(100), nullable=False, index=True)
    game_type = db.Column(db.String(50), nullable=False)
    game_name = db.Column(db.String(100))
    table_number = db.Column(db.Integer)
    forced_number = db.Column(db.Integer, nullable=False)
    round_start_time = db.Column(db.DateTime, nullable=False)
    forced_at = db.Column(db.DateTime, default=datetime.utcnow)
    forced_by = db.Column(db.String(100))
    status = db.Column(db.String(20), default="active")  # active, cleared, executed
    note = db.Column(db.Text)

class UserWinControl(db.Model):
    __tablename__ = "user_win_control"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    game_type = db.Column(db.String(50), nullable=False, index=True)
    played_rounds = db.Column(db.Integer, default=0, nullable=False)
    loss_streak = db.Column(db.Integer, default=0, nullable=False)
    total_wins = db.Column(db.Integer, default=0, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("user_id", "game_type", name="uq_user_win_control_user_game"),
    )

class Agent(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    passwordhash = db.Column(db.String(128), nullable=False)

    salarypercent = db.Column(db.Float, default=0.0)
    isblocked = db.Column(db.Boolean, default=False)
    blockreason = db.Column(db.Text)
    createdat = db.Column(db.DateTime, default=datetime.utcnow)

    def setpassword(self, password: str):
        self.passwordhash = hashlib.sha256(password.encode()).hexdigest()

    def checkpassword(self, password: str) -> bool:
        return self.passwordhash == hashlib.sha256(password.encode()).hexdigest()

class AgentSalaryPayment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    agentid = db.Column(db.Integer, db.ForeignKey('agent.id'), nullable=False, index=True)
    amountpaid = db.Column(db.Float, nullable=False, default=0)
    periodfrom = db.Column(db.Date, nullable=True)
    periodto = db.Column(db.Date, nullable=True)
    note = db.Column(db.Text, nullable=True)
    referenceno = db.Column(db.String(120), nullable=True)
    paidby = db.Column(db.String(120), nullable=True)
    paidat = db.Column(db.DateTime, default=datetime.utcnow, index=True)



class AgentBlockPeriod(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    agentid = db.Column(db.Integer, db.ForeignKey('agent.id'), nullable=False, index=True)
    startat = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    endat = db.Column(db.DateTime, nullable=True)  # null => still blocked


class StoreWallet(db.Model):
    __tablename__ = "store_wallet"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, unique=True, index=True)
    balance = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class StoreTransaction(db.Model):
    __tablename__ = "store_transaction"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    kind = db.Column(db.String(50), nullable=False, index=True)
    amount = db.Column(db.Integer, nullable=False)
    balance_after = db.Column(db.Integer, nullable=False)
    label = db.Column(db.String(120))
    note = db.Column(db.Text)
    reference = db.Column(db.String(120), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)


class Product(db.Model):
    __tablename__ = "product"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(220), unique=True, nullable=False, index=True)
    description = db.Column(db.Text)
    price = db.Column(db.Integer, nullable=False)
    stock = db.Column(db.Integer, default=0, nullable=False)
    image_url = db.Column(db.String(500))
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class UserAddress(db.Model):
    __tablename__ = "user_address"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    full_name = db.Column(db.String(150), nullable=False)
    phone = db.Column(db.String(30), nullable=False)
    line1 = db.Column(db.String(250), nullable=False)
    line2 = db.Column(db.String(250))
    city = db.Column(db.String(120), nullable=False)
    state = db.Column(db.String(120), nullable=False)
    pincode = db.Column(db.String(20), nullable=False)
    country = db.Column(db.String(100), default="India", nullable=False)
    is_default = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class StoreOrder(db.Model):
    __tablename__ = "store_order"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    address_id = db.Column(db.Integer, db.ForeignKey("user_address.id"), nullable=True, index=True)
    order_code = db.Column(db.String(60), unique=True, nullable=False, index=True)
    subtotal = db.Column(db.Integer, nullable=False, default=0)
    total = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(30), default="PLACED", nullable=False, index=True)
    payment_mode = db.Column(db.String(30), default="STORE_WALLET", nullable=False)
    note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)


class StoreOrderItem(db.Model):
    __tablename__ = "store_order_item"

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("store_order.id"), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False, index=True)
    product_title = db.Column(db.String(200), nullable=False)
    unit_price = db.Column(db.Integer, nullable=False)
    qty = db.Column(db.Integer, nullable=False, default=1)
    line_total = db.Column(db.Integer, nullable=False)


class PointCardPurchase(db.Model):
    __tablename__ = "point_card_purchase"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    card_value = db.Column(db.Integer, nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=1)
    total_coins = db.Column(db.Integer, nullable=False)
    payment_status = db.Column(db.String(30), default="PAID", nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)


class WalletTransfer(db.Model):
    __tablename__ = "wallet_transfer"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    direction = db.Column(db.String(30), nullable=False, index=True)
    amount = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(30), default="SUCCESS", nullable=False, index=True)
    note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)



import sqlite3

def migrate_ticket_schema():
    conn = sqlite3.connect(os.path.join(os.path.dirname(__file__), "game.db"))
    cur = conn.cursor()

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ticket'")
    ticket_exists = cur.fetchone() is not None

    if not ticket_exists:
        conn.commit()
        conn.close()
        return

    cur.execute("PRAGMA table_info(ticket)")
    existing = {row[1] for row in cur.fetchall()}

    add_columns = [
    ("category", "TEXT DEFAULT 'General'"),
    ("priority", "TEXT DEFAULT 'NORMAL'"),
    ("attachment_name", "TEXT"),
    ("attachment_path", "TEXT"),
    ("last_reply_at", "DATETIME"),
    ("closed_at", "DATETIME"),
    ("closed_by_role", "TEXT"),
    ("closed_by_name", "TEXT"),
  ]

    for col, ddl in add_columns:
        if col not in existing:
            cur.execute(f"ALTER TABLE ticket ADD COLUMN {col} {ddl}")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS ticket_update (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            actor_role TEXT NOT NULL,
            actor_name TEXT,
            update_type TEXT NOT NULL,
            old_status TEXT,
            new_status TEXT,
            message TEXT,
            is_internal INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("UPDATE ticket SET status='OPEN' WHERE status IS NULL OR lower(status)='open'")

    cur.execute("PRAGMA table_info(ticket)")
    existing_after = {row[1] for row in cur.fetchall()}
    if "last_reply_at" in existing_after:
        cur.execute("UPDATE ticket SET last_reply_at=COALESCE(last_reply_at, updated_at, created_at)")

    conn.commit()
    conn.close()

def migrate_subadmin_phone_column():
    conn = sqlite3.connect(os.path.join(os.path.dirname(__file__), "game.db"))
    cur = conn.cursor()

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_admin'")
    row = cur.fetchone()

    if row:
        table_name = 'sub_admin'
    else:
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='subadmin'")
        row = cur.fetchone()
        table_name = 'subadmin' if row else None

    if not table_name:
        conn.commit()
        conn.close()
        return

    cur.execute(f"PRAGMA table_info({table_name})")
    existing = {r[1] for r in cur.fetchall()}

    if "phone" not in existing:
        cur.execute(f"ALTER TABLE {table_name} ADD COLUMN phone TEXT")

    conn.commit()
    conn.close()

def migrate_user_win_control_table():
    conn = sqlite3.connect(os.path.join(os.path.dirname(__file__), "game.db"))
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_win_control (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_type TEXT NOT NULL,
            played_rounds INTEGER DEFAULT 0 NOT NULL,
            loss_streak INTEGER DEFAULT 0 NOT NULL,
            total_wins INTEGER DEFAULT 0 NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
    """)

    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_user_win_control_user_game
        ON user_win_control(user_id, game_type)
    """)

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_win_control_user_id
        ON user_win_control(user_id)
    """)

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_win_control_game_type
        ON user_win_control(game_type)
    """)

    conn.commit()
    conn.close()

# =========================================================
# AGENT COMMISSION HELPERS
# Commission is counted ONLY when the agent is not blocked.
# =========================================================

def _safe_int(v, default=0):
    try:
        return int(v or 0)
    except Exception:
        return default


def _parse_from_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None

def _to_date(v):
    if not v:
        return None
    if isinstance(v, date):
        return v
    if isinstance(v, datetime):
        return v.date()
    return None


def _safe_float(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _payment_total(agent_id, from_dt=None, to_dt=None):
    q = AgentSalaryPayment.query.filter_by(agentid=agent_id)

    if from_dt:
        q = q.filter(AgentSalaryPayment.paidat >= from_dt)
    if to_dt:
        q = q.filter(AgentSalaryPayment.paidat < to_dt)

    return round(sum(_safe_float(r.amountpaid) for r in q.all()), 2)



def _parse_to_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)
    except ValueError:
        return None


def _merge_time_ranges(ranges):
    cleaned = []
    for start, end in ranges:
        if not start or not end or end <= start:
            continue
        cleaned.append((start, end))

    cleaned.sort(key=lambda x: x[0])
    merged = []

    for start, end in cleaned:
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            if end > merged[-1][1]:
                merged[-1][1] = end

    return [(s, e) for s, e in merged]


def _get_agent_block_ranges(agent_id, from_dt=None, to_dt=None):
    now = datetime.utcnow()
    periods = (
        AgentBlockPeriod.query
        .filter_by(agentid=agent_id)
        .order_by(AgentBlockPeriod.startat.asc())
        .all()
    )

    ranges = []
    for p in periods:
        start = p.startat or now
        end = p.endat or now

        if from_dt and end <= from_dt:
            continue
        if to_dt and start >= to_dt:
            continue

        if from_dt and start < from_dt:
            start = from_dt
        if to_dt and end > to_dt:
            end = to_dt

        if end > start:
            ranges.append((start, end))

    return _merge_time_ranges(ranges)


def _dt_in_ranges(dt_value, ranges):
    if not dt_value:
        return False
    for start, end in ranges:
        if start <= dt_value < end:
            return True
    return False


def _tx_user_col():
    return getattr(Transaction, "user_id", None) or getattr(Transaction, "userid", None)


def _tx_datetime_col():
    return getattr(Transaction, "datetime", None) or getattr(Transaction, "created_at", None)


def _get_agent_users(agent_id):
    return User.query.filter_by(agentid=agent_id).all()


def _build_agent_commission_data(agent, from_dt=None, to_dt=None, include_history=False, limit=200):
    users = _get_agent_users(agent.id)
    user_ids = [int(u.id) for u in users]
    user_map = {int(u.id): u for u in users}

    percent = float(agent.salarypercent or 0)
    out = {
        "usercount": len(users),
        "rawplayed": 0,
        "eligibleplayed": 0,
        "blockedplayed": 0,
        "totalsalary": 0.0,
        "blockedsalary": 0.0,
        "items": [],
        "history": []
    }

    if not user_ids:
        return out

    tx_user_col = _tx_user_col()
    tx_dt_col = _tx_datetime_col()
    if tx_user_col is None or tx_dt_col is None:
        return out

    blocked_ranges = _get_agent_block_ranges(agent.id, from_dt, to_dt)

    q = (
        db.session.query(Transaction)
        .filter(tx_user_col.in_(user_ids))
        .filter(func.lower(Transaction.kind) == "bet")
    )

    if from_dt:
        q = q.filter(tx_dt_col >= from_dt)
    if to_dt:
        q = q.filter(tx_dt_col < to_dt)

    txs = q.order_by(tx_dt_col.asc()).all()

    per_user = {}
    for u in users:
        uid = int(u.id)
        per_user[uid] = {
            "userid": uid,
            "username": u.username,
            "joining": fmt_ist(_get_created_at(u), "%Y-%m-%d %H:%M") if _get_created_at(u) else "",
            "rawplayed": 0,
            "eligibleplayed": 0,
            "blockedplayed": 0,
            "salarygenerated": 0.0,
            "blockedsalary": 0.0,
        }

    history_rows = []

    for tx in txs:
        uid_raw = getattr(tx, "user_id", None)
        if uid_raw is None:
            uid_raw = getattr(tx, "userid", None)

        try:
            uid = int(uid_raw)
        except Exception:
            continue

        amount = _safe_int(getattr(tx, "amount", 0), 0)
        tx_dt = getattr(tx, "datetime", None) or getattr(tx, "created_at", None) or datetime.utcnow()
        is_blocked_tx = _dt_in_ranges(tx_dt, blocked_ranges)
        commission_amount = round((amount * percent) / 100.0, 2)

        out["rawplayed"] += amount
        per_user[uid]["rawplayed"] += amount

        if is_blocked_tx:
            out["blockedplayed"] += amount
            out["blockedsalary"] += commission_amount
            per_user[uid]["blockedplayed"] += amount
            per_user[uid]["blockedsalary"] += commission_amount
            status = "BLOCKED_NO_COMMISSION"
        else:
            out["eligibleplayed"] += amount
            out["totalsalary"] += commission_amount
            per_user[uid]["eligibleplayed"] += amount
            per_user[uid]["salarygenerated"] += commission_amount
            status = "COUNTED"

        if include_history:
            history_rows.append({
                "txnid": tx.id,
                "userid": uid,
                "username": user_map.get(uid).username if user_map.get(uid) else f"user_{uid}",
                "amountplayed": amount,
                "commissionamount": commission_amount,
                "status": status,
                "datetime": fmt_ist(tx_dt, "%Y-%m-%d %H:%M:%S") if tx_dt else "",
                "label": tx.label or "",
                "game_title": tx.game_title or "",
                "note": tx.note or "",
                "_raw_dt": tx_dt,
            })

    items = []
    for row in per_user.values():
        row["salarygenerated"] = round(row["salarygenerated"], 2)
        row["blockedsalary"] = round(row["blockedsalary"], 2)
        items.append(row)

    items.sort(key=lambda x: (x.get("username") or "").lower())

    out["totalsalary"] = round(out["totalsalary"], 2)
    out["blockedsalary"] = round(out["blockedsalary"], 2)
    out["items"] = items

    if include_history:
        history_rows.sort(key=lambda x: x["_raw_dt"], reverse=True)
        for row in history_rows[:limit]:
            row.pop("_raw_dt", None)
        out["history"] = history_rows[:limit]

    return out




# ---------------------------------------------------
# In-memory structures
# ---------------------------------------------------

game_tables = {}
user_game_history = {}

CONTROL_RULES = {
    "silver": {"due_after_losses": 6, "target_real_win_rate": 0.10},
    "gold": {"due_after_losses": 6, "target_real_win_rate": 0.10},
    "diamond": {"due_after_losses": 6, "target_real_win_rate": 0.10},
    "platinum": {"due_after_losses": 6, "target_real_win_rate": 0.10},
    "roulette": {"due_after_losses": 24, "target_real_win_rate": 0.04},
}

def get_or_create_user_win_control(user_id, game_type):
    row = UserWinControl.query.filter_by(user_id=int(user_id), game_type=game_type).first()
    if not row:
        row = UserWinControl(
            user_id=int(user_id),
            game_type=game_type,
            played_rounds=0,
            loss_streak=0,
            total_wins=0,
        )
        db.session.add(row)
        db.session.flush()
    return row

def choose_controlled_winner_user(table):
    real_bets = [b for b in (table.bets or []) if not b.get("is_bot")]
    if not real_bets:
        return None

    per_user = {}
    for bet in real_bets:
        try:
            uid = int(bet.get("user_id"))
            num = int(bet.get("number"))
        except Exception:
            continue
        per_user.setdefault(uid, set()).add(num)

    if not per_user:
        return None

    rule = CONTROL_RULES.get(
        table.game_type,
        {"due_after_losses": 6, "target_real_win_rate": 0.16}
    )
    due_after_losses = int(rule["due_after_losses"])
    target_rate = float(rule["target_real_win_rate"])

    due_users = []
    all_users = []

    for uid, numbers in per_user.items():
        ctrl = get_or_create_user_win_control(uid, table.game_type)
        item = {
            "user_id": uid,
            "numbers": sorted(numbers),
            "loss_streak": int(ctrl.loss_streak or 0),
            "played_rounds": int(ctrl.played_rounds or 0),
        }
        all_users.append(item)

        if item["loss_streak"] >= due_after_losses:
            due_users.append(item)

    if due_users:
        due_users.sort(key=lambda x: (-x["loss_streak"], x["played_rounds"], x["user_id"]))
        return due_users[0]

    if all_users and random.random() < target_rate:
        all_users.sort(key=lambda x: (-x["loss_streak"], x["played_rounds"], x["user_id"]))
        return all_users[0]

    return None

def update_user_win_control_after_round(table, result_number):
    real_bets = [b for b in (table.bets or []) if not b.get("is_bot")]
    if not real_bets:
        return

    per_user_numbers = {}
    for bet in real_bets:
        try:
            uid = int(bet.get("user_id"))
            num = int(bet.get("number"))
        except Exception:
            continue
        per_user_numbers.setdefault(uid, set()).add(num)

    if not per_user_numbers:
        return

    for uid, numbers in per_user_numbers.items():
        ctrl = get_or_create_user_win_control(uid, table.game_type)
        ctrl.played_rounds = int(ctrl.played_rounds or 0) + 1

        if int(result_number) in numbers:
            ctrl.loss_streak = 0
            ctrl.total_wins = int(ctrl.total_wins or 0) + 1
        else:
            ctrl.loss_streak = int(ctrl.loss_streak or 0) + 1

    db.session.commit()
# ---------------------------------------------------
# Round scheduling + predictable round_code
# ---------------------------------------------------

ROUND_SECONDS = 300  # 5 minutes
ROULETTE_ROUND_SECONDS = 3600  # 2 minutes for roulette (testing)


def _floor_epoch(ts: int, period: int) -> int:
    return ts - (ts % period)


def floor_to_period(dt: datetime, period_seconds: int) -> datetime:
    # Treat naive datetimes as UTC to avoid server-local timezone drift.
    if dt.tzinfo is None:
        ts = int(dt.replace(tzinfo=timezone.utc).timestamp())
    else:
        ts = int(dt.timestamp())
    floored = _floor_epoch(ts, period_seconds)
    return datetime.utcfromtimestamp(floored)

def make_round_code(game_type: str, start_time: datetime, table_number: int) -> str:
    # Required format: G_20260217_2200_1
    initial = (game_type or "X")[0].upper()
    stamp = as_ist(start_time).strftime("%Y%m%d_%H%M")
    return f"{initial}_{stamp}_{int(table_number)}"


# ---------------------------------------------------
# COMPATIBILITY ALIASES FOR STORE / EXTERNAL API ROUTES
# ---------------------------------------------------
safeint = _safe_int

# ---------------------------------------------------
# Helpers
# ---------------------------------------------------

def _get_session_user_id():
    # Compatibility (prevents name-change bugs)
    return session.get("user_id") or session.get("userid") or session.get("userId")

def _is_admin_user(user):
    return bool(
        getattr(user, "is_admin", False) or
        getattr(user, "isadmin", False) or
        getattr(user, "isAdmin", False)
    )
def is_valid_username(username: str) -> bool:
    username = (username or "").strip()
    if not username:
        return False
    if " " in username:
        return False
    return re.fullmatch(r"[A-Za-z0-9_]+", username) is not None

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = _get_session_user_id()
        if not uid:
            return redirect(url_for("login_page"))

        # load user (recommended so we can block admins from game pages)
        user = User.query.get(int(uid)) if str(uid).isdigit() else User.query.get(uid)
        if not user:
            session.clear()
            return redirect(url_for("login_page"))

        # ✅ If admin is trying to access player pages, force to /admin
        if _is_admin_user(user):
            # allow admin endpoints only
            if request.path.startswith("/admin") or request.path.startswith("/api/admin") or request.path.startswith("/static") or request.path.startswith("/logout"):
                return f(*args, **kwargs)
            return redirect(url_for("admin_panel"))  # change if your admin route name differs

        return f(*args, **kwargs)
    return decorated

from functools import wraps
from flask import session, redirect, url_for

def get_session_agent_id():
    # support both new and old session keys
    return session.get('agent_id') or session.get('agentid') or session.get('agentId') or session.get('agentID')

def agent_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        aid = get_session_agent_id()
        is_api = request.path.startswith('/api/agent/')

        if not aid:
            if is_api:
                return jsonify(success=False, message="Agent login required"), 401
            return redirect(url_for('agentloginpage'))

        try:
            aid_int = int(aid)
        except Exception:
            for k in ('agent_id', 'agentid', 'agentId', 'agentID'):
                session.pop(k, None)
            if is_api:
                return jsonify(success=False, message="Invalid agent session"), 401
            return redirect(url_for('agentloginpage'))

        a = Agent.query.get(aid_int)
        if not a:
            for k in ('agent_id', 'agentid', 'agentId', 'agentID'):
                session.pop(k, None)
            if is_api:
                return jsonify(success=False, message="Agent not found"), 401
            return redirect(url_for('agentloginpage'))

        if getattr(a, 'isblocked', False):
            if is_api:
                return jsonify(success=False, message="Agent is blocked. Contact admin."), 403
            return "Agent is blocked. Contact admin.", 403

        return f(*args, **kwargs)
    return decorated



def admin_required(f):
    """Check if user is logged in AND is admin"""

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

def get_session_subadmin_id():
    return session.get('subadmin_id') or session.get('subadminid') or session.get('subAdminId')

def subadmin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        sid = get_session_subadmin_id()

        if not sid:
            if request.path.startswith('/api/subadmin/'):
                return jsonify({'success': False, 'message': 'Sub-admin login required'}), 401
            return redirect(url_for('subadmin_login_page'))

        try:
            sid_int = int(sid)
        except Exception:
            for k in ('subadmin_id', 'subadminid', 'subAdminId'):
                session.pop(k, None)
            if request.path.startswith('/api/subadmin/'):
                return jsonify({'success': False, 'message': 'Invalid sub-admin session'}), 401
            return redirect(url_for('subadmin_login_page'))

        sa = SubAdmin.query.get(sid_int)
        if not sa:
            for k in ('subadmin_id', 'subadminid', 'subAdminId'):
                session.pop(k, None)
            if request.path.startswith('/api/subadmin/'):
                return jsonify({'success': False, 'message': 'Sub-admin not found'}), 401
            return redirect(url_for('subadmin_login_page'))

        return f(*args, **kwargs)
    return decorated


        
def superadmin_required(f):
    """Check if user is logged in as super admin"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "is_superadmin" not in session or not session.get("is_superadmin"):
            if request.path.startswith("/api/sa/"):
                return jsonify({"error": "Super admin access required"}), 403
            return redirect(url_for("sa_login_page"))
        return f(*args, **kwargs)
    return decorated


def ensure_wallet_for_user(user: User, starting_balance: int = 10000) -> Wallet:
    """Ensure wallet exists. Non-admin default = 10000."""
    if user.is_admin:
        return None
    if not user.wallet:
        wallet = Wallet(user_id=user.id, balance=int(starting_balance or 0))
        db.session.add(wallet)
        db.session.commit()
        return wallet
    return user.wallet


def ensure_store_wallet_for_user(user, starting_balance=0):
    if not user:
        return None

    if getattr(user, "is_admin", False):
        return None

    wallet = StoreWallet.query.filter_by(user_id=user.id).first()
    if not wallet:
        wallet = StoreWallet(
            user_id=user.id,
            balance=int(starting_balance or 0)
        )
        db.session.add(wallet)
        db.session.commit()
    return wallet


def verify_store_api_request(req):
    token = (req.headers.get("X-Store-Secret") or "").strip()
    return bool(token) and token == STORE_API_SECRET

def get_current_logged_in_user():
    uid = _get_session_user_id()
    if not uid:
        return None

    try:
        if str(uid).isdigit():
            return User.query.get(int(uid))
        return User.query.get(uid)
    except Exception:
        return None


def make_order_code(user_id):
    stamp = as_ist(datetime.utcnow()).strftime("%Y%m%d%H%M%S")
    return f"ORD{stamp}{int(user_id)}{secrets.token_hex(2).upper()}"



def generate_bot_name():
    prefixes = ["Rahul","Amit","Ankit","Rohit","Vikas","Sandeep","Deepak","Ajay","Pankaj","Manoj","Vivek","Arun","Sunil","Rakesh","Rajesh","Sanjay","Kunal","Varun","Nitin","Mohit",
                "Saurabh","Abhishek","Prashant","Shubham","Yogesh","Priya","Pooja","Neha","Kavita","Sunita","Anjali","Ritu","Sneha","Preeti","Swati","Aarti","Nidhi","Kiran","Meena","Rekha","Suman","Divya","Shalini","Komal","Rashmi",
                "Payal","Riya","Sonia","Simran","Monika","John","Michael","David","James","Robert","William","Richard","Thomas","Daniel","Matthew","Anthony","Mark","Paul","Steven","Andrew","Joshua","Kevin","Brian","George",
                "Edward","Ryan","Jason","Justin","Nicholas","Mary","Jennifer","Linda","Elizabeth","Patricia","Barbara","Susan","Jessica","Sarah","Karen","Nancy","Lisa","Betty","Sandra","Ashley","Kimberly","Donna","Emily","Michelle","Amanda",
                "Melissa","Stephanie","Rebecca","Laura","Anna","Shadow","Killer","Sniper","Dragon","Hunter","Warrior","Ghost","Legend","Demon","Ninja","Phantom","Predator","Assassin","Viper","Titan","Rogue","Blaze","Thunder","Storm","Reaper",
                "Gladiator","Falcon","Spartan","Wolf","Cyclone","DarkKnight","IronFist","FireStorm","SilentKiller","DeathDealer","AlphaWolf","NightHunter","VenomX","BloodRider","SteelHeart","BlackShadow","FrostBite","LoneWarrior","MadSniper",
                "ThunderX","GhostRider","DragonSlayer","ShadowStrike","SkullCrusher","StormBreaker","WildBeast","NovaX","OmegaWarrior","InfernoX","ZeroCool"]
    suffix = random.randint(100, 999)
    return f"{random.choice(prefixes)}{suffix}"


# ---------------------------------------------------
# GameTable class
# ---------------------------------------------------


class GameTable:
    def __init__(self, game_type, table_number, initial_delay=0):
        # main attributes
        self.game_type = game_type
        self.table_number = table_number
        self.config = GAME_CONFIGS[game_type]

        # compatibility aliases for older code
        self.gametype = game_type        # many places use table.gametype
        self.tablenumber = table_number  # many places use table.tablenumber
        self.maxplayers = None           # will be set after max_players is computed

                      # predictable schedule (roulette uses different duration & no-bet window)
        round_duration = ROULETTE_ROUND_SECONDS if game_type == "roulette" else ROUND_SECONDS
        no_bet_window = 60 if game_type == "roulette" else 15

        base = floor_to_period(datetime.utcnow(), round_duration)
        self.start_time = base + timedelta(seconds=initial_delay)
        self.end_time = self.start_time + timedelta(seconds=round_duration)
        self.betting_close_time = self.end_time - timedelta(seconds=no_bet_window)
        
        self.round_code = make_round_code(self.game_type, self.start_time, self.table_number)

        self.bets = []
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False
        self._spin_emitted = False

        # roulette needs 37 unique numbers, other games keep 6
        self.max_players = 37 if self.game_type == "roulette" else 6
        self.maxplayers = self.max_players

        self.last_bot_added_at = None

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

        # Unique number per round/table
        for bet in self.bets:
            if bet["number"] == number:
                return False, "This number is already taken in this game. Please choose another."

        if not is_bot:
            try:
                user_id_norm = int(user_id)
            except (TypeError, ValueError):
                user_id_norm = user_id
        else:
            user_id_norm = user_id

        user_bets = [b for b in self.bets if b["user_id"] == user_id_norm]

        # roulette allows more picks, other games unchanged
        max_bets_per_user = 20 if self.game_type == "roulette" else 3
        if len(user_bets) >= max_bets_per_user:
            return False, f"Maximum {max_bets_per_user} bets per user"

        if len(self.bets) >= self.max_players:
            return False, "All slots are full"

        bet_obj = {
            "user_id": user_id_norm,
            "username": username,
            "number": number,
            "is_bot": is_bot,
            "bet_amount": self.config["bet_amount"],
            "bet_time": datetime.utcnow(),
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
                    "bet_time": datetime.utcnow(),
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
        bet_numbers = [b.get("number") for b in (self.bets or []) if b.get("number") is not None]

        if not bet_numbers:
            self.result = random.choice(self.get_number_range())
            return self.result

        controlled_user = choose_controlled_winner_user(self)
        if controlled_user and controlled_user.get("numbers"):
            self.result = random.choice(controlled_user["numbers"])
            return self.result

        self.result = random.choice(bet_numbers)
        return self.result


    def get_winners(self):
        if self.result is None:
            return []
        winners = []
        for bet in self.bets:
            if bet["number"] == self.result and not bet["is_bot"]:
                winners.append(
                    {"user_id": bet["user_id"], "username": bet["username"], "payout": self.config["payout"]}
                )
        return winners

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

@app.route('/subadmin-login')
def subadmin_login_page():
    return render_template('subadmin-login.html')

@app.route('/subadmin-login', methods=['POST'])
def subadmin_login_post():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required'}), 400
    
    sa = SubAdmin.query.filter_by(username=username).first()
    if not sa or not sa.check_password(password):
        return jsonify({'success': False, 'message': 'Invalid credentials'}), 401
    
    session['subadmin_id'] = sa.id
    session.permanent = True
    return jsonify({'success': True, 'redirect': url_for('subadmin_panel')})

@app.route('/subadmin-logout')
def subadmin_logout():
    for k in ('subadmin_id', 'subadminid', 'subAdminId'):
        session.pop(k, None)
    return redirect(url_for('subadmin_login_page'))

@app.route('/subadmin')
@subadmin_required
def subadmin_panel():
    return render_template('subadmin-panel.html')

# Sub-admin creates users (like agent does)
@app.route('/api/subadmin/users', methods=['GET', 'POST'])
@subadmin_required
def api_subadmin_users():
    if request.method == 'POST':
        data = request.get_json() or {}
        username = data.get('username', '').strip()
        password = data.get('password', '')
        displayname = data.get('displayname', '').strip()

        if not username or not password:
            return jsonify({'success': False, 'message': 'Username and password required'}), 400

        if not is_valid_username(username):
            return jsonify({
                'success': False,
                'message': 'Username cannot contain spaces. Use only letters, numbers, and underscore.'
            }), 400

        if User.query.filter_by(username=username).first():
            return jsonify({'success': False, 'message': 'Username already exists'}), 400

        u = User(
            username=username,
            display_name=displayname,
            is_admin=False,
            is_blocked=False
        )
        u.set_password(password)
        db.session.add(u)
        db.session.commit()
        ensure_wallet_for_user(u, starting_balance=0)
        ensure_store_wallet_for_user(u, starting_balance=0)

        return jsonify({'success': True, 'message': 'User created', 'userid': u.id})

    users = User.query.filter_by(is_admin=False).order_by(User.created_at.desc()).all()
    out = []
    for u in users:
        w = Wallet.query.filter_by(user_id=u.id).first()
        out.append({
            'id': u.id,
            'username': u.username,
            'status': 'blocked' if u.is_blocked else 'active',
            'balance': int(w.balance) if w else 0,
            'created_at': fmt_ist(u.created_at, '%Y-%m-%d %H:%M') if u.created_at else '',
        })
    return jsonify(out)

# Sub-admin stats (limited)
@app.route('/api/subadmin/stats')
@subadmin_required
def api_subadmin_stats():
    total_users = User.query.filter_by(is_admin=False).count()
    total_agents = Agent.query.count()
    
    # Active games (same as admin)
    active_games = sum(1 for tables in game_tables.values() for t in tables 
                      if not getattr(t, 'is_finished', False))
    
    return jsonify({
        'total_users': total_users,
        'total_agents': total_agents,
        'active_games': active_games
    })

# Sub-admin transactions (all)
@app.route('/api/subadmin/transactions')
@subadmin_required
def api_subadmin_transactions():
    txns = Transaction.query.order_by(Transaction.datetime.desc()).limit(100).all()
    out = []
    for t in txns:
        u = User.query.get(t.user_id)
        out.append({
            'id': t.id,
            'user': u.username if u else 'Unknown',
            'kind': t.kind,
            'amount': t.amount,
            'datetime': fmt_ist(t.datetime, '%Y-%m-%d %H:%M'),
            'label': t.label or '',
        })
    return jsonify(out)

@app.route('/api/subadmin/games-history', methods=['GET'])
@subadmin_required
def api_subadmin_games_history():
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 100, type=int)
    q = (request.args.get('q') or '').strip().lower()

    query = GameRoundHistory.query

    if q:
        query = query.filter(
            db.or_(
                func.lower(GameRoundHistory.roundcode).like(f'%{q}%'),
                func.lower(GameRoundHistory.gametype).like(f'%{q}%')
            )
        )

    total = query.count()
    rows = (
        query
        .order_by(GameRoundHistory.endedat.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    items = []
    for r in rows:
        items.append({
            'roundcode': r.roundcode,
            'gametype': r.gametype,
            'tablenumber': r.tablenumber,
            'players': int(r.players or 0),
            'maxplayers': int(r.maxplayers or 0),
            'result': r.result,
            'totalbets': int(r.totalbets or 0),
            'startedat': fmt_ist(r.startedat, '%Y-%m-%d %H:%M') if r.startedat else '',
            'endedat': fmt_ist(r.endedat, '%Y-%m-%d %H:%M') if r.endedat else '',
            'status': r.status or 'finished',
        })

    return jsonify({
        'items': items,
        'page': page,
        'limit': limit,
        'total': total
    })


# Sub-admin referrals (same as admin, placeholder)
@app.route('/api/subadmin/referrals')
@subadmin_required
def api_subadmin_referrals():
    return jsonify([])  # Add MLM logic later

# Sub-admin tickets/queries

def initialize_game_tables():
    for game_type in GAME_CONFIGS.keys():
        game_tables[game_type] = []
        for i in range(6):
            initial_delay = i * 60  # stagger 1 minute each
            table = GameTable(game_type, i + 1, initial_delay)
            game_tables[game_type].append(table)
        print(f"Initialized 6 tables for {game_type}")


def manage_game_table(table: GameTable):
    # NOTE: Names are kept exactly as in your original code:
    # manage_game_table, start_time, end_time, betting_close_time,
    # is_betting_closed, is_finished, game_type, table_number, round_code,
    # last_bot_added_at, max_players, bet keys: is_bot, user_id, bet_amount, date_time, etc.

    def _safe_get_bet_amount(b):
        # supports both "bet_amount" and "betamount" if your bet dict differs
        return (
            b.get("bet_amount")
            if b.get("bet_amount") is not None
            else (b.get("betamount") if b.get("betamount") is not None else None)
        )

    def _safe_get_bet_time(b):
        # supports both "bet_time" and "bettime"
        bt = b.get("bet_time")
        if bt is None:
            bt = b.get("bettime")
        return bt

    def _set_first_attr(obj, possible_names, value):
        # set the first attribute name that exists on the model
        for n in possible_names:
            try:
                if hasattr(obj, n):
                    setattr(obj, n, value)
                    return True
            except Exception:
                pass
        return False

    def _history_models_available():
        # Prevent NameError if you haven't created these models yet.
        return (
            globals().get("GameRoundHistory") is not None
            and globals().get("GameRoundBet") is not None
            and globals().get("db") is not None
        )

    def _history_exists_for_round(GameRoundHistory, round_code_value):
        try:
            if hasattr(GameRoundHistory, "roundcode"):
                return GameRoundHistory.query.filter(
                    GameRoundHistory.roundcode == round_code_value
                ).first() is not None

            if hasattr(GameRoundHistory, "round_code"):
                return GameRoundHistory.query.filter(
                    GameRoundHistory.round_code == round_code_value
                ).first() is not None

            return False
        except Exception as e:
            print("history exists check error:", e)
            return False



    def _save_round_history(table, result, now_utc):
        """
        Saves a finished round + all bets into DB (GameRoundHistory + GameRoundBet).
        This function will:
        - do nothing if models are missing (no NameError)
        - avoid duplicate insert for same round_code
        - not crash the game loop if DB insert fails
        """
        if not _history_models_available():
            print("DEBUG models missing for history save", flush=True)
            # Models not defined; skip saving without breaking.
            return

        GameRoundHistory = globals().get("GameRoundHistory")
        GameRoundBet = globals().get("GameRoundBet")

        try:
            print("DEBUG entered _save_round_history:", table.round_code, result, flush=True)

            exists = _history_exists_for_round(GameRoundHistory, table.round_code)
            print("DEBUG history_exists:", table.round_code, exists, flush=True)

            # avoid duplicates
            if exists:
                print("DEBUG duplicate skip:", table.round_code, flush=True)
                return

            # Compute total bets
            default_bet = table.config.get("bet_amount")
            if default_bet is None:
                default_bet = table.config.get("betamount", 0)

            total_bets = 0
            for b in (table.bets or []):
                amt = _safe_get_bet_amount(b)
                if amt is None:
                    amt = default_bet or 0
                try:
                    total_bets += int(amt)
                except Exception:
                    pass

            # Create history row (set attrs safely without assuming column names)
            hist = GameRoundHistory()
            _set_first_attr(hist, ["round_code", "roundcode"], table.round_code)
            _set_first_attr(hist, ["game_type", "gametype"], table.game_type)
            _set_first_attr(hist, ["table_number", "tablenumber"], table.table_number)
            _set_first_attr(hist, ["started_at", "start_time", "startedat"], table.start_time)
            _set_first_attr(hist, ["ended_at", "end_time", "endedat"], table.end_time)
            _set_first_attr(hist, ["result", "winning_number", "winningnumber"], result)
            _set_first_attr(hist, ["status"], "finished")
            _set_first_attr(hist, ["players"], len(table.bets or []))
            _set_first_attr(hist, ["max_players", "maxplayers"], int(table.max_players or 0))
            _set_first_attr(hist, ["total_bets", "totalbets"], int(total_bets or 0))
            _set_first_attr(hist, ["created_at", "createdat"], now_utc)

            db.session.add(hist)

            # Save bets (one row per bet)
            for b in (table.bets or []):
                bet_row = GameRoundBet()

                _set_first_attr(bet_row, ["round_code", "roundcode"], table.round_code)
                _set_first_attr(bet_row, ["game_type", "gametype"], table.game_type)
                _set_first_attr(bet_row, ["table_number", "tablenumber"], table.table_number)

                _set_first_attr(bet_row, ["user_id", "userid"], str(b.get("user_id", "")))
                _set_first_attr(bet_row, ["username"], str(b.get("username", "")))

                try:
                    _set_first_attr(bet_row, ["number"], int(b.get("number", 0)))
                except Exception:
                    _set_first_attr(bet_row, ["number"], 0)

                amt = _safe_get_bet_amount(b)
                if amt is None:
                    amt = default_bet or 0
                try:
                    _set_first_attr(bet_row, ["bet_amount", "betamount"], int(amt))
                except Exception:
                    _set_first_attr(bet_row, ["bet_amount", "betamount"], 0)

                _set_first_attr(bet_row, ["is_bot", "isbot"], bool(b.get("is_bot", False)))

                bt = _safe_get_bet_time(b)
                if isinstance(bt, datetime):
                    _set_first_attr(bet_row, ["bet_time", "bettime"], bt)
                else:
                    _set_first_attr(bet_row, ["bet_time", "bettime"], now_utc)

                db.session.add(bet_row)

            db.session.commit()
            print("DEBUG history_commit_ok:", table.round_code, flush=True)

        except Exception as e_hist:
            print("History save error:", ehist, "round_code=", table.round_code, flush=True)
            try:
                db.session.rollback()
            except Exception:
                pass

    with app.app_context():
        while True:
            try:
                now = datetime.utcnow()

                if now < table.start_time:
                    time.sleep(1)
                    continue

                # Add bots while betting open
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

                # ROULETTE: wheel spin start at 15–2 seconds remaining
                if (
                    table.game_type == "roulette"
                    and not table.is_finished
                    and table.result is None
                    and not table._spin_emitted
                ):
                    tr = table.get_time_remaining()
                    if 2 < tr <= 15:
                        table._spin_emitted = True
                        socketio.emit(
                            "roulette_spin_start",
                            {
                                "game_type": table.game_type,
                                "table_number": table.table_number,
                                "round_code": table.round_code,
                                "time_remaining": tr,
                            },
                        )

                # PRE-SELECT RESULT at <= 2 seconds remaining (for UI animation)
                if (
                    (not table.is_finished)
                    and (table.result is None)
                    and (len(table.bets) > 0)
                    and (table.get_time_remaining() <= 2)
                ):
                    forced = forced_winners.get((table.game_type, table.round_code))
                    if forced is not None:
                        bet_numbers = {b.get("number") for b in (table.bets or [])}
                        table.result = forced if forced in bet_numbers else table.calculate_result()
                    else:
                        table.result = table.calculate_result()

                    print(
                        f"{table.game_type} Table {table.table_number}: "
                        f"Pre-selected winner at <=2s: {table.result}"
                    )
                    
                # Finish game at end_time
                if now >= table.end_time and not table.is_finished:
                    table.is_finished = True

                    if table.result is None:
                        forced = forced_winners.get((table.game_type, table.round_code))
                        if forced is not None:
                            bet_numbers = {b.get("number") for b in (table.bets or [])}
                            table.result = forced if forced in bet_numbers else table.calculate_result()
                        else:
                            table.result = table.calculate_result()

                    result = table.result
                    winners = table.get_winners()
                    print(f"{table.game_type} Table {table.table_number}: Game ended. Winner: {result}")

                    try:
                        update_user_win_control_after_round(table, result)
                    except Exception as e:
                        print("UserWinControl update error:", e)
                        try:
                            db.session.rollback()
                        except Exception:
                            pass

                    # History update (user_game_history)
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
                                rec["date_time"] = fmt_ist(now, "%Y-%m-%d %H:%M")

                    # Winners payout + transaction log
                    for winner in winners:
                        wallet = Wallet.query.filter_by(user_id=winner["user_id"]).first()
                        if wallet:
                            wallet.balance += winner["payout"]

                        win_tx = Transaction(
                            user_id=winner["user_id"],
                            kind="win",
                            amount=winner["payout"],
                            balance_after=wallet.balance if wallet else 0,
                            label="Game Won",
                            game_title=table.config["name"],
                            note=f"Hit number {result}",
                        )
                        db.session.add(win_tx)

                    # Update forced winner history status to 'executed'
                    history_record = ForcedWinnerHistory.query.filter_by(
                        round_code=table.round_code,
                        status="active"
                    ).first()
                    if history_record:
                        history_record.status = "executed"
                        history_record.note = f"Executed. Winner: {result}"

                    # Commit payouts + forced-winner history
                    db.session.commit()


                    print("DEBUG before _save_round_history:", table.round_code, result, flush=True)
                    _save_round_history(table, result, now)

                    # clear forced winner after round ends (one-round only)
                    forced_winners.pop((table.game_type, table.round_code), None)

                    time.sleep(3)

                    # Reset for new round (predictable)
                    table.bets = []
                    table.result = None
                    table.is_betting_closed = False
                    table.is_finished = False
                    table._spin_emitted = False  # allow spin event next round

                    _round_duration = ROULETTE_ROUND_SECONDS if table.game_type == "roulette" else ROUND_SECONDS
                    _no_bet_window = 60 if table.game_type == "roulette" else 15

                    base = floor_to_period(datetime.utcnow(), _round_duration)
                    table.start_time = base + timedelta(seconds=(table.table_number - 1) * 60)
                    table.end_time = table.start_time + timedelta(seconds=_round_duration)
                    table.betting_close_time = table.end_time - timedelta(seconds=_no_bet_window)
                    table.round_code = make_round_code(table.game_type, table.start_time, table.table_number)

                    table.last_bot_added_at = None
                    print(f"{table.game_type} Table {table.table_number}: New round started - {table.round_code}")

                
                time.sleep(1)

            except Exception as e:
                print(f"Error managing table {table.game_type} #{table.table_number}: {e}")
                time.sleep(1)


def start_all_game_tables():
    for _, tables in game_tables.items():
        for table in tables:
            threading.Thread(target=manage_game_table, args=(table,), daemon=True).start()
    print("All game table threads started!")

@app.route('/api/subadmin/agents', methods=['GET', 'POST'])
@subadmin_required
def api_subadmin_agents():
    if request.method == 'POST':
        data = request.get_json() or {}

        name = (data.get('name') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()

        sp = data.get('salarypercent')
        if sp is None:
            sp = data.get('salaryPercent')
        if sp is None:
            sp = data.get('agentSalaryPercent')

        try:
            salarypercent = float(sp or 0)
        except Exception:
            salarypercent = 0.0

        if not name or not username or not password:
            return jsonify({'success': False, 'message': 'Name, username, password required'}), 400

        if salarypercent < 0 or salarypercent > 100:
            return jsonify({'success': False, 'message': 'Salary percent must be 0-100'}), 400

        if Agent.query.filter_by(username=username).first():
            return jsonify({'success': False, 'message': 'Agent username already exists'}), 400

        a = Agent(
            name=name,
            username=username,
            salarypercent=salarypercent,
            isblocked=False
        )
        a.setpassword(password)
        db.session.add(a)
        db.session.commit()

        return jsonify({'success': True, 'message': 'Agent created', 'id': a.id})

    agents = Agent.query.order_by(Agent.createdat.desc()).all()
    out = []

    for a in agents:
        summary = _build_agent_commission_data(a)

        out.append({
            'id': a.id,
            'name': a.name,
            'username': a.username,
            'salarypercent': float(a.salarypercent or 0),
            'isblocked': bool(a.isblocked),
            'blockreason': a.blockreason or '',
            'usercount': int(summary['usercount']),
            'rawplayed': int(summary['rawplayed']),
            'eligibleplayed': int(summary['eligibleplayed']),
            'blockedplayed': int(summary['blockedplayed']),
            'totalplayed': int(summary['eligibleplayed']),
            'totalsalary': round(summary['totalsalary'], 2),
            'blockedsalary': round(summary['blockedsalary'], 2),
            'createdat': fmt_ist(a.createdat, '%Y-%m-%d %H:%M') if a.createdat else ''
        })

    return jsonify(out)

@app.route('/api/subadmin/agents/<int:agentid>/users', methods=['GET'])
@subadmin_required
def api_subadmin_agent_users(agentid):
    try:
        a = Agent.query.get(agentid)
        if not a:
            return jsonify({'success': False, 'message': 'Agent not found'}), 404

        users = User.query.filter_by(agentid=a.id).order_by(User.created_at.desc()).all()
        items = []

        for u in users:
            amountplayed = db.session.query(
                func.coalesce(func.sum(Transaction.amount), 0)
            ).filter(
                Transaction.user_id == u.id
            ).filter(
                func.lower(Transaction.kind) == 'bet'
            ).scalar() or 0

            salarygenerated = float(amountplayed) * float(a.salarypercent or 0) / 100.0

            items.append({
                'userid': u.id,
                'username': u.username,
                'joining': fmt_ist(u.created_at, '%Y-%m-%d %H:%M') if u.created_at else '',
                'amountplayed': int(amountplayed),
                'salarygenerated': round(salarygenerated, 2)
            })

        return jsonify({'agentid': a.id, 'items': items})

    except Exception as e:
        return jsonify({'success': False, 'message': f'agent users api error: {str(e)}'}), 500


@app.route('/api/subadmin/agents/<int:agentid>/block', methods=['POST'])
@subadmin_required
def subadmin_block_agent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify({'success': False, 'message': 'Agent not found'}), 404

    data = request.get_json() or {}
    reason = (data.get('reason') or 'Blocked by subadmin').strip()

    if not a.isblocked:
        a.isblocked = True
        a.blockreason = reason
        db.session.add(AgentBlockPeriod(agentid=a.id, startat=datetime.utcnow(), endat=None))
        db.session.commit()

    return jsonify({'success': True, 'message': 'Agent blocked'})


@app.route('/api/subadmin/agents/<int:agentid>/unblock', methods=['POST'])
@subadmin_required
def subadmin_unblock_agent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify({'success': False, 'message': 'Agent not found'}), 404

    if a.isblocked:
        a.isblocked = False
        a.blockreason = None

        openp = AgentBlockPeriod.query.filter_by(
            agentid=a.id,
            endat=None
        ).order_by(
            AgentBlockPeriod.startat.desc()
        ).first()

        if openp:
            openp.endat = datetime.utcnow()

        db.session.commit()

    return jsonify({'success': True, 'message': 'Agent unblocked'})

# ---------------------------------------------------
# Super Admin routes (login-based with history)
# ---------------------------------------------------

@app.route("/sa-login")
def sa_login_page():
    if "is_superadmin" in session and session.get("is_superadmin"):
        return redirect(url_for("super_admin_panel"))
    return render_template("sa-login.html")


@app.route("/sa-login", methods=["POST"])
def sa_login_post():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"}), 400

    if username == SUPERADMIN_USERNAME and password == SUPERADMIN_PASSWORD:
        session["is_superadmin"] = True
        session["superadmin_username"] = username
        session.permanent = True
        return jsonify({"success": True, "redirect": url_for("super_admin_panel")})
    
    return jsonify({"success": False, "message": "Invalid credentials"}), 401


@app.route("/sa-logout")
def sa_logout():
    session.pop("is_superadmin", None)
    session.pop("superadmin_username", None)
    return redirect(url_for("sa_login_page"))


@app.route("/sa")
@superadmin_required
def super_admin_panel():
    return render_template("super_admin.html", username=session.get("superadmin_username", "SuperAdmin"))


@app.route("/api/sa/rounds", methods=["GET"])
@superadmin_required
def sa_rounds():
    """Get rounds filtered by date and time slot, only those >60 min away"""
    date_str = request.args.get("date")  # Format: YYYY-MM-DD
    time_slot = request.args.get("time_slot")  # Format: "22-23" for 10 PM - 11 PM

    if not date_str or not time_slot:
        return jsonify({"error": "date and time_slot required"}), 400

    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        start_hour, end_hour = map(int, time_slot.split("-"))

        slot_start = datetime.combine(target_date, datetime.min.time()).replace(hour=start_hour)
        slot_start = slot_start.replace(tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
        slot_end = datetime.combine(target_date, datetime.min.time()).replace(hour=end_hour)
        slot_end = slot_end.replace(tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)

    except (ValueError, AttributeError):
        return jsonify({"error": "Invalid date or time_slot format"}), 400

    now = datetime.utcnow()
    cutoff_time = now + timedelta(minutes=60)  # Only show rounds >60 min away

    out = []

    for game_type in GAME_CONFIGS.keys():
        for table_number in range(1, 7):
            table_offset = (table_number - 1) * 60
            current_time = floor_to_period(slot_start, ROUND_SECONDS) + timedelta(seconds=table_offset)

            while current_time < slot_end:
                if current_time > cutoff_time:
                    minutes_until = int((current_time - now).total_seconds() / 60)
                    round_code = make_round_code(game_type, current_time, table_number)
                    forced_number = forced_winners.get((game_type, round_code))

                    out.append({
                        "game_type": game_type,
                        "game_name": GAME_CONFIGS[game_type]["name"],
                        "table_number": table_number,
                        "round_code": round_code,
                        "start_time": fmt_ist(current_time, "%Y-%m-%d %H:%M:%S"),
                        "minutes_until_start": minutes_until,
                        "forced_number": forced_number,
                        "can_force": True
                    })

                current_time += timedelta(seconds=ROUND_SECONDS)

    out.sort(key=lambda x: x["start_time"])
    return jsonify({"rounds": out, "total": len(out)})



@app.route("/api/sa/force-winner", methods=["POST"])
@superadmin_required
def sa_force_winner():
    """Force a winner for a specific round - works with future rounds too"""
    data = request.get_json() or {}
    round_code = data.get("round_code") or ""
    number = data.get("number", None)
    
    if not round_code:
        return jsonify({"success": False, "message": "round_code required"}), 400
    
    # Extract info from round_code (format: G_20260217_2200_1)
    try:
        parts = round_code.split("_")
        game_initial = parts[0]
        date_stamp = parts[1]  # YYYYMMDD
        time_stamp = parts[2]  # HHMM
        table_num = int(parts[3])
        
        # Map initial to game_type
        game_type_map = {
            "S": "silver",
            "G": "gold", 
            "D": "diamond",
            "P": "platinum",
            "R": "roulette"
        }
        game_type = game_type_map.get(game_initial)
        
        if not game_type:
            return jsonify({"success": False, "message": "Invalid round code format"}), 400
        
        # Parse the round start time
        round_start_str = f"{date_stamp}_{time_stamp}"
        round_start_ist = datetime.strptime(round_start_str, "%Y%m%d_%H%M").replace(tzinfo=IST)
        round_start = round_start_ist.astimezone(timezone.utc).replace(tzinfo=None)
        
    except (IndexError, ValueError) as e:
        return jsonify({"success": False, "message": f"Invalid round code format: {str(e)}"}), 400
    
    now = datetime.utcnow()
    minutes_until = (round_start - now).total_seconds() / 60
    
    # Enforce 60-minute rule
    if minutes_until < 60:
        return jsonify({
            "success": False, 
            "message": f"Time expired! You can only force winner >60 minutes before start. This round starts in {int(minutes_until)} minutes."
        }), 400
    
    # Clear forced winner
    if number is None or str(number).strip() == "":
        forced_winners.pop((game_type, round_code), None)
        
        # Update history status to 'cleared'
        history_record = ForcedWinnerHistory.query.filter_by(
            round_code=round_code, 
            status="active"
        ).first()
        if history_record:
            history_record.status = "cleared"
            history_record.note = f"Cleared at {fmt_ist(now, '%Y-%m-%d %H:%M:%S')}"
            db.session.commit()
        
        return jsonify({"success": True, "message": "Forced winner cleared"})
    
    # Set forced winner
    try:
        n = int(number)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid number"}), 400
    
    if game_type == "roulette":
        if n < 0 or n > 36:
            return jsonify({"success": False, "message": "Roulette number must be 0-36"}), 400
    else:
        if n < 0 or n > 9:
            return jsonify({"success": False, "message": "Number must be 0-9"}), 400
    
    forced_winners[(game_type, round_code)] = n
    
    # Save to history
    existing = ForcedWinnerHistory.query.filter_by(
        round_code=round_code,
        status="active"
    ).first()
    
    if existing:
        existing.forced_number = n
        existing.forced_at = now
        existing.note = f"Updated at {fmt_ist(now, '%Y-%m-%d %H:%M:%S')}"
    else:
        history_record = ForcedWinnerHistory(
            round_code=round_code,
            game_type=game_type,
            game_name=GAME_CONFIGS[game_type]["name"],
            table_number=table_num,
            forced_number=n,
            round_start_time=round_start,
            forced_by=session.get("superadmin_username", "unknown"),
            status="active",
            note=f"Forced {int(minutes_until)} minutes before start"
        )
        db.session.add(history_record)
    
    db.session.commit()
    
    return jsonify({
        "success": True, 
        "message": f"Forced winner set to {n} for {round_code}",
        "round_code": round_code,
        "number": n
    })


@app.route("/api/sa/history", methods=["GET"])
@superadmin_required
def sa_history():
    """Get history of all forced winners"""
    limit = request.args.get("limit", 100, type=int)
    
    history = (
        ForcedWinnerHistory.query
        .order_by(ForcedWinnerHistory.forced_at.desc())
        .limit(limit)
        .all()
    )
    
    out = []
    for h in history:
        out.append({
            "id": h.id,
            "round_code": h.round_code,
            "game_name": h.game_name,
            "table_number": h.table_number,
            "forced_number": h.forced_number,
            "round_start_time": fmt_ist(h.round_start_time, "%Y-%m-%d %H:%M:%S"),
            "forced_at": fmt_ist(h.forced_at, "%Y-%m-%d %H:%M:%S"),
            "forced_by": h.forced_by,
            "status": h.status,
            "note": h.note or ""
        })
    
    return jsonify({"history": out, "total": len(out)})


# ---------------------------------------------------
# API: tables and history
# ---------------------------------------------------

@app.route("/api/tables/<game_type>")
def get_game_tables_api(game_type):
    try:
        game_type = game_type.lower()
        if game_type not in GAME_CONFIGS:
            return jsonify({"error": "Invalid game type", "tables": []}), 404

        tables_list = game_tables.get(game_type, [])
        if not tables_list:
            return jsonify({"game_type": game_type, "tables": [], "message": "No tables initialized"}), 200

        serialized_tables = []
        for table in tables_list:
            if table:
                bets_list = []
                if table.bets:
                    for bet in table.bets:
                        bets_list.append(
                            {
                                "user_id": str(bet.get("user_id", "")),
                                "username": bet.get("username", "Unknown"),
                                "number": bet.get("number", 0),
                            }
                        )

                serialized_tables.append(
                    {
                        "table_number": table.table_number,
                        "game_type": table.game_type,
                        "round_code": table.round_code,
                        "players": len(bets_list),
                        "bets": bets_list,
                        "result": table.result,
                        "max_players": table.max_players,
                        "slots_available": table.get_slots_available(),
                        "time_remaining": table.get_time_remaining(),
                        "is_betting_closed": table.is_betting_closed,
                        "is_finished": table.is_finished,
                        "is_started": table.is_started(),
                        "min_bet": table.config.get("bet_amount", 0),
                        "max_bet": table.config.get("payout", 0),
                        "status": "betting_closed" if table.is_betting_closed else "active",
                    }
                )

        return jsonify({"game_type": game_type, "tables": serialized_tables, "total_tables": len(serialized_tables)}), 200

    except Exception as e:
        print(f"Error in get_game_tables_api: {str(e)}")
        return jsonify({"error": str(e), "game_type": game_type, "tables": []}), 500


@app.route("/api/tables")
def get_all_tables():
    all_tables = {
        game_type: [table.to_dict() for table in tables]
        for game_type, tables in game_tables.items()
    }
    return jsonify(all_tables)


import traceback

@app.route("/api/user-games")
@login_required
def user_games_history_api():
    user_id = request.args.get("user_id", type=int) or _get_session_user_id()

    try:
        user_id = int(user_id)
    except Exception:
        return jsonify({"current_games": [], "game_history": [], "error": "invalid user_id"})

    game_history = []
    current_games = []

    try:
        rows = (
            db.session.query(GameRoundBet, GameRoundHistory)
            .join(GameRoundHistory, GameRoundHistory.roundcode == GameRoundBet.roundcode)
            .filter(GameRoundBet.userid == str(user_id))
            .order_by(GameRoundHistory.endedat.desc(), GameRoundBet.bettime.asc())
            .all()
        )

        grouped = {}

        for bet, hist in rows:
            key = (hist.gametype, hist.roundcode, hist.tablenumber)

            if key not in grouped:
                grouped[key] = {
                    "game_type": hist.gametype,
                    "round_code": hist.roundcode,
                    "bet_amount": int(getattr(bet, "betamount", 0) or 0),
                    "user_bets": [],
                    "winning_number": hist.result,
                    "date_time": fmt_ist(hist.endedat, "%Y-%m-%d %H:%M") if hist.endedat else "",
                    "status": None,
                    "amount": 0,
                    "win_amount": 0,
                    "loss_amount": 0,
                    "time_remaining": None,
                    "table_number": hist.tablenumber,
                }

            try:
                grouped[key]["user_bets"].append(int(bet.number))
            except Exception:
                pass

        for g in grouped.values():
            g["user_bets"] = sorted(set(g["user_bets"]))
            cfg = GAME_CONFIGS.get(g["game_type"], {})
            payout_amt = int(cfg.get("payout", 0) or 0)
            total_loss = int(g["bet_amount"] or 0) * len(g["user_bets"])

            if g["winning_number"] in g["user_bets"]:
                g["status"] = "win"
                g["win_amount"] = payout_amt
                g["loss_amount"] = 0
                g["amount"] = payout_amt
            else:
                g["status"] = "lose"
                g["win_amount"] = 0
                g["loss_amount"] = total_loss
                g["amount"] = total_loss

        game_history = list(grouped.values())
        game_history.sort(key=lambda x: x.get("date_time", ""), reverse=True)

    except Exception as e:
        print("user_games_history_api history query error:", str(e))
        traceback.print_exc()

    try:
        for game_type, tables in game_tables.items():
            for table in tables:
                if getattr(table, "is_finished", False):
                    continue
                if getattr(table, "is_betting_closed", False):
                    continue


                user_bets = []
                for bet in (table.bets or []):
                    try:
                        bet_uid = int(bet.get("user_id"))
                    except Exception:
                        continue

                    if bet_uid == user_id:
                        try:
                            user_bets.append(int(bet.get("number")))
                        except Exception:
                            pass

                if user_bets:
                    current_games.append({
                        "game_type": table.game_type,
                        "round_code": table.round_code,
                        "bet_amount": int(table.config.get("bet_amount", 0) or 0),
                        "user_bets": sorted(set(user_bets)),
                        "winning_number": None,
                        "date_time": fmt_ist(table.start_time, "%Y-%m-%d %H:%M") if table.start_time else "",
                        "status": None,
                        "amount": 0,
                        "win_amount": 0,
                        "loss_amount": 0,
                        "time_remaining": table.get_time_remaining(),
                        "table_number": table.table_number,
                    })

    except Exception as e:
        print("user_games_history_api current games error:", str(e))
        traceback.print_exc()

    return jsonify({
        "current_games": current_games,
        "game_history": game_history
    })



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
        user = User.query.get(session.get("user_id"))
        if user and user.is_admin:
            return redirect(url_for("admin_panel"))
        return redirect(url_for("home"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login_post():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    remember_me = data.get("remember_me", False)

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

    if user.is_blocked:
        return jsonify({"success": False, "message": f"Your account is blocked. Reason: {user.block_reason or 'No reason provided'}"}), 403

    if not user.is_admin:
        ensure_wallet_for_user(user)
        ensure_store_wallet_for_user(user)

    session["user_id"] = user.id
    session["userid"] = user.id  # alias for older templates/JS
    session["username"] = user.username
    if remember_me:
        session.permanent = True

    token = secrets.token_urlsafe(32)
    redirect_url = url_for("admin_panel") if user.is_admin else url_for("home")

    return jsonify({"success": True, "user_id": user.id, "username": user.username, "token": token, "redirect": redirect_url})


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
        return jsonify({"success": False, "message": "Username and password required"}), 400

    if not is_valid_username(username):
        return jsonify({"success": False,"message": "Username cannot contain spaces. Use only letters, numbers, and underscore."}), 400

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
    ensure_store_wallet_for_user(user)

    session["user_id"] = user.id
    session["userid"] = user.id
    session["username"] = user.username

    return jsonify({"success": True, "user_id": user.id, "username": user.username, "redirect": url_for("home")})


@app.route("/api/store/wallet", methods=["GET"])
@login_required
def api_store_wallet():
    user = get_current_logged_in_user()
    if not user:
        return jsonify(success=False, message="User not found"), 404

    game_wallet = ensure_wallet_for_user(user, starting_balance=0)
    store_wallet = ensure_store_wallet_for_user(user, starting_balance=0)

    return jsonify(
        success=True,
        game_balance=int(game_wallet.balance or 0) if game_wallet else 0,
        store_balance=int(store_wallet.balance or 0) if store_wallet else 0,
    )


def ensurewalletforuser(user, startingbalance=0):
    if not user:
        return None
    if getattr(user, "isadmin", False):
        return None

    if hasattr(user, "wallet") and user.wallet:
        return user.wallet

    wallet = None

    if hasattr(Wallet, "userid"):
        wallet = Wallet.query.filter_by(userid=user.id).first()
    elif hasattr(Wallet, "user_id"):
        wallet = Wallet.query.filter_by(user_id=user.id).first()

    if not wallet:
        if hasattr(Wallet, "userid"):
            wallet = Wallet(userid=user.id, balance=int(startingbalance or 0))
        elif hasattr(Wallet, "user_id"):
            wallet = Wallet(user_id=user.id, balance=int(startingbalance or 0))
        else:
            raise Exception("Wallet model has neither 'userid' nor 'user_id'")

        db.session.add(wallet)
        db.session.commit()

    return wallet


def ensurestorewalletforuser(user, startingbalance=0):
    if not user:
        return None
    if getattr(user, "isadmin", False):
        return None

    wallet = None

    if hasattr(StoreWallet, "userid"):
        wallet = StoreWallet.query.filter_by(userid=user.id).first()
    elif hasattr(StoreWallet, "user_id"):
        wallet = StoreWallet.query.filter_by(user_id=user.id).first()

    if not wallet:
        if hasattr(StoreWallet, "userid"):
            wallet = StoreWallet(userid=user.id, balance=int(startingbalance or 0))
        elif hasattr(StoreWallet, "user_id"):
            wallet = StoreWallet(user_id=user.id, balance=int(startingbalance or 0))
        else:
            raise Exception("StoreWallet model has neither 'userid' nor 'user_id'")

        db.session.add(wallet)
        db.session.commit()

    return wallet


# ---------------------------------------------------
# EXTERNAL STORE AUTH APIs
# ---------------------------------------------------
@app.route("/api/store-auth/register", methods=["POST"])
def store_auth_register():
    try:
        auth_ok = False

        if "verify_store_api_request" in globals():
            auth_ok = verify_store_api_request(request)
        elif "verifystoreapirequest" in globals():
            auth_ok = verifystoreapirequest(request)

        if not auth_ok:
            return jsonify({"success": False, "message": "Unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        if not username or not password:
            return jsonify({"success": False, "message": "Username and password required"}), 400

        is_valid = True
        if "is_valid_username" in globals():
            is_valid = is_valid_username(username)
        elif "isvalidusername" in globals():
            is_valid = isvalidusername(username)
        else:
            is_valid = (" " not in username and len(username.strip()) > 0)

        if not is_valid:
            return jsonify({
                "success": False,
                "message": "Username cannot contain spaces. Use only letters, numbers, and underscore."
            }), 400

        if len(password) < 6:
            return jsonify({"success": False, "message": "Password must be at least 6 characters"}), 400

        existing = User.query.filter_by(username=username).first()
        if existing:
            return jsonify({"success": False, "message": "Username already exists"}), 400

        user = User(username=username)

        if hasattr(user, "displayname"):
            user.displayname = username
        elif hasattr(user, "display_name"):
            user.display_name = username

        if hasattr(user, "setpassword"):
            user.setpassword(password)
        else:
            user.set_password(password)

        db.session.add(user)
        db.session.commit()

        if "ensurewalletforuser" in globals():
            ensurewalletforuser(user, starting_balance=0)
        elif "ensure_wallet_for_user" in globals():
            ensure_wallet_for_user(user, starting_balance=0)

        if "ensurestorewalletforuser" in globals():
            ensurestorewalletforuser(user, starting_balance=0)
        elif "ensure_store_wallet_for_user" in globals():
            ensure_store_wallet_for_user(user, starting_balance=0)

        return jsonify({
            "success": True,
            "message": "Registered successfully",
            "userid": user.id,
            "username": user.username
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": f"store_auth_register error: {str(e)}"
        }), 500

@app.route("/api/store-auth/login", methods=["POST"])
def store_auth_login():
    try:
        auth_ok = False

        if "verify_store_api_request" in globals():
            auth_ok = verify_store_api_request(request)
        elif "verifystoreapirequest" in globals():
            auth_ok = verifystoreapirequest(request)

        if not auth_ok:
            return jsonify({"success": False, "message": "Unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        if not username or not password:
            return jsonify({"success": False, "message": "Username and password required"}), 400

        user = User.query.filter_by(username=username).first()
        if not user:
            return jsonify({"success": False, "message": "Invalid username or password"}), 401

        if hasattr(user, "checkpassword"):
            ok = user.checkpassword(password)
        else:
            ok = user.check_password(password)

        if not ok:
            return jsonify({"success": False, "message": "Invalid username or password"}), 401

        if getattr(user, "isblocked", False):
            return jsonify({
                "success": False,
                "message": f"Your account is blocked. Reason: {getattr(user, 'blockreason', '') or 'No reason provided'}"
            }), 403

        if "ensurewalletforuser" in globals():
            ensurewalletforuser(user, starting_balance=0)
        elif "ensure_wallet_for_user" in globals():
            ensure_wallet_for_user(user, starting_balance=0)

        if "ensurestorewalletforuser" in globals():
            ensurestorewalletforuser(user, starting_balance=0)
        elif "ensure_store_wallet_for_user" in globals():
            ensure_store_wallet_for_user(user, starting_balance=0)

        return jsonify({
            "success": True,
            "message": "Login successful",
            "userid": user.id,
            "username": user.username
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"store_auth_login error: {str(e)}"
        }), 500

@app.route("/api/external/store/credit-game-wallet", methods=["POST"])
def external_credit_game_wallet():
    def model_kwargs(Model, **kwargs):
        cols = set(Model.__table__.columns.keys())
        return {k: v for k, v in kwargs.items() if k in cols}

    def utcnow_naive():
        return datetime.now(timezone.utc).replace(tzinfo=None)

    if not verify_store_api_request(request):
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}

    userid = safeint(data.get("userid") or data.get("user_id"), 0)
    cardvalue = safeint(data.get("cardvalue") or data.get("card_value"), 0)
    quantity = safeint(data.get("quantity"), 1)
    payment_ref = (data.get("paymentref") or data.get("payment_ref") or "").strip()
    note = (data.get("note") or "").strip()

    allowed_values = (
        globals().get("ALLOWEDCARDVALUES")
        or globals().get("ALLOWED_CARD_VALUES")
        or [10, 50, 100, 200, 250]
    )

    if userid <= 0:
        return jsonify({"success": False, "message": "Invalid userid"}), 400

    if cardvalue not in allowed_values:
        return jsonify({"success": False, "message": "Invalid card value"}), 400

    if quantity <= 0:
        return jsonify({"success": False, "message": "Invalid quantity"}), 400

    if not payment_ref:
        return jsonify({"success": False, "message": "payment_ref required"}), 400

    user = db.session.get(User, userid)
    if not user or getattr(user, "isadmin", False):
        return jsonify({"success": False, "message": "User not found"}), 404

    existing_ref = StoreTransaction.query.filter_by(
        **model_kwargs(
            StoreTransaction,
            userid=user.id,
            user_id=user.id,
            kind="externalstorecredit",
            reference=payment_ref
        )
    ).first()

    if existing_ref:
        gamewallet = ensurewalletforuser(user, startingbalance=0)
        storewallet = ensurestorewalletforuser(user, startingbalance=0)

        return jsonify({
            "success": True,
            "message": "Already processed",
            "userid": user.id,
            "gamebalance": int(gamewallet.balance or 0) if gamewallet else 0,
            "storebalance": int(storewallet.balance or 0) if storewallet else 0,
            "reference": payment_ref,
            "totalcoins": cardvalue * quantity
        }), 200

    totalcoins = cardvalue * quantity

    try:
        gamewallet = ensurewalletforuser(user, startingbalance=0)
        storewallet = ensurestorewalletforuser(user, startingbalance=0)

        if not gamewallet:
            return jsonify({"success": False, "message": "Game wallet not found"}), 500

        if not storewallet:
            return jsonify({"success": False, "message": "Store wallet not found"}), 500

        gamewallet.balance = int(gamewallet.balance or 0) + totalcoins
        now_utc = utcnow_naive()

        gametx = Transaction(**model_kwargs(
            Transaction,
            userid=user.id,
            user_id=user.id,
            kind="added",
            amount=totalcoins,
            balanceafter=int(gamewallet.balance or 0),
            balance_after=int(gamewallet.balance or 0),
            label="Point Card Added",
            gametitle="External Store Card",
            game_title="External Store Card",
            note=note or f"External store purchase {payment_ref}",
            datetime=now_utc,
            createdat=now_utc,
            created_at=now_utc
        ))

        storeaudit = StoreTransaction(**model_kwargs(
            StoreTransaction,
            userid=user.id,
            user_id=user.id,
            kind="externalstorecredit",
            amount=totalcoins,
            balanceafter=int(storewallet.balance or 0),
            balance_after=int(storewallet.balance or 0),
            label="External Store Purchase",
            note=note or f"Credited to game wallet via store order {payment_ref}",
            reference=payment_ref,
            createdat=now_utc,
            created_at=now_utc
        ))

        purchase = PointCardPurchase(**model_kwargs(
            PointCardPurchase,
            userid=user.id,
            user_id=user.id,
            cardvalue=cardvalue,
            card_value=cardvalue,
            quantity=quantity,
            totalcoins=totalcoins,
            total_coins=totalcoins,
            paymentstatus="PAID",
            payment_status="PAID",
            createdat=now_utc,
            created_at=now_utc
        ))

        transfer = WalletTransfer(**model_kwargs(
            WalletTransfer,
            userid=user.id,
            user_id=user.id,
            direction="STORETOGAME",
            amount=totalcoins,
            status="SUCCESS",
            note=f"External store credit ref {payment_ref}",
            createdat=now_utc,
            created_at=now_utc
        ))

        db.session.add(gametx)
        db.session.add(storeaudit)
        db.session.add(purchase)
        db.session.add(transfer)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Game wallet credited successfully",
            "userid": user.id,
            "addedcoins": totalcoins,
            "gamebalance": int(gamewallet.balance or 0),
            "storebalance": int(storewallet.balance or 0),
            "reference": payment_ref
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": f"Credit failed: {str(e)}"}), 500
        


@app.route("/api/external/store/wallet-balance/<int:userid>", methods=["GET"])
def external_store_wallet_balance(userid):
    if not verify_store_api_request(request):
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    user = User.query.get(userid)
    if not user or getattr(user, "isadmin", False):
        return jsonify({"success": False, "message": "User not found"}), 404

    gamewallet = ensurewalletforuser(user, starting_balance=0)
    storewallet = ensurestorewalletforuser(user, starting_balance=0)

    return jsonify({
        "success": True,
        "userid": user.id,
        "gamebalance": int(gamewallet.balance or 0) if gamewallet else 0,
        "storebalance": int(storewallet.balance or 0) if storewallet else 0
    })


@app.route("/api/wallet/summary", methods=["GET"])
@login_required
def apiwalletsummary():
    user = getcurrentloggedinuser()
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    gamewallet = ensurewalletforuser(user, starting_balance=0)
    storewallet = ensurestorewalletforuser(user, starting_balance=0)

    recent = WalletTransfer.query.filter_by(userid=user.id).order_by(WalletTransfer.createdat.desc()).limit(10).all()

    return jsonify({
        "success": True,
        "gamebalance": int(gamewallet.balance or 0) if gamewallet else 0,
        "storebalance": int(storewallet.balance or 0) if storewallet else 0,
        "recent_transfers": [
            {
                "id": r.id,
                "direction": r.direction,
                "amount": int(r.amount or 0),
                "status": r.status or "",
                "note": r.note or "",
                "createdat": fmtist(r.createdat, "%d %b %Y, %I:%M %p") if r.createdat else ""
            }
            for r in recent
        ]
    })


@app.route("/api/wallet/history", methods=["GET"])
@login_required
def apiwallethistory():
    user = getcurrentloggedinuser()
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    game_rows = Transaction.query.filter_by(userid=user.id).filter(
        Transaction.kind.in_(["added", "redeem"])
    ).order_by(Transaction.datetime.desc()).limit(100).all()

    store_rows = StoreTransaction.query.filter_by(userid=user.id).order_by(
        StoreTransaction.createdat.desc()
    ).limit(100).all()

    transfer_rows = WalletTransfer.query.filter_by(userid=user.id).order_by(
        WalletTransfer.createdat.desc()
    ).limit(100).all()

    return jsonify({
        "success": True,
        "game_transactions": [
            {
                "id": t.id,
                "kind": t.kind,
                "amount": int(t.amount or 0),
                "balanceafter": int(t.balanceafter or 0),
                "label": t.label or "",
                "gametitle": t.gametitle or "",
                "note": t.note or "",
                "datetime": fmtist(t.datetime, "%d %b %Y, %I:%M %p") if t.datetime else ""
            }
            for t in game_rows
        ],
        "store_transactions": [
            {
                "id": s.id,
                "kind": s.kind,
                "amount": int(s.amount or 0),
                "balanceafter": int(s.balanceafter or 0),
                "label": s.label or "",
                "note": s.note or "",
                "reference": s.reference or "",
                "createdat": fmtist(s.createdat, "%d %b %Y, %I:%M %p") if s.createdat else ""
            }
            for s in store_rows
        ],
        "transfers": [
            {
                "id": w.id,
                "direction": w.direction,
                "amount": int(w.amount or 0),
                "status": w.status or "",
                "note": w.note or "",
                "createdat": fmtist(w.createdat, "%d %b %Y, %I:%M %p") if w.createdat else ""
            }
            for w in transfer_rows
        ]
    })


@app.route("/api/store/buy-card", methods=["POST"])
@login_required
def buy_card():
    user = get_current_logged_in_user()
    if not user:
        return jsonify(success=False, message="User not found"), 404

    data = request.get_json(silent=True) or {}
    card_value = _safe_int(data.get("card_value") or data.get("cardvalue"), 0)
    quantity = _safe_int(data.get("quantity"), 1)

    if card_value not in ALLOWED_CARD_VALUES:
        return jsonify(success=False, message="Invalid card value"), 400

    if quantity <= 0:
        return jsonify(success=False, message="Invalid quantity"), 400

    total_coins = card_value * quantity
    reference = f"CARD{int(time.time())}{user.id}"

    try:
        game_wallet = ensure_wallet_for_user(user, starting_balance=0)
        ensure_store_wallet_for_user(user, starting_balance=0)

        game_wallet.balance = int(game_wallet.balance or 0) + total_coins

        game_tx = Transaction(
            user_id=user.id,
            kind="added",
            amount=total_coins,
            balance_after=int(game_wallet.balance or 0),
            label="Point Card Added",
            game_title="Store Card",
            note=f"Bought {quantity} card(s) of {card_value}"
        )

        purchase = PointCardPurchase(
            user_id=user.id,
            card_value=card_value,
            quantity=quantity,
            total_coins=total_coins,
            payment_status="PAID"
        )

        transfer = WalletTransfer(
            user_id=user.id,
            direction="STORE_TO_GAME",
            amount=total_coins,
            status="SUCCESS",
            note=f"Card purchase reference {reference}"
        )

        db.session.add(game_tx)
        db.session.add(purchase)
        db.session.add(transfer)
        db.session.commit()

        return jsonify(
            success=True,
            message="Coins added successfully",
            added=total_coins,
            game_balance=int(game_wallet.balance or 0),
            reference=reference
        )
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, message=f"Buy card failed: {str(e)}"), 500


@app.route("/api/wallet/redeem-to-store", methods=["POST"])
@app.route("/api/store/redeem-from-game", methods=["POST"])
@login_required
def redeem_from_game():
    user = get_current_logged_in_user()
    if not user:
        return jsonify(success=False, message="User not found"), 404

    data = request.get_json(silent=True) or {}
    amount = _safe_int(data.get("amount"), 0)

    if amount <= 0:
        return jsonify(success=False, message="Enter valid amount"), 400

    try:
        game_wallet = ensure_wallet_for_user(user, starting_balance=0)
        store_wallet = ensure_store_wallet_for_user(user, starting_balance=0)

        if int(game_wallet.balance or 0) < amount:
            return jsonify(success=False, message="Insufficient game balance"), 400

        game_wallet.balance = int(game_wallet.balance or 0) - amount
        store_wallet.balance = int(store_wallet.balance or 0) + amount

        game_tx = Transaction(
            user_id=user.id,
            kind="redeem",
            amount=amount,
            balance_after=int(game_wallet.balance or 0),
            label="Moved To Store Wallet",
            game_title="Store Transfer",
            note=f"Game to store transfer of {amount}"
        )

        store_tx = StoreTransaction(
            user_id=user.id,
            kind="game_to_store",
            amount=amount,
            balance_after=int(store_wallet.balance or 0),
            label="Received From Game Wallet",
            note=f"Game to store transfer of {amount}"
        )

        transfer = WalletTransfer(
            user_id=user.id,
            direction="GAME_TO_STORE",
            amount=amount,
            status="SUCCESS",
            note="Redeemed back to store wallet"
        )

        db.session.add(game_tx)
        db.session.add(store_tx)
        db.session.add(transfer)
        db.session.commit()

        return jsonify(
            success=True,
            message="Amount moved to store wallet",
            game_balance=int(game_wallet.balance or 0),
            store_balance=int(store_wallet.balance or 0)
        )
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, message=f"Redeem failed: {str(e)}"), 500


@app.route("/api/store/checkout", methods=["POST"])
@login_required
def store_checkout():
    user = get_current_logged_in_user()
    if not user:
        return jsonify(success=False, message="User not found"), 404

    data = request.get_json(silent=True) or {}
    items = data.get("items") or []
    address_id = data.get("address_id") or data.get("addressid")
    note = (data.get("note") or "").strip()

    if not isinstance(items, list) or not items:
        return jsonify(success=False, message="Cart is empty"), 400

    try:
        store_wallet = ensure_store_wallet_for_user(user, starting_balance=0)

        address = None
        if address_id not in (None, "", 0, "0"):
            address = UserAddress.query.filter_by(
                id=_safe_int(address_id, 0),
                user_id=user.id
            ).first()
            if not address:
                return jsonify(success=False, message="Address not found"), 404

        subtotal = 0
        product_rows = []

        for item in items:
            product_id = _safe_int(item.get("product_id") or item.get("productid"), 0)
            qty = _safe_int(item.get("qty") or item.get("quantity"), 1)

            if product_id <= 0 or qty <= 0:
                return jsonify(success=False, message="Invalid cart item"), 400

            product = Product.query.get(product_id)
            if not product or not product.is_active:
                return jsonify(success=False, message="Product not available"), 404

            if int(product.stock or 0) < qty:
                return jsonify(success=False, message=f"Insufficient stock for {product.title}"), 400

            line_total = int(product.price or 0) * qty
            subtotal += line_total
            product_rows.append((product, qty, line_total))

        total = subtotal

        if int(store_wallet.balance or 0) < total:
            return jsonify(success=False, message="Insufficient store wallet balance"), 400

        store_wallet.balance = int(store_wallet.balance or 0) - total

        order = StoreOrder(
            user_id=user.id,
            address_id=address.id if address else None,
            order_code=make_order_code(user.id),
            subtotal=subtotal,
            total=total,
            status="PLACED",
            payment_mode="STORE_WALLET",
            note=note or None
        )
        db.session.add(order)
        db.session.flush()

        for product, qty, line_total in product_rows:
            product.stock = int(product.stock or 0) - qty
            db.session.add(StoreOrderItem(
                order_id=order.id,
                product_id=product.id,
                product_title=product.title,
                unit_price=int(product.price or 0),
                qty=qty,
                line_total=line_total
            ))

        store_tx = StoreTransaction(
            user_id=user.id,
            kind="product_purchase",
            amount=total,
            balance_after=int(store_wallet.balance or 0),
            label="Order placed",
            note=f"Order {order.order_code}",
            reference=order.order_code
        )
        db.session.add(store_tx)

        db.session.commit()

        return jsonify(
            success=True,
            message="Order placed successfully",
            order_code=order.order_code,
            total=total,
            store_balance=int(store_wallet.balance or 0)
        )
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, message=f"Checkout failed: {str(e)}"), 500


@app.route("/api/store/products", methods=["GET"])
@login_required
def api_store_products():
    products = Product.query.filter_by(is_active=True).order_by(Product.created_at.desc()).all()

    return jsonify([
        {
            "id": p.id,
            "title": p.title,
            "slug": p.slug,
            "description": p.description or "",
            "price": int(p.price or 0),
            "stock": int(p.stock or 0),
            "image_url": p.image_url or "",
            "is_active": bool(p.is_active),
        }
        for p in products
    ])


@app.route("/api/admin/store/products", methods=["GET", "POST"])
@admin_required
def api_admin_store_products():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}

        title = (data.get("title") or "").strip()
        slug = (data.get("slug") or "").strip().lower()
        description = (data.get("description") or "").strip()
        price = _safe_int(data.get("price"), 0)
        stock = _safe_int(data.get("stock"), 0)
        image_url = (data.get("image_url") or data.get("imageurl") or "").strip()

        if not title or not slug:
            return jsonify(success=False, message="Title and slug are required"), 400

        if price <= 0:
            return jsonify(success=False, message="Price must be greater than 0"), 400

        if stock < 0:
            return jsonify(success=False, message="Stock cannot be negative"), 400

        if Product.query.filter_by(slug=slug).first():
            return jsonify(success=False, message="Slug already exists"), 400

        try:
            product = Product(
                title=title,
                slug=slug,
                description=description or None,
                price=price,
                stock=stock,
                image_url=image_url or None,
                is_active=True
            )
            db.session.add(product)
            db.session.commit()

            return jsonify(success=True, message="Product created", product_id=product.id)
        except Exception as e:
            db.session.rollback()
            return jsonify(success=False, message=f"Product create failed: {str(e)}"), 500

    products = Product.query.order_by(Product.created_at.desc()).all()
    return jsonify([
        {
            "id": p.id,
            "title": p.title,
            "slug": p.slug,
            "price": int(p.price or 0),
            "stock": int(p.stock or 0),
            "is_active": bool(p.is_active),
            "created_at": fmt_ist(p.created_at, "%Y-%m-%d %H:%M") if p.created_at else ""
        }
        for p in products
    ])

@app.route("/api/admin/wallet/transfers", methods=["GET"])
@admin_required
def apiadminwallettransfers():
    rows = WalletTransfer.query.order_by(WalletTransfer.createdat.desc()).limit(500).all()
    out = []
    for r in rows:
        u = User.query.get(r.userid)
        out.append({
            "id": r.id,
            "userid": r.userid,
            "username": u.username if u else "Unknown",
            "direction": r.direction,
            "amount": int(r.amount or 0),
            "status": r.status or "",
            "note": r.note or "",
            "createdat": fmtist(r.createdat, "%d %b %Y, %I:%M %p") if r.createdat else ""
        })
    return jsonify({"success": True, "items": out})


@app.route("/api/admin/wallet/purchase-credits", methods=["GET"])
@admin_required
def apiadminwalletpurchasecredits():
    rows = StoreTransaction.query.filter_by(kind="external_store_credit").order_by(
        StoreTransaction.createdat.desc()
    ).limit(500).all()

    out = []
    for r in rows:
        u = User.query.get(r.userid)
        out.append({
            "id": r.id,
            "userid": r.userid,
            "username": u.username if u else "Unknown",
            "amount": int(r.amount or 0),
            "balanceafter": int(r.balanceafter or 0),
            "label": r.label or "",
            "note": r.note or "",
            "reference": r.reference or "",
            "createdat": fmtist(r.createdat, "%d %b %Y, %I:%M %p") if r.createdat else ""
        })

    return jsonify({"success": True, "items": out})

@app.route("/api/store/addresses", methods=["GET", "POST"])
@login_required
def api_store_addresses():
    user = get_current_logged_in_user()
    if not user:
        return jsonify(success=False, message="User not found"), 404

    if request.method == "POST":
        data = request.get_json(silent=True) or {}

        full_name = (data.get("full_name") or data.get("fullname") or "").strip()
        phone = (data.get("phone") or "").strip()
        line1 = (data.get("line1") or "").strip()
        line2 = (data.get("line2") or "").strip()
        city = (data.get("city") or "").strip()
        state = (data.get("state") or "").strip()
        pincode = (data.get("pincode") or "").strip()
        country = (data.get("country") or "India").strip()
        is_default = bool(data.get("is_default") or data.get("isdefault"))

        if not full_name or not phone or not line1 or not city or not state or not pincode:
            return jsonify(success=False, message="Missing address fields"), 400

        try:
            if is_default:
                UserAddress.query.filter_by(user_id=user.id, is_default=True).update({"is_default": False})

            address = UserAddress(
                user_id=user.id,
                full_name=full_name,
                phone=phone,
                line1=line1,
                line2=line2 or None,
                city=city,
                state=state,
                pincode=pincode,
                country=country,
                is_default=is_default
            )
            db.session.add(address)
            db.session.commit()

            return jsonify(success=True, message="Address saved", address_id=address.id)
        except Exception as e:
            db.session.rollback()
            return jsonify(success=False, message=f"Address save failed: {str(e)}"), 500

    addresses = UserAddress.query.filter_by(user_id=user.id).order_by(UserAddress.created_at.desc()).all()
    return jsonify([
        {
            "id": a.id,
            "full_name": a.full_name,
            "phone": a.phone,
            "line1": a.line1,
            "line2": a.line2 or "",
            "city": a.city,
            "state": a.state,
            "pincode": a.pincode,
            "country": a.country,
            "is_default": bool(a.is_default),
        }
        for a in addresses
    ])




@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))

@app.route('/agent/logout')
@app.route('/agent-logout')
@app.route('/agentlogout')
def agent_logout():
    for k in ('agent_id', 'agentid', 'agentId', 'agentID', 'agentusername'):
        session.pop(k, None)
    session.permanent = False
    return redirect('/agent/login')
@app.route('/agent')
@agent_required
def agent_panel():
    return render_template('agent_panel.html')  # <-- your HTML file

@app.route('/api/agent/profile')
@agent_required
def api_agent_profile():
    a = Agent.query.get(int(get_session_agent_id()))
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    return jsonify({
        'name': a.name,
        'username': a.username,
        'salarypercent': float(a.salarypercent or 0),
        'status': 'BLOCKED' if a.isblocked else 'ACTIVE'
    })

@app.route('/api/agent/salary')
@agent_required
def api_agent_salary():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    from_str = request.args.get('from')
    to_str = request.args.get('to')

    from_dt = _parse_from_date(from_str)
    to_dt = _parse_to_date(to_str)

    summary = _build_agent_commission_data(
        agent,
        from_dt=from_dt,
        to_dt=to_dt,
        include_history=False
    )

    paid_salary = _payment_total(aid, from_dt=from_dt, to_dt=to_dt)
    total_salary = round(summary["totalsalary"], 2)
    pending_salary = round(max(total_salary - paid_salary, 0), 2)

    last_payment = (
        AgentSalaryPayment.query
        .filter_by(agentid=aid)
        .order_by(AgentSalaryPayment.paidat.desc())
        .first()
    )

    items = []
    for row in summary["items"]:
        amount_played = int((row.get("eligibleplayed") or 0) + (row.get("blockedplayed") or 0))
        items.append({
            "userid": row["userid"],
            "username": row.get("username", ""),
            "joining": row["joining"],
            "amountplayed": amount_played,
            "salarygenerated": round(row["salarygenerated"], 2),
        })

    total_played = int((summary.get("eligibleplayed") or 0) + (summary.get("blockedplayed") or 0))

    return jsonify({
        "totalplayed": total_played,
        "totalsalary": total_salary,
        "totalpaid": paid_salary,
        "pendingsalary": pending_salary,
        "lastpaidat": fmt_ist(last_payment.paidat, '%Y-%m-%d %H:%M') if last_payment and last_payment.paidat else "",
        "items": items,
    })


@app.route('/api/agent/salary-payments', methods=['GET'])
@agent_required
def api_agent_salary_payments():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    from_dt = _parse_from_date(request.args.get('from'))
    to_dt = _parse_to_date(request.args.get('to'))

    q = AgentSalaryPayment.query.filter_by(agentid=aid)

    if from_dt:
        q = q.filter(AgentSalaryPayment.paidat >= from_dt)
    if to_dt:
        q = q.filter(AgentSalaryPayment.paidat < to_dt)

    rows = q.order_by(AgentSalaryPayment.paidat.desc()).all()

    items = []
    for p in rows:
        items.append({
            'id': p.id,
            'agentid': p.agentid,
            'agentname': agent.name or '-',
            'amountpaid': round(_safe_float(p.amountpaid), 2),
            'periodfrom': p.periodfrom.strftime('%Y-%m-%d') if p.periodfrom else '',
            'periodto': p.periodto.strftime('%Y-%m-%d') if p.periodto else '',
            'paidat': fmt_ist(p.paidat, '%Y-%m-%d %H:%M') if p.paidat else '',
            'paidby': p.paidby or 'admin',
            'referenceno': p.referenceno or '',
            'note': p.note or ''
        })

    return jsonify({
        'items': items,
        'totalpaid': round(sum(_safe_float(x['amountpaid']) for x in items), 2)
    })

    
@app.route('/api/agent/commission-history', methods=['GET'])
@agent_required
def api_agent_commission_history():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    from_dt = _parse_from_date(request.args.get('from'))
    to_dt = _parse_to_date(request.args.get('to'))
    limit = request.args.get('limit', 200, type=int)

    summary = _build_agent_commission_data(
        agent,
        from_dt=from_dt,
        to_dt=to_dt,
        include_history=True,
        limit=limit
    )

    return jsonify({
        "agentid": agent.id,
        "agentname": agent.name,
        "salarypercent": float(agent.salarypercent or 0),
        "summary": {
            "rawplayed": int(summary["rawplayed"]),
            "eligibleplayed": int(summary["eligibleplayed"]),
            "blockedplayed": int(summary["blockedplayed"]),
            "totalsalary": round(summary["totalsalary"], 2),
            "blockedsalary": round(summary["blockedsalary"], 2),
        },
        "items": summary["history"]
    })


@app.route('/api/agent/users', methods=['GET', 'POST'])
@agent_required
def api_agent_users():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    if request.method == 'POST':
        data = request.get_json() or {}
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        display_name = (data.get('displayname') or '').strip()
        phone = (data.get('phone') or '').strip()
        email = (data.get('email') or '').strip()
        country = (data.get('country') or '').strip()

        if not username or not password:
            return jsonify(success=False, message="Username and password required"), 400

        if not is_valid_username(username):
            return jsonify(success=False, message="Username cannot contain spaces. Use only letters, numbers, and underscore."), 400

        if User.query.filter_by(username=username).first():
            return jsonify(success=False, message="Username already exists"), 400

        u = User(username=username, agentid=aid, is_admin=False, is_blocked=False)
        u.set_password(password)

        if display_name:
            u.display_name = display_name
        if phone:
            u.phone = phone
        if email:
            u.email = email
        if country:
            u.country = country

        db.session.add(u)
        db.session.commit()
        ensure_wallet_for_user(u, starting_balance=0)
        ensure_store_wallet_for_user(u, starting_balance=0)

        return jsonify(success=True, message="User created", userid=u.id)

    users = User.query.filter_by(agentid=aid).order_by(User.created_at.desc()).all()

    from_dt = _parse_from_date(request.args.get('from'))
    to_dt = _parse_to_date(request.args.get('to'))

    summary = _build_agent_commission_data(
        agent,
        from_dt=from_dt,
        to_dt=to_dt,
        include_history=False
    )
    summary_map = {int(row["userid"]): row for row in summary["items"]}

    out = []
    for u in users:
        row = summary_map.get(int(u.id), {})
        amount_played = int((row.get("eligibleplayed") or 0) + (row.get("blockedplayed") or 0))
        salary_generated = float(row.get("salarygenerated") or 0)

        out.append({
            "userid": u.id,
            "username": u.username,
            "status": "blocked" if u.is_blocked else "active",
            "joining": fmt_ist(u.created_at, "%Y-%m-%d %H:%M") if u.created_at else "",
            "amountplayed": amount_played,
            "salarygenerated": round(salary_generated, 0),
        })

    return jsonify(out)

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


@app.route('/play/<game_type>')
@login_required
def play_game(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404

    game = GAME_CONFIGS[game_type]

    roundcode = (
        request.args.get("roundcode")
        or request.args.get("round_code")
        or ""
    ).strip()

    tablenumber = request.args.get("tablenumber", type=int)
    if tablenumber is None:
        tablenumber = request.args.get("table_number", type=int)

    if roundcode:
        session[f"selected_round_code_{game_type}"] = roundcode
    if tablenumber is not None:
        session[f"selected_table_number_{game_type}"] = tablenumber

    return render_template(
        f"{game_type}-game.html",
        game_type=game_type,
        game=game,
        roundcode=roundcode if roundcode else None,
        tablenumber=tablenumber,
    )
    

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
    wallet_balance = wallet.balance if wallet else 0
    joined_at = user.created_at.strftime("%d %b %Y") if user.created_at else "Just now"

    transactions = (
        Transaction.query.filter_by(user_id=user_id)
        .order_by(Transaction.datetime.desc())
        .limit(50)
        .all()
    )

    txns = []
    for t in transactions:
        txns.append(
            {
                "kind": t.kind,
                "amount": t.amount,
                "datetime": fmt_ist(t.datetime, "%d %b %Y, %I:%M %p") if t.datetime else "",
                "label": t.label or t.kind.title(),
                "game_title": t.game_title or "",
                "note": t.note or "",
                "balance_after": t.balance_after,
            }
        )

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


# ---------------------------------------------------
# TICKET / QUERY RESOLUTION HELPERS
# ---------------------------------------------------

def _ticket_age_days(created_at):
    if not created_at:
        return 0
    now_ist = as_ist(datetime.utcnow())
    created_ist = as_ist(created_at)
    return max((now_ist.date() - created_ist.date()).days, 0)

def _ticket_age_bucket(days_old):
    if days_old <= 0:
        return "0_day"
    if days_old == 1:
        return "1_day"
    if days_old == 2:
        return "2_day"
    return "3_plus_day"

def _staff_name(role):
    if role == "ADMIN":
        uid = session.get("user_id")
        u = User.query.get(uid) if uid else None
        return u.username if u else "admin"
    if role == "SUBADMIN":
        sid = get_session_subadmin_id()
        sa = SubAdmin.query.get(int(sid)) if sid else None
        return sa.username if sa else "subadmin"
    return "system"

def _add_ticket_update(ticket, actor_role, actor_name, update_type, message=None, old_status=None, new_status=None, is_internal=False):
    upd = TicketUpdate(
        ticket_id=ticket.id,
        actor_role=actor_role,
        actor_name=actor_name,
        update_type=update_type,
        old_status=old_status,
        new_status=new_status,
        message=(message or "").strip(),
        is_internal=bool(is_internal),
        created_at=datetime.utcnow(),
    )
    db.session.add(upd)

def _serialize_ticket(ticket, include_updates=False, for_user=False):
    user = User.query.get(ticket.user_id)
    days_old = _ticket_age_days(ticket.created_at)

    data = {
        "id": ticket.id,
        "user_id": ticket.user_id,
        "username": user.username if user and user.username else f"User-{ticket.user_id}",
        "subject": ticket.subject or "",
        "category": ticket.category or "General",
        "message": ticket.message or "",
        "status": (ticket.status or "OPEN").upper(),
        "priority": ticket.priority or "NORMAL",
        "attachment_name": ticket.attachment_name or "",
        "attachment_path": ticket.attachment_path or "",
        "created_at": fmt_ist(ticket.created_at, "%Y-%m-%d %H:%M"),
        "updated_at": fmt_ist(ticket.updated_at, "%Y-%m-%d %H:%M"),
        "last_reply_at": fmt_ist(ticket.last_reply_at, "%Y-%m-%d %H:%M") if ticket.last_reply_at else "",
        "days_old": days_old,
        "age_bucket": _ticket_age_bucket(days_old),
        "closed_at": fmt_ist(ticket.closed_at, "%Y-%m-%d %H:%M") if ticket.closed_at else "",
        "closed_by_role": ticket.closed_by_role or "",
        "closed_by_name": ticket.closed_by_name or "",
    }

    if include_updates:
        q = TicketUpdate.query.filter_by(ticket_id=ticket.id).order_by(TicketUpdate.created_at.asc()).all()
        updates = []
        for u in q:
            if for_user and u.is_internal:
                continue
            updates.append({
                "id": u.id,
                "actor_role": u.actor_role,
                "actor_name": u.actor_name or "",
                "update_type": u.update_type,
                "old_status": u.old_status or "",
                "new_status": u.new_status or "",
                "message": u.message or "",
                "is_internal": bool(u.is_internal),
                "time": fmt_ist(u.created_at, "%Y-%m-%d %H:%M"),
            })
        data["updates"] = updates

    return data

def _filtered_ticket_list():
    q = (request.args.get("q") or "").strip().lower()
    status = (request.args.get("status") or "all").strip().upper()
    age = (request.args.get("age") or "all").strip()

    rows = Ticket.query.order_by(Ticket.created_at.desc()).all()
    out = []

    for t in rows:
        row = _serialize_ticket(t, include_updates=False, for_user=False)

        if q:
            hay = " ".join([
                str(row["id"]),
                row["username"].lower(),
                row["subject"].lower(),
                row["category"].lower(),
                row["status"].lower(),
            ])
            if q not in hay:
                continue

        if status != "ALL" and row["status"] != status:
            continue

        if age != "all" and row["age_bucket"] != age:
            continue

        out.append(row)

    return out


# ---------------------------------------------------
# USER HELP / TICKETS
# ---------------------------------------------------

@app.route("/help")
@login_required
def help_page():
    return render_template("help.html")


@app.route("/api/help/tickets", methods=["GET", "POST"])
@login_required
def help_tickets_api():
    user_id = session.get("user_id")

    if request.method == "GET":
        tickets = Ticket.query.filter_by(user_id=user_id).order_by(Ticket.created_at.desc()).all()
        return jsonify([_serialize_ticket(t, include_updates=False, for_user=True) for t in tickets])

    subject = (request.form.get("subject") or "").strip() or "(no subject)"
    category = (request.form.get("category") or "General").strip() or "General"
    message = (request.form.get("message") or "").strip()
    file = request.files.get("attachment")

    if not message:
        return jsonify({"success": False, "message": "Message required"}), 400

    attachment_name = None
    attachment_path = None
    if file and file.filename:
        upload_dir = os.path.join(os.path.dirname(__file__), "uploads", "tickets")
        os.makedirs(upload_dir, exist_ok=True)
        safe_name = secure_filename(file.filename)
        attachment_name = f"{int(time.time())}_{safe_name}"
        attachment_path = os.path.join(upload_dir, attachment_name)
        file.save(attachment_path)

    ticket = Ticket(
        user_id=user_id,
        subject=subject,
        category=category,
        message=message,
        status="OPEN",
        attachment_name=attachment_name,
        attachment_path=attachment_path,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        last_reply_at=datetime.utcnow(),
    )
    db.session.add(ticket)
    db.session.flush()

    user = User.query.get(user_id)
    _add_ticket_update(
        ticket,
        actor_role="USER",
        actor_name=user.username if user else "user",
        update_type="CREATED",
        message=message,
        old_status="",
        new_status="OPEN",
        is_internal=False,
    )

    db.session.commit()
    return jsonify({"success": True, "ticket_id": ticket.id, "message": "Complaint submitted"})


@app.route("/api/help/tickets/<int:ticket_id>", methods=["GET"])
@login_required
def help_ticket_detail_api(ticket_id):
    user_id = session.get("user_id")
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=user_id).first()
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404
    return jsonify(_serialize_ticket(ticket, include_updates=True, for_user=True))


# ---------------------------------------------------
# ADMIN TICKETS
# ---------------------------------------------------

@app.route("/api/admin/tickets", methods=["GET"])
@admin_required
def api_admin_tickets():
    return jsonify(_filtered_ticket_list())


@app.route("/api/admin/tickets/<int:ticket_id>", methods=["GET"])
@admin_required
def api_admin_ticket_detail(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404
    return jsonify(_serialize_ticket(ticket, include_updates=True, for_user=False))


@app.route("/api/admin/tickets/<int:ticket_id>/reply", methods=["POST"])
@admin_required
def api_admin_ticket_reply(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404

    if (ticket.status or "").upper() == "CLOSED":
        return jsonify({"success": False, "message": "Closed ticket cannot be updated"}), 403

    data = request.get_json() or {}
    message = (data.get("message") or "").strip()
    new_status = (data.get("status") or "").strip().upper()
    is_internal = bool(data.get("is_internal", False))

    if not message and not new_status:
        return jsonify({"success": False, "message": "Reply or status required"}), 400

    if new_status == "CLOSED":
        return jsonify({"success": False, "message": "Use close API for closing"}), 400

    allowed = {"OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", ""}
    if new_status not in allowed:
        return jsonify({"success": False, "message": "Invalid status"}), 400

    old_status = (ticket.status or "OPEN").upper()

    if new_status:
        ticket.status = new_status
    ticket.updated_at = datetime.utcnow()
    ticket.last_reply_at = datetime.utcnow()

    _add_ticket_update(
        ticket,
        actor_role="ADMIN",
        actor_name=_staff_name("ADMIN"),
        update_type="NOTE" if is_internal and message else ("STATUS" if new_status and not message else "REPLY"),
        message=message,
        old_status=old_status,
        new_status=ticket.status,
        is_internal=is_internal,
    )

    db.session.commit()
    return jsonify({"success": True, "message": "Ticket updated"})

from flask import send_file

@app.route('/api/admin/tickets/<int:ticket_id>/attachment', methods=['GET'])
@admin_required
def api_admin_ticket_attachment(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404

    if not ticket.attachment_path or not os.path.exists(ticket.attachment_path):
        return jsonify({"success": False, "message": "Attachment not found"}), 404

    return send_file(
        ticket.attachment_path,
        as_attachment=False,
        download_name=ticket.attachment_name or "attachment"
    )


@app.route("/api/admin/tickets/<int:ticket_id>/close", methods=["POST"])
@admin_required
def api_admin_ticket_close(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404

    data = request.get_json() or {}
    close_note = (data.get("message") or "Closed by admin").strip()

    old_status = (ticket.status or "OPEN").upper()
    ticket.status = "CLOSED"
    ticket.updated_at = datetime.utcnow()
    ticket.last_reply_at = datetime.utcnow()
    ticket.closed_at = datetime.utcnow()
    ticket.closed_by_role = "ADMIN"
    ticket.closed_by_name = _staff_name("ADMIN")

    _add_ticket_update(
        ticket,
        actor_role="ADMIN",
        actor_name=ticket.closed_by_name,
        update_type="CLOSED",
        message=close_note,
        old_status=old_status,
        new_status="CLOSED",
        is_internal=False,
    )

    db.session.commit()
    return jsonify({"success": True, "message": "Ticket closed"})


@app.route("/api/admin/tickets/<int:ticket_id>/reopen", methods=["POST"])
@admin_required
def api_admin_ticket_reopen(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404

    data = request.get_json() or {}
    reopen_note = (data.get("message") or "Reopened by admin").strip()

    old_status = (ticket.status or "CLOSED").upper()
    ticket.status = "OPEN"
    ticket.updated_at = datetime.utcnow()
    ticket.last_reply_at = datetime.utcnow()
    ticket.closed_at = None
    ticket.closed_by_role = None
    ticket.closed_by_name = None

    _add_ticket_update(
        ticket,
        actor_role="ADMIN",
        actor_name=_staff_name("ADMIN"),
        update_type="REOPENED",
        message=reopen_note,
        old_status=old_status,
        new_status="OPEN",
        is_internal=False,
    )

    db.session.commit()
    return jsonify({"success": True, "message": "Ticket reopened"})


# ---------------------------------------------------
# SUBADMIN TICKETS
# ---------------------------------------------------

@app.route("/api/subadmin/tickets", methods=["GET"])
@subadmin_required
def api_subadmin_tickets():
    return jsonify(_filtered_ticket_list())


@app.route("/api/subadmin/tickets/<int:ticket_id>", methods=["GET"])
@subadmin_required
def api_subadmin_ticket_detail(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404
    return jsonify(_serialize_ticket(ticket, include_updates=True, for_user=False))


@app.route("/api/subadmin/tickets/<int:ticket_id>/reply", methods=["POST"])
@subadmin_required
def api_subadmin_ticket_reply(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404

    if (ticket.status or "").upper() == "CLOSED":
        return jsonify({"success": False, "message": "Closed ticket cannot be updated"}), 403

    data = request.get_json() or {}
    message = (data.get("message") or "").strip()
    new_status = (data.get("status") or "").strip().upper()
    is_internal = bool(data.get("is_internal", False))

    if new_status == "CLOSED":
        return jsonify({"success": False, "message": "Only admin can close ticket"}), 403

    allowed = {"OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", ""}
    if new_status not in allowed:
        return jsonify({"success": False, "message": "Invalid status"}), 400

    if not message and not new_status:
        return jsonify({"success": False, "message": "Reply or status required"}), 400

    old_status = (ticket.status or "OPEN").upper()

    if new_status:
        ticket.status = new_status
    ticket.updated_at = datetime.utcnow()
    ticket.last_reply_at = datetime.utcnow()

    _add_ticket_update(
        ticket,
        actor_role="SUBADMIN",
        actor_name=_staff_name("SUBADMIN"),
        update_type="NOTE" if is_internal and message else ("STATUS" if new_status and not message else "REPLY"),
        message=message,
        old_status=old_status,
        new_status=ticket.status,
        is_internal=is_internal,
    )

    db.session.commit()
    return jsonify({"success": True, "message": "Ticket updated"})


from flask import send_file

@app.route('/api/subadmin/tickets/<int:ticket_id>/attachment', methods=['GET'])
@subadmin_required
def api_subadmin_ticket_attachment(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404

    if not ticket.attachment_path or not os.path.exists(ticket.attachment_path):
        return jsonify({"success": False, "message": "Attachment not found"}), 404

    return send_file(
        ticket.attachment_path,
        as_attachment=False,
        download_name=ticket.attachment_name or "attachment"
    )


@app.route("/coins", methods=["GET"])
@login_required
def coins_page():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return redirect(url_for("logout"))

    wallet = ensure_wallet_for_user(user)
    balance = wallet.balance if wallet else 0
    return render_template("coins.html", balance=balance)


@app.route("/api/balance", methods=["GET"])
@login_required
def get_balance_api():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return jsonify({"balance": 0}), 401

    wallet = ensure_wallet_for_user(user)
    balance = wallet.balance if wallet else 0
    return jsonify({"balance": balance})


@app.route("/api/coins/redeem", methods=["POST"])
@login_required
def redeem_coins():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
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
        amount=int(amount),
        balance_after=int(wallet.balance),
        label="Redeem Coins",
        game_title="",
        note="User redeemed coins",
    )
    db.session.add(tx)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Successfully redeemed {amount} coins!",
        "new_balance": wallet.balance
    })



@app.route("/balance/<user_id>")
def get_balance(user_id):
    real_user_id = session.get("user_id")
    if not real_user_id:
        return jsonify({"balance": 0})

    user = User.query.get(real_user_id)
    if not user:
        return jsonify({"balance": 0})

    wallet = ensure_wallet_for_user(user)
    return jsonify({"balance": wallet.balance if wallet else 0})


# ---------------------------------------------------
# ADMIN PANEL ROUTES
# ---------------------------------------------------


def _get_user_history_store():
    # supports both variable names used across your versions
    return globals().get("user_game_history") or globals().get("usergamehistory") or {}

def _get_game_tables_store():
    return globals().get("game_tables") or globals().get("gametables") or {}

def _fmt_ist(dt, fmt="%Y-%m-%d %H:%M"):
    f = globals().get("fmt_ist") or globals().get("fmtist")
    return f(dt, fmt) if f else (dt.strftime(fmt) if dt else "")

def _ensure_wallet(user):
    fn = globals().get("ensure_wallet_for_user") or globals().get("ensurewalletforuser")
    return fn(user) if fn else None

def _create_wallet_for_user(user_id: int, starting_balance: int = 0):
    w = Wallet.query.filter_by(user_id=user_id).first()
    if w:
        return w
    w = Wallet(user_id=user_id, balance=int(starting_balance or 0))
    db.session.add(w)
    db.session.commit()
    return w



def _is_admin_user(user):
    return bool(getattr(user, "is_admin", False) or getattr(user, "isadmin", False) or getattr(user, "isAdmin", False))

def _is_blocked_user(user):
    return bool(getattr(user, "is_blocked", False) or getattr(user, "isblocked", False) or getattr(user, "isBlocked", False))

def _get_block_reason(user):
    return (getattr(user, "block_reason", None)
            or getattr(user, "blockreason", None)
            or getattr(user, "blockReason", None)
            or "")

def _set_block_reason(user, val):
    if hasattr(user, "block_reason"):
        user.block_reason = val
    elif hasattr(user, "blockreason"):
        user.blockreason = val
    else:
        # last fallback
        setattr(user, "block_reason", val)

def _set_blocked(user, is_blocked: bool):
    if hasattr(user, "is_blocked"):
        user.is_blocked = bool(is_blocked)
    elif hasattr(user, "isblocked"):
        user.isblocked = bool(is_blocked)
    else:
        setattr(user, "is_blocked", bool(is_blocked))

def _get_created_at(user):
    return getattr(user, "created_at", None) or getattr(user, "createdat", None) or getattr(user, "createdAt", None)

def _parse_round_start_from_roundcode(roundcode: str):
    """
    Current format: G_YYYYMMDD_HHMM_TABLE
    Example: G_20260217_2200_1
    Returns timezone-aware IST datetime if IST exists, else naive datetime.
    """
    try:
        s = str(roundcode or "").strip()
        parts = s.split("_")
        if len(parts) != 4:
            return None

        date_part = parts[1]
        time_part = parts[2]
        dt = datetime.strptime(f"{date_part}{time_part}", "%Y%m%d%H%M")

        ist = globals().get("IST", None)
        return dt.replace(tzinfo=ist) if ist else dt
    except Exception:
        return None

def _group_user_rounds(user_id: int):
    """
    Groups user bet history into per-round rows.
    Uses in-memory store (user_game_history/usergamehistory).
    """
    store = _get_user_history_store()
    bets = store.get(user_id, []) or []

    grouped = {}  # key=(gametype, roundcode, tablenumber) -> row

    for b in bets:
        gametype = b.get("gametype") or b.get("game_type") or b.get("gameType") or "-"
        roundcode = b.get("roundcode") or b.get("round_code") or b.get("roundCode") or "-"
        tablenumber = b.get("tablenumber") or b.get("table_number") or b.get("tableNumber") or 0

        key = (gametype, roundcode, tablenumber)
        if key not in grouped:
            start_dt = _parse_round_start_from_roundcode(roundcode)
            grouped[key] = {
                "roundid": roundcode,
                "roundcode": roundcode,
                "gametype": gametype,
                "game_type": gametype,

                "tablenumber": tablenumber,
                "table_number": tablenumber,

                "bettingnumbers": [],
                "numbers": [],

                "totalbet": 0,
                "winningnumber": None,
                "winning_number": None,

                "netamount": 0,          # winning/losing amount (net)
                "result": "pending",

                "datetime": _fmt_ist(start_dt, "%Y-%m-%d %H:%M") if start_dt else "",
                "date_time": _fmt_ist(start_dt, "%Y-%m-%d %H:%M") if start_dt else "",
            }

        # numbers
        num = b.get("number")
        if num is not None:
            grouped[key]["bettingnumbers"].append(num)
            grouped[key]["numbers"].append(num)

        # total bet
        bet_amt = b.get("betamount") or b.get("bet_amount") or 0
        try:
            grouped[key]["totalbet"] += int(bet_amt)
        except Exception:
            pass

        # winning number
        wn = b.get("winningnumber")
        if wn is None:
            wn = b.get("winning_number")
        if wn is not None:
            grouped[key]["winningnumber"] = wn
            grouped[key]["winning_number"] = wn

        # net amount (your history uses +payout for win, -betamount for loss) [file:106]
        amt = b.get("amount", 0)
        try:
            grouped[key]["netamount"] += int(amt or 0)
        except Exception:
            pass

    # finalize each grouped row
    out = []
    for row in grouped.values():
        # unique/sorted numbers
        nums = []
        for n in row["bettingnumbers"]:
            try:
                nums.append(int(n))
            except Exception:
                continue
        nums = sorted(set(nums))
        row["bettingnumbers"] = nums
        row["numbers"] = nums

        # result
        if row["winningnumber"] is None:
            row["result"] = "pending"
        else:
            row["result"] = "win" if row["netamount"] > 0 else "lose"

        out.append(row)

    # newest first (by datetime text)
    out.sort(key=lambda x: x.get("datetime") or "", reverse=True)
    return out


# -----------------------------
# Admin APIs (REPLACE your current ones with these)
# -----------------------------
# ---- Admin page route (must exist, otherwise /admin = 404) ----

@app.route("/admin")
@admin_required
def admin_panel():
    return render_template("admin_panel.html")

@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_get_users():
    # supports both model styles: is_admin OR isadmin [file:106]
    users = User.query.all()
    users = [u for u in users if not _is_admin_user(u)]
    agents_map = {a.id: a for a in Agent.query.all()}


    user_list = []
    for user in users:
        wallet = _ensure_wallet(user)
        created_at = _get_created_at(user)
        joining = _fmt_ist(created_at, "%Y-%m-%d %H:%M") if created_at else ""

        rounds = _group_user_rounds(user.id)
        total_games = len(rounds)

        # "Winning Amount" = total amount WON (sum of positive net entries)
        # (Net profit would be sum(netamount), but you asked winning amount column.)
        winning_amount = 0
        store = _get_user_history_store()
        for rec in (store.get(user.id, []) or []):
            try:
                a = int(rec.get("amount") or 0)
                if a > 0:
                    winning_amount += a
            except Exception:
                pass

        user_list.append({
            "id": user.id,
            "username": getattr(user, "username", "") or "",
            "status": "blocked" if _is_blocked_user(user) else "active",
            "total_games": int(total_games),
            "gamesplayed": int(total_games),           # keeps old frontend mapping working [file:105]
            "winning_amount": int(winning_amount),
            "balance": int(getattr(wallet, "balance", 0) if wallet else 0),
            "agentid": getattr(user, "agentid", None),
            "agentname": (
                agents_map.get(getattr(user, "agentid", None)).name
                if getattr(user, "agentid", None) and agents_map.get(getattr(user, "agentid", None))
                else "-"
            ),


            "joining": joining,
            "created_at": joining,                     # compatibility for older UI [file:105]
            "createdat": joining,                      # compatibility for older UI [file:105]

            # fields for Edit modal
            "email": getattr(user, "email", "") or "",
            "country": getattr(user, "country", "") or "",
            "phone": getattr(user, "phone", "") or "",
            "block_reason": _get_block_reason(user),
            "blockreason": _get_block_reason(user),
        })

    return jsonify(user_list)


@app.route("/api/admin/users/<int:user_id>", methods=["PUT"])
@admin_required
def admin_update_user(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}

    if "username" in data and data["username"]:
        new_username = str(data["username"]).strip()

        if new_username != user.username:
            if not is_valid_username(new_username):
                return jsonify({
                    "success": False,
                    "message": "Username cannot contain spaces. Use only letters, numbers, and underscore."
                }), 400

            existing = User.query.filter(
                User.username == new_username,
                User.id != user.id
            ).first()
            if existing:
                return jsonify({"success": False, "message": "Username already exists"}), 400

            user.username = new_username

    if "email" in data:
        user.email = (data.get("email") or "").strip()

    if ("password" in data) and data.get("password"):
        user.set_password(data["password"])

    if "status" in data:
        _set_blocked(user, str(data.get("status", "")).lower() == "blocked")

    if "block_reason" in data or "blockReason" in data:
        _set_block_reason(user, (data.get("block_reason") or data.get("blockReason") or "").strip())

    db.session.commit()
    return jsonify({"success": True, "message": "User updated successfully"})



@app.route("/api/admin/users/<int:user_id>/block", methods=["POST"])
@admin_required
def admin_block_user(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    _set_blocked(user, True)
    _set_block_reason(user, data.get("reason", "Blocked by admin"))
    db.session.commit()
    return jsonify({"success": True, "message": "User blocked successfully"})


@app.route("/api/admin/users/<int:user_id>/unblock", methods=["POST"])
@admin_required
def admin_unblock_user(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    _set_blocked(user, False)
    _set_block_reason(user, "")
    db.session.commit()
    return jsonify({"success": True, "message": "User unblocked successfully"})


@app.route("/api/admin/users/<int:user_id>/balance", methods=["POST"])
@admin_required
def admin_credit_debit(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    transaction_type = (data.get("type") or "add").lower()
    amount = float(data.get("amount") or 0)
    reason = data.get("reason", "Admin transaction")

    wallet = _ensure_wallet(user)
    if not wallet:
        return jsonify({"success": False, "message": "Wallet not found"}), 404

    if amount < 0:
        amount = abs(amount)

    amount_int = int(amount)

    if transaction_type == "add":
        wallet.balance = int(wallet.balance + amount_int)
        tx_kind = "added"
        tx_label = "Admin Add Balance"
    else:
        wallet.balance = int(wallet.balance - amount_int)
        if wallet.balance < 0:
            wallet.balance = 0
        tx_kind = "redeem"
        tx_label = "Admin Deduct Balance"

    tx = Transaction(
        user_id=user.id,
        kind=tx_kind,
        amount=amount_int,
        balance_after=int(wallet.balance),
        label=tx_label,
        game_title="",
        note=reason,
    )
    db.session.add(tx)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Transaction processed. New balance: {wallet.balance}",
        "new_balance": wallet.balance,
        "reason": reason,
    })


@app.route("/api/admin/games", methods=["GET"])
@admin_required
def admin_get_games():
    tables_store = _get_game_tables_store()
    all_games = []

    for gametype, tables in (tables_store or {}).items():
        for table in (tables or []):
            # supports your GameTable attributes: roundcode/starttime/isfinished/isbettingclosed/maxplayers [file:106]
            roundcode = getattr(table, "round_code", None) or getattr(table, "roundcode", None) or "-"
            starttime = getattr(table, "start_time", None) or getattr(table, "starttime", None)

            bets = getattr(table, "bets", []) or []
            def _bet_amt(b):
                if isinstance(b, dict):
                    return b.get("bet_amount", 0) or b.get("betamount", 0) or 0
                return getattr(b, "bet_amount", 0) or getattr(b, "betamount", 0) or 0

            all_games.append({
                "roundcode": roundcode,
                "round_code": roundcode,  # compatibility
                "gametype": gametype,
                "game_type": gametype,

                "players": len(bets),
                "maxplayers": getattr(table, "max_players", None) or getattr(table, "maxplayers", None) or 0,

                "status": (
                    "finished" if (getattr(table, "is_finished", False) or getattr(table, "isfinished", False))
                    else "completed" if (getattr(table, "is_betting_closed", False) or getattr(table, "isbettingclosed", False))
                    else "active"
                ),
                "result": getattr(table, "result", None),
                "totalbets": int(sum(_bet_amt(b) for b in bets)),
                "total_bets": int(sum(_bet_amt(b) for b in bets)),
                "startedat": _fmt_ist(starttime, "%Y-%m-%d %H:%M") if starttime else "",
                "started_at": _fmt_ist(starttime, "%Y-%m-%d %H:%M") if starttime else "",
            })

    return jsonify(all_games)

from sqlalchemy import or_

def _pick_col(Model, *names):
    for n in names:
        if hasattr(Model, n):
            return getattr(Model, n)
    raise AttributeError(f"{Model.__name__} missing columns: {names}")

def _pick_val(obj, *names):
    for n in names:
        if hasattr(obj, n):
            return getattr(obj, n)
    return None

def _fmt_ist_safe(dt, fmt="%Y-%m-%d %H:%M"):
    f = globals().get("fmt_ist") or globals().get("fmtist")
    return f(dt, fmt) if (f and dt) else ("-" if not dt else dt.strftime(fmt))

@app.route("/api/admin/games/history", methods=["GET"])
@admin_required  # keep whatever decorator name your current file uses
def admingameshistory():
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 100))
    q = (request.args.get("q") or "").strip().lower()

    ROUND = _pick_col(GameRoundHistory, "round_code", "roundcode")
    TYPE  = _pick_col(GameRoundHistory, "game_type", "gametype")
    START = _pick_col(GameRoundHistory, "started_at", "startedat")
    END   = _pick_col(GameRoundHistory, "ended_at", "endedat")

    query = GameRoundHistory.query
    if q:
        query = query.filter(
            or_(
                db.func.lower(ROUND).like(f"%{q}%"),
                db.func.lower(TYPE).like(f"%{q}%")
            )
        )

    total = query.count()
    rows = (query.order_by(END.desc())
                 .offset((page - 1) * limit)
                 .limit(limit)
                 .all())

    items = []
    for r in rows:
        items.append({
            "roundcode": _pick_val(r, "round_code", "roundcode"),
            "gametype": _pick_val(r, "game_type", "gametype"),
            "players": _pick_val(r, "players") or 0,
            "maxplayers": _pick_val(r, "max_players", "maxplayers") or 0,
            "result": _pick_val(r, "result"),
            "totalbets": _pick_val(r, "total_bets", "totalbets") or 0,
            "startedat": _fmt_ist_safe(_pick_val(r, "started_at", "startedat")),
            "status": _pick_val(r, "status") or "finished",
        })

    return jsonify(items=items, page=page, limit=limit, total=total)


@app.route("/api/admin/games/<path:roundcode>/user-bets", methods=["GET"])
@admin_required  # keep your current decorator
def admingameuserbets(roundcode):
    include_bots = (request.args.get("includeBots", "0") == "1")

    def norm(s: str) -> str:
        return (s or "").replace("_", "").strip().lower()

    target = norm(roundcode)

    tables_store = globals().get("game_tables") or globals().get("gametables") or {}
    for gametype, tables in (tables_store or {}).items():
        for t in (tables or []):
            rc = getattr(t, "roundcode", None) or getattr(t, "round_code", None) or ""
            if norm(rc) != target:
                continue

            grouped = {}
            for b in (getattr(t, "bets", None) or []):
                if not isinstance(b, dict):
                    continue
                is_bot = b.get("isbot")
                if is_bot is None:
                    is_bot = b.get("is_bot", False)

                if (not include_bots) and is_bot:
                    continue

                uname = str(b.get("username", ""))
                num = b.get("number", None)
                if num is None:
                    continue
                grouped.setdefault(uname, set()).add(int(num))

            users = [{"username": u, "numbers": sorted(list(ns))} for u, ns in grouped.items()]
            users.sort(key=lambda x: x["username"].lower())
            return jsonify(roundcode=roundcode, users=users)

    return jsonify(roundcode=roundcode, users=[])


@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_get_stats():
    users = User.query.all()
    users = [u for u in users if not _is_admin_user(u)]

    total_users = len(users)
    blocked_users = sum(1 for u in users if _is_blocked_user(u))

    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    store = _get_user_history_store()

    active_users = 0
    for u in users:
        recent = False
        for g in (store.get(u.id, []) or []):
            bt = g.get("bettime") or g.get("bet_time")
            if isinstance(bt, datetime) and bt > thirty_days_ago:
                recent = True
                break
        if recent:
            active_users += 1

    inactive_users = total_users - active_users

    total_revenue = sum((w.balance or 0) for w in Wallet.query.all())
    total_deposit = total_revenue
    total_withdrawal = 0

    tables_store = _get_game_tables_store()
    active_games = sum(
        1
        for tables in (tables_store or {}).values()
        for t in (tables or [])
        if not (getattr(t, "is_finished", False) or getattr(t, "isfinished", False))
    )

    open_tickets = Ticket.query.filter(func.upper(Ticket.status) == "OPEN").count()


    return jsonify({
        "total_users": total_users,
        "active_users": active_users,
        "inactive_users": inactive_users,
        "active_games": active_games,
        "total_revenue": total_revenue,
        "total_deposit": total_deposit,
        "total_withdrawal": total_withdrawal,
        "blocked_users": blocked_users,
        "open_tickets": open_tickets,
    })


@app.route("/api/admin/users/<int:user_id>/games", methods=["GET"])
@admin_required
def admin_user_games(user_id):
    try:
        rows = (
            db.session.query(GameRoundBet, GameRoundHistory)
            .join(GameRoundHistory, GameRoundHistory.roundcode == GameRoundBet.roundcode)
            .filter(GameRoundBet.userid == str(user_id))
            .order_by(GameRoundHistory.endedat.desc(), GameRoundBet.bettime.asc())
            .all()
        )

        grouped = {}

        for bet, hist in rows:
            gametype = getattr(hist, "gametype", None) or getattr(bet, "gametype", None) or "-"
            roundcode = getattr(hist, "roundcode", None) or getattr(bet, "roundcode", None) or "-"
            tablenumber = (
                getattr(hist, "tablenumber", None)
                or getattr(bet, "tablenumber", None)
                or 0
            )

            key = (gametype, roundcode, tablenumber)

            ended_at = getattr(hist, "endedat", None) or getattr(hist, "endtime", None)
            winning_number = getattr(hist, "result", None)
            payout_amt = int((GAMECONFIGS.get(gametype, {}) or {}).get("payout", 0) or 0)

            if key not in grouped:
                grouped[key] = {
                    "roundid": roundcode,
                    "roundcode": roundcode,
                    "gametype": gametype,
                    "game_type": gametype,
                    "tablenumber": tablenumber,
                    "table_number": tablenumber,
                    "bettingnumbers": [],
                    "numbers": [],
                    "totalbet": 0,
                    "winningnumber": winning_number,
                    "winning_number": winning_number,
                    "netamount": 0,
                    "result": "pending",
                    "datetime": fmt_ist(ended_at, "%Y-%m-%d %H:%M") if ended_at else "",
                    "date_time": fmt_ist(ended_at, "%Y-%m-%d %H:%M") if ended_at else "",
                    "_sort_dt": ended_at,
                }

            try:
                num = int(getattr(bet, "number", 0))
                grouped[key]["bettingnumbers"].append(num)
                grouped[key]["numbers"].append(num)
            except Exception:
                num = None

            try:
                bet_amt = int(getattr(bet, "betamount", 0) or 0)
            except Exception:
                bet_amt = 0

            grouped[key]["totalbet"] += bet_amt

            if winning_number is not None and num is not None:
                if num == winning_number:
                    grouped[key]["netamount"] += payout_amt
                else:
                    grouped[key]["netamount"] -= bet_amt

        out = []
        for row in grouped.values():
            nums = []
            for n in row["bettingnumbers"]:
                try:
                    nums.append(int(n))
                except Exception:
                    pass

            nums = sorted(set(nums))
            row["bettingnumbers"] = nums
            row["numbers"] = nums

            if row["winningnumber"] is None:
                row["result"] = "pending"
            else:
                row["result"] = "win" if int(row["netamount"] or 0) > 0 else "lose"

            row.pop("_sort_dt", None)
            out.append(row)

        out.sort(key=lambda x: x.get("datetime", ""), reverse=True)
        return jsonify(out)

    except Exception as e:
        print("admin_user_games DB fallback error:", str(e))
        return jsonify(_group_user_rounds(user_id))


from datetime import datetime
from sqlalchemy import func
from flask import request, jsonify

# ----------------------------
# Agents: List + Create
# ----------------------------


@app.route('/api/admin/agents', methods=['GET', 'POST'])
@admin_required
def admin_agents():
    if request.method == 'POST':
        data = request.get_json() or {}

        name = (data.get('name') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()

        sp = data.get('salarypercent')
        if sp is None:
            sp = data.get('salaryPercent')
        if sp is None:
            sp = data.get('agentSalaryPercent')

        try:
            salarypercent = float(sp or 0)
        except Exception:
            salarypercent = 0.0

        if not name or not username or not password:
            return jsonify(success=False, message='Name, username and password are required'), 400

        if salarypercent < 0 or salarypercent > 100:
            return jsonify(success=False, message='Salary percent must be between 0 and 100'), 400

        if Agent.query.filter_by(username=username).first():
            return jsonify(success=False, message='Agent username already exists'), 400

        a = Agent(
            name=name,
            username=username,
            salarypercent=salarypercent,
            isblocked=False
        )
        a.setpassword(password)
        db.session.add(a)
        db.session.commit()

        return jsonify(success=True, message='Agent created', id=a.id)

    agents = Agent.query.order_by(Agent.createdat.desc()).all()
    out = []

    for a in agents:
        summary = _build_agent_commission_data(a)

        out.append({
            'id': a.id,
            'name': a.name,
            'username': a.username,
            'salarypercent': float(a.salarypercent or 0),
            'isblocked': bool(a.isblocked),
            'blockreason': a.blockreason or '',
            'usercount': int(summary['usercount']),
            'rawplayed': int(summary['rawplayed']),
            'eligibleplayed': int(summary['eligibleplayed']),
            'blockedplayed': int(summary['blockedplayed']),
            'totalplayed': int(summary['eligibleplayed']),   # compatibility for old frontend
            'totalsalary': round(summary['totalsalary'], 2),
            'blockedsalary': round(summary['blockedsalary'], 2),
            'createdat': fmt_ist(a.createdat, '%Y-%m-%d %H:%M') if a.createdat else ''
        })

    return jsonify(out)

# ----------------------------
# Agents: Update (Edit button)
# ----------------------------
@app.route('/api/admin/agents/<int:agentid>', methods=['PUT'])
@admin_required
def adminupdateagent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    data = request.get_json() or {}

    if 'name' in data or 'agentName' in data:
        a.name = (data.get('name') or data.get('agentName') or a.name).strip()

    if 'username' in data or 'agentUsername' in data:
        new_username = (data.get('username') or data.get('agentUsername') or a.username).strip()
        if not new_username:
            return jsonify(success=False, message="Username required"), 400

        existing = Agent.query.filter(Agent.username == new_username, Agent.id != a.id).first()
        if existing:
            return jsonify(success=False, message="Agent username already exists"), 400

        a.username = new_username

    sp = data.get('salarypercent')
    if sp is None:
        sp = data.get('salaryPercent')
    if sp is None:
        sp = data.get('agentSalaryPercent')

    if sp is not None:
        try:
            sp = float(sp)
        except Exception:
            return jsonify(success=False, message="salarypercent must be a number"), 400

        if sp < 0 or sp > 100:
            return jsonify(success=False, message="salarypercent must be 0-100"), 400

        a.salarypercent = sp

    new_password = (data.get('password') or data.get('agentPassword') or '').strip()
    if new_password:
        a.setpassword(new_password)

    db.session.commit()
    return jsonify(success=True, message="Agent updated")


@app.route('/api/admin/agents/<int:agentid>/users', methods=['GET'])
@admin_required
def api_admin_agent_users(agentid):
    try:
        a = Agent.query.get(agentid)
        if not a:
            return jsonify({'success': False, 'message': 'Agent not found'}), 404

        summary = _build_agent_commission_data(a, include_history=False)

        items = []
        for row in summary.get("items", []):
            amountplayed = int((row.get("eligibleplayed") or 0) + (row.get("blockedplayed") or 0))
            items.append({
                'userid': row.get('userid'),
                'username': row.get('username', ''),
                'joining': row.get('joining', ''),
                'amountplayed': amountplayed,
                'salarygenerated': round(float(row.get('salarygenerated') or 0), 2)
            })

        return jsonify({
            'success': True,
            'agentid': a.id,
            'items': items
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'admin agent users api error: {str(e)}'
        }), 500

# ----------------------------
# Agents: Block / Unblock
# ----------------------------
@app.route('/api/admin/agents/<int:agentid>/block', methods=['POST'])
@admin_required
def adminblockagent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message='Agent not found'), 404

    data = request.get_json() or {}
    reason = (data.get('reason') or 'Blocked by admin').strip()

    if not a.isblocked:
        a.isblocked = True
        a.blockreason = reason

        open_period = (
            AgentBlockPeriod.query
            .filter_by(agentid=a.id, endat=None)
            .order_by(AgentBlockPeriod.startat.desc())
            .first()
        )

        if not open_period:
            db.session.add(
                AgentBlockPeriod(
                    agentid=a.id,
                    startat=datetime.utcnow(),
                    endat=None
                )
            )

        db.session.commit()

    return jsonify(success=True, message='Agent blocked')


@app.route('/api/admin/agents/<int:agentid>/unblock', methods=['POST'])
@admin_required
def adminunblockagent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message='Agent not found'), 404

    if a.isblocked:
        a.isblocked = False
        a.blockreason = None

        open_period = (
            AgentBlockPeriod.query
            .filter_by(agentid=a.id, endat=None)
            .order_by(AgentBlockPeriod.startat.desc())
            .first()
        )

        if open_period:
            open_period.endat = datetime.utcnow()

        db.session.commit()

    return jsonify(success=True, message='Agent unblocked')

# ----------------------------
# Agents: Users list (click Users count)
# ----------------------------
from sqlalchemy import func

from sqlalchemy import func

@app.route('/api/admin/agents/<int:agentid>/users', methods=['GET'])
@admin_required
def admin_agent_users(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message='Agent not found'), 404

    summary = _build_agent_commission_data(a)
    items = summary['items'][:]

    created_map = {}
    for u in User.query.filter_by(agentid=a.id).all():
        u_created = (
            getattr(u, "createdat", None)
            or getattr(u, "createdAt", None)
            or getattr(u, "created_at", None)
        )
        created_map[int(u.id)] = u_created or datetime.min

    items.sort(key=lambda row: created_map.get(int(row.get('userid') or 0), datetime.min))

    return jsonify({
        'agentid': a.id,
        'agentname': a.name,
        'salarypercent': float(a.salarypercent or 0),
        'items': items
    })

@app.route('/api/admin/agents/<int:agentid>/commission-history', methods=['GET'])
@admin_required
def admin_agent_commission_history(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message='Agent not found'), 404

    from_dt = _parse_from_date(request.args.get('from'))
    to_dt = _parse_to_date(request.args.get('to'))
    limit = request.args.get('limit', 200, type=int)

    summary = _build_agent_commission_data(
        a,
        from_dt=from_dt,
        to_dt=to_dt,
        include_history=True,
        limit=limit
    )

    return jsonify({
        'agentid': a.id,
        'agentname': a.name,
        'salarypercent': float(a.salarypercent or 0),
        'summary': {
            'rawplayed': int(summary['rawplayed']),
            'eligibleplayed': int(summary['eligibleplayed']),
            'blockedplayed': int(summary['blockedplayed']),
            'totalsalary': round(summary['totalsalary'], 2),
            'blockedsalary': round(summary['blockedsalary'], 2),
        },
        'items': summary['history']
    })

@app.route('/api/admin/payroll', methods=['GET'])
@admin_required
def api_admin_payroll():
    from_dt = _parse_from_date(request.args.get('from'))
    to_dt = _parse_to_date(request.args.get('to'))

    agents = Agent.query.order_by(Agent.createdat.desc()).all()
    items = []
    totalearned = 0.0
    totalpaid = 0.0
    totalpending = 0.0

    for a in agents:
        summary = _build_agent_commission_data(
            a,
            from_dt=from_dt,
            to_dt=to_dt,
            include_history=False
        )

        earned = round(float(summary.get('totalsalary', 0) or 0), 2)
        paid = _payment_total(a.id, from_dt=from_dt, to_dt=to_dt)
        pending = round(max(earned - paid, 0), 2)

        last_payment = (
            AgentSalaryPayment.query
            .filter_by(agentid=a.id)
            .order_by(AgentSalaryPayment.paidat.desc())
            .first()
        )

        items.append({
            'agentid': a.id,
            'agentname': a.name or '-',
            'username': a.username or '-',
            'status': 'BLOCKED' if a.isblocked else 'ACTIVE',
            'salarypercent': float(a.salarypercent or 0),
            'totalplayed': int(summary.get('eligibleplayed', 0) or 0),
            'earnedsalary': earned,
            'paidsalary': paid,
            'pendingsalary': pending,
            'lastpaidat': fmt_ist(last_payment.paidat, '%Y-%m-%d %H:%M') if last_payment and last_payment.paidat else ''
        })

        totalearned += earned
        totalpaid += paid
        totalpending += pending

    return jsonify({
        'summary': {
            'totalearned': round(totalearned, 2),
            'totalpaid': round(totalpaid, 2),
            'totalpending': round(totalpending, 2),
            'agentcount': len(items)
        },
        'items': items
    })


@app.route('/api/admin/payroll/payments', methods=['GET'])
@admin_required
def api_admin_payroll_payments():
    from_dt = _parse_from_date(request.args.get('from'))
    to_dt = _parse_to_date(request.args.get('to'))
    agentid = request.args.get('agentid', type=int)

    q = AgentSalaryPayment.query

    if agentid:
        q = q.filter_by(agentid=agentid)
    if from_dt:
        q = q.filter(AgentSalaryPayment.paidat >= from_dt)
    if to_dt:
        q = q.filter(AgentSalaryPayment.paidat < to_dt)

    rows = q.order_by(AgentSalaryPayment.paidat.desc()).all()
    items = []

    for p in rows:
        a = Agent.query.get(p.agentid)
        items.append({
            'id': p.id,
            'agentid': p.agentid,
            'agentname': a.name if a else '-',
            'amountpaid': round(_safe_float(p.amountpaid), 2),
            'periodfrom': p.periodfrom.strftime('%Y-%m-%d') if p.periodfrom else '',
            'periodto': p.periodto.strftime('%Y-%m-%d') if p.periodto else '',
            'paidat': fmt_ist(p.paidat, '%Y-%m-%d %H:%M') if p.paidat else '',
            'paidby': p.paidby or 'admin',
            'referenceno': p.referenceno or '',
            'note': p.note or ''
        })

    return jsonify({
        'items': items,
        'totalpaid': round(sum(_safe_float(x['amountpaid']) for x in items), 2)
    })


@app.route('/api/admin/agents/<int:agentid>/salary-payments', methods=['GET', 'POST'])
@admin_required
def api_admin_agent_salary_payments(agentid):
    agent = Agent.query.get(agentid)
    if not agent:
        return jsonify({'success': False, 'message': 'Agent not found'}), 404

    if request.method == 'GET':
        rows = (
            AgentSalaryPayment.query
            .filter_by(agentid=agentid)
            .order_by(AgentSalaryPayment.paidat.desc())
            .all()
        )

        return jsonify({
            'items': [{
                'id': p.id,
                'agentid': p.agentid,
                'agentname': agent.name,
                'amountpaid': round(_safe_float(p.amountpaid), 2),
                'periodfrom': p.periodfrom.strftime('%Y-%m-%d') if p.periodfrom else '',
                'periodto': p.periodto.strftime('%Y-%m-%d') if p.periodto else '',
                'paidat': fmt_ist(p.paidat, '%Y-%m-%d %H:%M') if p.paidat else '',
                'paidby': p.paidby or 'admin',
                'referenceno': p.referenceno or '',
                'note': p.note or ''
            } for p in rows]
        })

    data = request.get_json() or {}
    amountpaid = _safe_float(data.get('amountpaid'))

    if amountpaid <= 0:
        return jsonify({'success': False, 'message': 'Enter valid amount'}), 400

    summary = _build_agent_commission_data(agent, include_history=False)
    earned = round(float(summary.get('totalsalary', 0) or 0), 2)
    already_paid = _payment_total(agent.id)
    pending = round(max(earned - already_paid, 0), 2)

    if amountpaid > pending:
        return jsonify({'success': False, 'message': f'Amount exceeds pending salary ({pending})'}), 400

    row = AgentSalaryPayment(
        agentid=agent.id,
        amountpaid=amountpaid,
        periodfrom=_to_date(_parse_from_date(data.get('periodfrom'))),
        periodto=_to_date(_parse_from_date(data.get('periodto'))),
        note=(data.get('note') or '').strip(),
        referenceno=(data.get('referenceno') or '').strip(),
        paidby=session.get('username', 'admin'),
        paidat=datetime.utcnow()
    )
    db.session.add(row)
    db.session.commit()

    return jsonify({
        'success': True,
        'message': 'Salary payment saved successfully'
    })


@app.route("/api/admin/wallet", methods=["GET"])
@admin_required
def admin_get_wallet_stats():
    total_balance = db.session.query(db.func.sum(Wallet.balance)).scalar() or 0
    wallet_count = Wallet.query.count()
    return jsonify({"total_balance": total_balance, "wallet_count": wallet_count, "wallets": []})


@app.route("/api/admin/referrals", methods=["GET"])
@admin_required
def admin_get_referrals():
    return jsonify([])


@app.route("/api/admin/promos", methods=["GET", "POST"])
@admin_required
def admin_promos():
    if request.method == "GET":
        return jsonify([])
    data = request.get_json() or {}
    return jsonify({"success": True, "message": "Promo saved (placeholder)", "data": data})


@app.route("/api/admin/announcements", methods=["GET", "POST"])
@admin_required
def admin_announcements():
    if request.method == "GET":
        return jsonify([])
    data = request.get_json() or {}
    return jsonify({"success": True, "message": "Announcement saved (placeholder)", "data": data})


@app.route("/api/admin/reports", methods=["GET"])
@admin_required
def admin_reports():
    users = [u for u in User.query.all() if not _is_admin_user(u)]
    total_users = len(users)
    total_wallets = Wallet.query.count()
    total_balance = db.session.query(db.func.sum(Wallet.balance)).scalar() or 0
    return jsonify({
        "total_users": total_users,
        "total_wallets": total_wallets,
        "total_balance": total_balance,
        "top_games": [],
        "top_users": [],
    })


@app.route("/api/admin/transactions", methods=["GET"])
@admin_required
def admin_get_transactions():
    out = []

    # 1) Existing game history based BET/WIN rows
    try:
        store = _get_user_history_store() or {}
    except Exception:
        store = {}

    for uid, bets in store.items():
        try:
            user = User.query.get(uid)
            username = getattr(user, "username", None) if user else f"user_{uid}"
        except Exception:
            username = f"user_{uid}"

        for rec in (bets or []):
            try:
                gametype = rec.get("gametype") or rec.get("game_type") or "-"
                roundcode = rec.get("roundcode") or rec.get("round_code") or "-"

                cfg = (globals().get("GAME_CONFIGS") or globals().get("GAMECONFIGS") or {}).get(gametype, {})
                game_title = cfg.get("name") or gametype

                bet_amt = rec.get("betamount") or rec.get("bet_amount") or cfg.get("bet_amount") or cfg.get("betamount") or 0
                bt = rec.get("bettime") or rec.get("bet_time") or datetime.utcnow()
                dt_str = fmtist(bt, "%Y-%m-%d %H:%M") if isinstance(bt, datetime) else str(bt)

                out.append({
                    "id": f"BET-{uid}-{roundcode}",
                    "userid": uid,
                    "user_id": uid,
                    "username": username,
                    "type": "BET",
                    "gametype": gametype,
                    "game_type": gametype,
                    "gametitle": game_title,
                    "game_title": game_title,
                    "roundcode": roundcode,
                    "round_code": roundcode,
                    "amount": int(bet_amt or 0),
                    "status": str(rec.get("status") or "PENDING").upper(),
                    "datetime": dt_str,
                    "reference": roundcode,
                })

                is_resolved = bool(rec.get("isresolved", False) or rec.get("is_resolved", False))
                is_win = bool(rec.get("win", False)) or (str(rec.get("status", "")).lower() == "win")
                if is_resolved and is_win:
                    win_dt = rec.get("datetime") or rec.get("date_time") or dt_str
                    payout = cfg.get("payout") or 0

                    out.append({
                        "id": f"WIN-{uid}-{roundcode}",
                        "userid": uid,
                        "user_id": uid,
                        "username": username,
                        "type": "WIN",
                        "gametype": gametype,
                        "game_type": gametype,
                        "gametitle": game_title,
                        "game_title": game_title,
                        "roundcode": roundcode,
                        "round_code": roundcode,
                        "amount": int(payout or 0),
                        "status": "WIN",
                        "datetime": win_dt,
                        "reference": roundcode,
                    })
            except Exception:
                continue

    # 2) Wallet / DB transactions
    try:
        db_rows = Transaction.query.order_by(Transaction.datetime.desc()).limit(1000).all()
    except Exception:
        db_rows = []

    for t in db_rows:
        try:
            user = User.query.get(t.userid)
            username = getattr(user, "username", None) if user else f"user_{t.userid}"

            out.append({
                "id": t.id,
                "userid": t.userid,
                "user_id": t.userid,
                "username": username,
                "type": str(t.kind or "").upper(),
                "gametype": "",
                "game_type": "",
                "gametitle": t.gametitle or t.label or "-",
                "game_title": t.gametitle or t.label or "-",
                "roundcode": "",
                "round_code": "",
                "amount": int(t.amount or 0),
                "status": "SUCCESS",
                "datetime": fmtist(t.datetime, "%Y-%m-%d %H:%M") if t.datetime else "",
                "reference": t.label or t.gametitle or t.note or "-",
            })
        except Exception:
            continue

    return jsonify(out)

@app.route('/api/admin/subadmins', methods=['GET', 'POST'])
@admin_required
def api_admin_subadmins():
    if request.method == 'POST':
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        phone = (data.get('phone') or data.get('mobile') or '').strip()

        if not name or not username or not password:
            return jsonify({'success': False, 'message': 'All fields required'}), 400

        if SubAdmin.query.filter_by(username=username).first():
            return jsonify({'success': False, 'message': 'Username exists'}), 400

        sa = SubAdmin(name=name, username=username, phone=phone)
        sa.set_password(password)
        db.session.add(sa)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Sub-admin created', 'id': sa.id})

    subadmins = SubAdmin.query.order_by(SubAdmin.created_at.desc()).all()
    out = []
    for sa in subadmins:
        out.append({
            'id': sa.id,
            'name': sa.name,
            'username': sa.username,
            'phone': sa.phone or '',
            'mobile': sa.phone or '',
            'created_at': fmt_ist(sa.created_at, '%Y-%m-%d %H:%M') if sa.created_at else '',
            'createdat': fmt_ist(sa.created_at, '%Y-%m-%d %H:%M') if sa.created_at else '',
        })
    return jsonify(out)

@app.route('/api/admin/subadmins/<int:subadmin_id>', methods=['PUT'])
@admin_required
def api_admin_update_subadmin(subadmin_id):
    sa = SubAdmin.query.get(subadmin_id)
    if not sa:
        return jsonify({'success': False, 'message': 'Sub-admin not found'}), 404

    data = request.get_json() or {}
    name = (data.get('name') or sa.name).strip()
    username = (data.get('username') or sa.username).strip()
    phone = (data.get('phone') or data.get('mobile') or sa.phone or '').strip()
    password = (data.get('password') or '').strip()

    existing = SubAdmin.query.filter(
        SubAdmin.username == username,
        SubAdmin.id != sa.id
    ).first()
    if existing:
        return jsonify({'success': False, 'message': 'Username already exists'}), 400

    sa.name = name
    sa.username = username
    sa.phone = phone

    if password:
        sa.set_password(password)

    db.session.commit()
    return jsonify({'success': True, 'message': 'Sub-admin updated'})



from flask import render_template, request, redirect, url_for, session
from sqlalchemy import func
from sqlalchemy.inspection import inspect as sa_inspect

def _agent_column_keys():
    try:
        return [c.key for c in sa_inspect(Agent).mapper.column_attrs]
    except Exception:
        return []

def _pick_key(keys, preferred):
    for k in preferred:
        if k in keys:
            return k
    return None

def _safe_str(x):
    if x is None:
        return ""
    if isinstance(x, (bytes, bytearray)):
        try:
            return x.decode("utf-8", "ignore")
        except Exception:
            return str(x)
    return str(x)

from flask import render_template, request, redirect, url_for, session
from sqlalchemy import func

@app.route('/agent/login', methods=['GET', 'POST'])
def agent_login():
    # already logged in
    if session.get('agent_id') or session.get('agentid') or session.get('agentId') or session.get('agentID'):
        return redirect(url_for('agent_panel'))

    error = None

    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        password = (request.form.get('password') or '').strip()

        if not username or not password:
            return render_template('agent_login.html', error="Username and password required.")

        agent = Agent.query.filter(func.lower(Agent.username) == username.lower()).first()
        if not agent:
            return render_template('agent_login.html', error="Invalid credentials.")

        if agent.isblocked:
            return render_template('agent_login.html', error="Your account is blocked. Contact admin.")

        # IMPORTANT: your model uses SHA-256 passwordhash
        if not agent.checkpassword(password):
            return render_template('agent_login.html', error="Invalid credentials.")

        # success: set session (support both new and your decorator key)
        session['agent_id'] = int(agent.id)
        session['agentid'] = int(agent.id)
        session.pop('agentId', None)
        session.pop('agentID', None)

        return redirect(url_for('agent_panel'))

    return render_template('agent_login.html', error=error)

@app.route('/api/agent/profile/password', methods=['PUT'])
@agent_required
def api_agent_change_password():
    a = Agent.query.get(int(get_session_agent_id()))
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    data = request.get_json(silent=True) or {}
    password = (data.get('password') or '').strip()
    if not password:
        return jsonify(success=False, message="Password required"), 400

    a.setpassword(password)   # <-- IMPORTANT (sha256 -> passwordhash)
    db.session.commit()
    return jsonify(success=True, message="Password updated")

@app.route('/api/agent/stats')
@agent_required
def api_agent_stats():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    # users under this agent
    user_ids = [u.id for u in User.query.with_entities(User.id).filter_by(agentid=aid).all()]
    total_users = len(user_ids)

    total_played = 0
    if user_ids:
        total_played = (
            db.session.query(func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.user_id.in_(user_ids),
                func.lower(Transaction.kind) == 'bet'
            )
            .scalar()
        ) or 0

    total_salary = (float(total_played) * float(agent.salarypercent or 0)) / 100.0

    return jsonify(
        totalusers=total_users,
        totalsalary=round(total_salary, 0),
    )



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
    """Handle user bet placement - FORCED WINNERS DON'T BLOCK USER BETS"""
    game_type = data.get("game_type")
    raw_user_id = data.get("user_id")
    username = data.get("username")
    number = data.get("number")
    round_code = data.get("round_code")

    print(f"Ã°Å¸Å½Â¯ Bet attempt: user={raw_user_id}, game={game_type}, number={number}, round={round_code}")

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
    if not wallet:
        emit("bet_error", {"message": "Admin cannot place bets"})
        return

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

    if len(table.bets) >= table.max_players:
        emit("bet_error", {"message": "All slots are full"})
        return

    bet_amount = table.config["bet_amount"]
    if wallet.balance < bet_amount:
        emit("bet_error", {"message": "Insufficient balance"})
        return

    # Ã¢Å“â€¦ CRITICAL: Add bet to table (forced winners don't interfere here)
    success, message = table.add_bet(user_id, username, number)
    if not success:
        print(f"Ã¢ÂÅ’ Bet rejected: {message}")
        emit("bet_error", {"message": message})
        return

    # Deduct balance
    wallet.balance -= bet_amount

    # Log transaction
    bet_tx = Transaction(
        user_id=user_id,
        kind="bet",
        amount=bet_amount,
        balance_after=wallet.balance,
        label="Bet Placed",
        game_title=table.config["name"],
        note=f"Number {number}",
    )
    db.session.add(bet_tx)
    db.session.commit()

    print(f"Ã¢Å“â€¦ Bet placed successfully: user={user_id}, number={number}, round={table.round_code}")

    # Prepare players list for broadcast
    players_data = []
    for bet in table.bets:
        players_data.append(
            {"user_id": str(bet["user_id"]), "username": bet["username"], "number": bet["number"]}
        )

    # Emit success to the user
    emit(
        "bet_success",
        {
            "message": message,
            "new_balance": wallet.balance,
            "round_code": table.round_code,
            "table_number": table.table_number,
            "players": players_data,
            "slots_available": table.get_slots_available(),
        },
    )

    # Broadcast table update to all clients
    emit(
        "update_table",
        {
            "game_type": game_type,
            "table_number": table.table_number,
            "round_code": table.round_code,
            "players": players_data,
            "slots_available": table.get_slots_available(),
            "time_remaining": table.get_time_remaining(),
            "is_betting_closed": table.is_betting_closed,
        },
        broadcast=True,
        include_self=True,
    )
    
# ---------------------------------------------------
# Demo user seeding
# ---------------------------------------------------


def seed_demo_users():
    print("\nðŸ”„ Checking/Creating users...")

    demo_usernames = ["demo"] + [f"demo{i}" for i in range(1, 6)]
    for uname in demo_usernames:
        user = User.query.filter_by(username=uname).first()
        if not user:
            user = User(username=uname, display_name=uname)
            user.set_password("demo123")
            db.session.add(user)
            db.session.commit()
            print(f"âœ… Created user: {uname}")
        ensure_wallet_for_user(user)
        ensure_store_wallet_for_user(user)

    admin = User.query.filter_by(username="admin").first()
    if not admin:
        print("âœ… Creating admin user...")
        admin = User(username="admin", display_name="Admin User", is_admin=True)
        admin.set_password("admin123")
        db.session.add(admin)
        db.session.commit()
        print("âœ… Admin user created: is_admin=True (NO WALLET)")
    else:
        if not admin.is_admin:
            print("âš ï¸  Fixing admin user: setting is_admin=True")
            admin.is_admin = True
            db.session.commit()
        print("âœ… Admin user verified: is_admin=True")

    print("âœ… All users ready!\n")


# ---------------------------------------------------
# Main entry
# ---------------------------------------------------

with app.app_context():
    print("Creating database tables...")
    db.create_all()
    migrate_ticket_schema()
    migrate_subadmin_phone_column()
    print("✅ Database tables created (including ForcedWinnerHistory)")

    print("👥 Seeding demo users...")
    seed_demo_users()

    print("🎮 Initializing game tables...")
    initialize_game_tables()

    print("▶️  Starting game threads...")
    start_all_game_tables()

    print("\n" + "=" * 60)
    print("🎮 GAME OF FIVE - Admin Panel Ready")
    print("=" * 60)
    print("📍 Admin URL: http://localhost:10000/admin")
    print("👤 Admin Username: admin")
    print("🔐 Admin Password: admin123")
    print("=" * 60)
    print(f"🔒 Super Admin Login: http://localhost:10000/sa-login")
    print(f"👤 Username: {SUPERADMIN_USERNAME}")
    print(f"🔐 Password: {SUPERADMIN_PASSWORD}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False,
        allow_unsafe_werkzeug=True,
    )
